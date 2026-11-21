import {
  evaluateNetworkAnalytics,
  type HiddenPartnerAggregate,
} from "@kulgo/engine";
import type {
  Facility,
  RiskSignal,
  WorkspaceNetworkResponse,
} from "@kulgo/shared";
import type { AuthRepository } from "../auth/repository.js";
import type { InvitationRepository } from "../invites/repository.js";
import type { WorkspaceRepository } from "../workspace/repository.js";
import type { RiskSignalRepository } from "./risk-signals.js";

const MAX_TRAVERSAL_DEPTH = 4;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface PartnerHiddenSummaryResolverDeps {
  authRepo: AuthRepository;
  workspaceRepo: WorkspaceRepository;
  riskSignalRepo: RiskSignalRepository;
  inviteRepo: InvitationRepository;
}

export interface PartnerSummaryResolutionContext {
  facilities: readonly Facility[];
  lanes: WorkspaceNetworkResponse["lanes"];
}

interface InternalPartnerEval {
  targetFacilityId: string;
  partnerOrgId: string;
  hiddenUpstreamScope3Tco2e: number;
  hasSanctionedUpstream: boolean;
  regionCode: string | null;
  hasChokepointAlert: boolean;
  chokepointRegionCode: string | null;
  upstreamCountryCodes: Set<string>;
}

function getActiveTier1FacilityIds(
  network: PartnerSummaryResolutionContext,
): Map<string, Facility> {
  const activeSupplierFacilityIds = new Set<string>();
  for (const lane of network.lanes) {
    if (lane.volumeSharePct > 0) {
      activeSupplierFacilityIds.add(lane.fromFacilityId);
    }
  }

  const activeTier1ById = new Map<string, Facility>();
  for (const facility of network.facilities) {
    if (
      !facility.isOwnFacility &&
      activeSupplierFacilityIds.has(facility.facilityId)
    ) {
      activeTier1ById.set(facility.facilityId, facility);
    }
  }
  return activeTier1ById;
}

/**
 * Creates the server-side `resolvePartnerHiddenSummaries` function wired into
 * `OrgScopedAnalyticsRepository`.
 *
 * Traverses `VERIFIED_PARTNER_LINK` edges strictly server-side into verified
 * Tier-1 partners' upstream networks (Org B -> Org C -> Org D, ...) and returns
 * ONLY anonymized aggregate Scope 3 totals and coarse region-level risk flags
 * keyed strictly by Org A's Tier-1 `facilityId`.
 *
 * ZERO Tier-2+ facility IDs, org IDs, company names, emails, or coordinates
 * ever leave this resolver.
 */
export function createPartnerHiddenSummaryResolver(
  deps: PartnerHiddenSummaryResolverDeps,
): (
  orgId: string,
  activeNetwork?: PartnerSummaryResolutionContext,
) => Promise<ReadonlyMap<string, HiddenPartnerAggregate>> {
  const { authRepo, workspaceRepo, riskSignalRepo, inviteRepo } = deps;

  async function resolveForOrg(
    orgId: string,
    riskSignals: readonly RiskSignal[],
    visitedOrgIds: ReadonlySet<string>,
    depth: number,
    activeNetwork?: PartnerSummaryResolutionContext,
  ): Promise<Map<string, HiddenPartnerAggregate>> {
    const result = new Map<string, HiddenPartnerAggregate>();
    if (depth >= MAX_TRAVERSAL_DEPTH) {
      return result;
    }

    const [links, buyerNetwork] = await Promise.all([
      inviteRepo.listVerifiedPartnerLinksForOrg(orgId),
      activeNetwork
        ? Promise.resolve(activeNetwork)
        : workspaceRepo.getNetwork(orgId),
    ]);
    if (links.length === 0) {
      return result;
    }

    const activeTier1ById = getActiveTier1FacilityIds(buyerNetwork);
    if (activeTier1ById.size === 0) {
      return result;
    }

    const evaluations: InternalPartnerEval[] = [];

    for (const link of links) {
      if (visitedOrgIds.has(link.partnerOrgId)) {
        continue;
      }

      const buyerFacility = activeTier1ById.get(link.targetFacilityId);
      if (!buyerFacility) {
        continue;
      }

      const nextVisited = new Set(visitedOrgIds);
      nextVisited.add(link.partnerOrgId);

      const [partnerOrg, partnerNetwork] = await Promise.all([
        authRepo.findOrganizationById(link.partnerOrgId),
        workspaceRepo.getNetwork(link.partnerOrgId),
      ]);
      const deeperHiddenSummaries = await resolveForOrg(
        link.partnerOrgId,
        riskSignals,
        nextVisited,
        depth + 1,
        partnerNetwork,
      );

      const partnerSummary = evaluateNetworkAnalytics({
        organization: {
          scope1Tco2e: partnerOrg?.scope1Tco2e ?? null,
          scope2Tco2e: partnerOrg?.scope2Tco2e ?? null,
        },
        inputs: partnerNetwork.inputs,
        facilities: partnerNetwork.facilities,
        lanes: partnerNetwork.lanes,
        riskSignals,
        partnerHiddenSummaries: deeperHiddenSummaries,
      });

      const sanctionAlert = partnerSummary.alerts.find(
        (alert) => alert.category === "SECONDARY_SANCTION",
      );
      const deeperSharedChokepointAlert = partnerSummary.alerts.find(
        (alert) => alert.category === "SHARED_UPSTREAM_CHOKEPOINT",
      );
      const geopoliticalAlert = partnerSummary.alerts.find(
        (alert) => alert.category === "GEOPOLITICAL",
      );

      // Collect coarse upstream country codes strictly in memory to detect
      // shared upstream country chokepoints across multiple distinct Tier-1 partners.
      const activeUpstreamFacilityIds = new Set(
        partnerNetwork.lanes
          .filter((lane) => lane.volumeSharePct > 0)
          .map((lane) => lane.fromFacilityId),
      );
      const upstreamCountryCodes = new Set<string>();
      for (const facility of partnerNetwork.facilities) {
        if (
          !facility.isOwnFacility &&
          activeUpstreamFacilityIds.has(facility.facilityId)
        ) {
          upstreamCountryCodes.add(facility.countryCode);
        }
      }
      if (geopoliticalAlert?.affectedRegionCode) {
        upstreamCountryCodes.add(geopoliticalAlert.affectedRegionCode);
      }

      const hasExplicitScope12Override =
        buyerFacility.estimatedScope12Tco2e !== null &&
        buyerFacility.estimatedScope12Tco2e !== undefined &&
        buyerFacility.estimatedScope12Tco2e > 0;

      const partnerPrimaryScope12 = hasExplicitScope12Override
        ? 0
        : partnerSummary.esg.scope1Tco2e + partnerSummary.esg.scope2Tco2e;

      evaluations.push({
        targetFacilityId: link.targetFacilityId,
        partnerOrgId: link.partnerOrgId,
        hiddenUpstreamScope3Tco2e: round2(
          partnerPrimaryScope12 +
            partnerSummary.esg.upstreamScope3Tco2e +
            partnerSummary.esg.transportScope3Tco2e,
        ),
        hasSanctionedUpstream: Boolean(sanctionAlert),
        regionCode: sanctionAlert?.affectedRegionCode ?? null,
        hasChokepointAlert: Boolean(deeperSharedChokepointAlert),
        chokepointRegionCode:
          deeperSharedChokepointAlert?.affectedRegionCode ??
          geopoliticalAlert?.affectedRegionCode ??
          null,
        upstreamCountryCodes,
      });
    }

    // Detect shared upstream country chokepoints across 2+ DISTINCT verified
    // partner organizations (deduplicated by partnerOrgId) so a single partner
    // linked to multiple Tier-1 facility nodes cannot trigger a false chokepoint
    // and leak its Tier-2 supplier country.
    const partnersByCountry = new Map<string, Set<string>>();
    for (const ev of evaluations) {
      for (const code of ev.upstreamCountryCodes) {
        const partnerIds = partnersByCountry.get(code) ?? new Set<string>();
        partnerIds.add(ev.partnerOrgId);
        partnersByCountry.set(code, partnerIds);
      }
    }

    for (const ev of evaluations) {
      let sharedCountryCode: string | null = null;
      for (const code of ev.upstreamCountryCodes) {
        if ((partnersByCountry.get(code)?.size ?? 0) >= 2) {
          sharedCountryCode = code;
          break;
        }
      }

      const hasSharedChokepoint =
        ev.hasChokepointAlert || sharedCountryCode !== null;
      const chokepointRegionCode =
        sharedCountryCode ??
        (ev.hasChokepointAlert ? ev.chokepointRegionCode : null);

      result.set(ev.targetFacilityId, {
        hiddenUpstreamScope3Tco2e: ev.hiddenUpstreamScope3Tco2e,
        hasSanctionedUpstream: ev.hasSanctionedUpstream,
        regionCode: ev.regionCode,
        hasSharedChokepoint,
        chokepointRegionCode,
      });
    }

    return result;
  }

  return async (
    orgId: string,
    activeNetwork?: PartnerSummaryResolutionContext,
  ) => {
    const riskSignals = await riskSignalRepo.listActive();
    const visited = new Set<string>([orgId]);
    return resolveForOrg(orgId, riskSignals, visited, 0, activeNetwork);
  };
}

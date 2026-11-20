import {
  evaluateNetworkAnalytics,
  type HiddenPartnerAggregate,
} from "@kulgo/engine";
import type { RiskSignal } from "@kulgo/shared";
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

interface InternalPartnerEval {
  targetFacilityId: string;
  hiddenUpstreamScope3Tco2e: number;
  hasSanctionedUpstream: boolean;
  regionCode: string | null;
  hasChokepointAlert: boolean;
  chokepointRegionCode: string | null;
  upstreamCountryCodes: Set<string>;
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
): (orgId: string) => Promise<ReadonlyMap<string, HiddenPartnerAggregate>> {
  const { authRepo, workspaceRepo, riskSignalRepo, inviteRepo } = deps;

  async function resolveForOrg(
    orgId: string,
    riskSignals: readonly RiskSignal[],
    visitedOrgIds: ReadonlySet<string>,
    depth: number,
  ): Promise<Map<string, HiddenPartnerAggregate>> {
    const result = new Map<string, HiddenPartnerAggregate>();
    if (depth >= MAX_TRAVERSAL_DEPTH) {
      return result;
    }

    const links = await inviteRepo.listVerifiedPartnerLinksForOrg(orgId);
    if (links.length === 0) {
      return result;
    }

    const evaluations: InternalPartnerEval[] = [];

    for (const link of links) {
      if (visitedOrgIds.has(link.partnerOrgId)) {
        continue;
      }

      const nextVisited = new Set(visitedOrgIds);
      nextVisited.add(link.partnerOrgId);

      const [partnerOrg, partnerNetwork, deeperHiddenSummaries] =
        await Promise.all([
          authRepo.findOrganizationById(link.partnerOrgId),
          workspaceRepo.getNetwork(link.partnerOrgId),
          resolveForOrg(
            link.partnerOrgId,
            riskSignals,
            nextVisited,
            depth + 1,
          ),
        ]);

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
      const chokepointAlert = partnerSummary.alerts.find(
        (alert) =>
          alert.category === "SHARED_UPSTREAM_CHOKEPOINT" ||
          alert.category === "GEOPOLITICAL",
      );

      // Collect coarse upstream country codes strictly in memory to detect
      // shared upstream country chokepoints across multiple Tier-1 partners.
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

      evaluations.push({
        targetFacilityId: link.targetFacilityId,
        hiddenUpstreamScope3Tco2e: round2(
          partnerSummary.esg.upstreamScope3Tco2e +
            partnerSummary.esg.transportScope3Tco2e,
        ),
        hasSanctionedUpstream: Boolean(sanctionAlert),
        regionCode: sanctionAlert?.affectedRegionCode ?? null,
        hasChokepointAlert: Boolean(chokepointAlert),
        chokepointRegionCode: chokepointAlert?.affectedRegionCode ?? null,
        upstreamCountryCodes,
      });
    }

    // Detect shared upstream country chokepoints across 2+ verified Tier-1 partners
    const countryPartnerCount = new Map<string, number>();
    for (const ev of evaluations) {
      for (const code of ev.upstreamCountryCodes) {
        countryPartnerCount.set(code, (countryPartnerCount.get(code) ?? 0) + 1);
      }
    }

    for (const ev of evaluations) {
      let sharedCountryCode: string | null = null;
      for (const code of ev.upstreamCountryCodes) {
        if ((countryPartnerCount.get(code) ?? 0) >= 2) {
          sharedCountryCode = code;
          break;
        }
      }

      const hasSharedChokepoint =
        ev.hasChokepointAlert || sharedCountryCode !== null;
      const chokepointRegionCode =
        sharedCountryCode ?? ev.chokepointRegionCode ?? null;

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

  return async (orgId: string) => {
    const riskSignals = await riskSignalRepo.listActive();
    const visited = new Set<string>([orgId]);
    return resolveForOrg(orgId, riskSignals, visited, 0);
  };
}

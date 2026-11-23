import {
  computeFinancialRiskSummary,
  evaluateNetworkAnalytics,
  type HiddenPartnerAggregate,
} from "@kulgo/engine";
import type {
  Contract,
  ContractLine,
  DerivedLaneCommercialSummary,
  Facility,
  RiskSignal,
  WorkspaceNetworkResponse,
} from "@kulgo/shared";
import type { AuthRepository } from "../auth/repository.js";
import type { InvitationRepository } from "../invites/repository.js";
import type { WorkspaceRepository } from "../workspace/repository.js";
import type { RiskSignalRepository } from "./risk-signals.js";

export const MAX_TRAVERSAL_DEPTH = 4;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toIsoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildPartnerLaneIncotermsMap(
  contracts?: readonly Contract[],
  contractLines?: readonly ContractLine[],
): Map<string, string | null> {
  const incotermsByLaneId = new Map<string, string | null>();
  if (!contracts || !contractLines) return incotermsByLaneId;
  const contractsById = new Map(contracts.map((c) => [c.contractId, c]));
  for (const line of contractLines) {
    const contract = contractsById.get(line.contractId);
    if (contract && !contract.isManuallyArchived && contract.incoterms) {
      if (!incotermsByLaneId.has(line.laneId)) {
        incotermsByLaneId.set(line.laneId, contract.incoterms);
      }
    }
  }
  return incotermsByLaneId;
}

function derivePartnerCommercials(
  network: WorkspaceNetworkResponse,
  riskSignals: readonly RiskSignal[],
  asOfDate: Date,
): {
  laneCommercialsByLaneId: Map<string, DerivedLaneCommercialSummary>;
  incotermsByLaneId: Map<string, string | null>;
} {
  const financialRisk = computeFinancialRiskSummary({
    products: network.products,
    inputs: network.inputs,
    facilities: network.facilities,
    lanes: network.lanes,
    contracts: network.contracts,
    contractLines: network.contractLines,
    riskSignals,
    asOfDate: toIsoDateUtc(asOfDate),
    viewMode: "PERIOD_WINDOW",
  });
  return {
    laneCommercialsByLaneId: new Map<string, DerivedLaneCommercialSummary>(
      financialRisk.laneCommercials.map((lc) => [lc.laneId, lc]),
    ),
    incotermsByLaneId: buildPartnerLaneIncotermsMap(
      network.contracts,
      network.contractLines,
    ),
  };
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
  partnerInventoryKey: string;
  hiddenUpstreamScope3Tco2e: number;
  supplierEmissionIntensityTco2ePerEur: number | null;
  partnerTotalEmissionsCapTco2e: number | null;
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

function getNormalizedOutgoingWeight(
  lanes: readonly WorkspaceNetworkResponse["lanes"][number][],
): number[] {
  const allHavePositiveVolume = lanes.every(
    (l) =>
      typeof l.annualVolume === "number" &&
      Number.isFinite(l.annualVolume) &&
      l.annualVolume > 0,
  );
  if (allHavePositiveVolume) {
    const allMass = lanes.every(
      (l) => l.volumeUnit === "TONNES" || l.volumeUnit === "KG",
    );
    if (allMass) {
      return lanes.map((l) =>
        l.volumeUnit === "KG" ? l.annualVolume! / 1000 : l.annualVolume!,
      );
    }
    const firstUnit = lanes[0]?.volumeUnit;
    if (firstUnit && lanes.every((l) => l.volumeUnit === firstUnit)) {
      return lanes.map((l) => l.annualVolume!);
    }
  }

  const allHavePositiveSpend = lanes.every(
    (l) =>
      typeof l.annualSpendEur === "number" &&
      Number.isFinite(l.annualSpendEur) &&
      l.annualSpendEur > 0,
  );
  if (allHavePositiveSpend) {
    return lanes.map((l) => l.annualSpendEur!);
  }

  return lanes.map((l) => l.volumeSharePct);
}

/**
 * Computes the fraction in [0, 1] of each upstream own facility's throughput
 * that flows into `fulfillingFacilityId` across the partner's active network.
 *
 * Uses fixed-point iteration over outgoing active lane weights (preferring
 * compatible `annualVolume`, then `annualSpendEur`, then `volumeSharePct`) so
 * shared transit hubs feeding multiple plants allocate their Scope 1 & 2
 * inventory proportionally without over-counting across reconciled plants,
 * while handling diamonds and internal cycles cleanly.
 */
function computeUpstreamOwnFacilityShares(
  activeLanes: readonly WorkspaceNetworkResponse["lanes"][number][],
  feedingFacilityIds: ReadonlySet<string>,
  fulfillingFacilityId: string,
): Map<string, number> {
  const outgoingByFromId = new Map<
    string,
    Array<{ toFacilityId: string; fraction: number }>
  >();

  const rawOutgoingByFromId = new Map<
    string,
    WorkspaceNetworkResponse["lanes"]
  >();
  for (const lane of activeLanes) {
    if (!feedingFacilityIds.has(lane.fromFacilityId)) {
      continue;
    }
    const existing = rawOutgoingByFromId.get(lane.fromFacilityId);
    if (existing) {
      existing.push(lane);
    } else {
      rawOutgoingByFromId.set(lane.fromFacilityId, [lane]);
    }
  }

  for (const [fromId, outgoing] of rawOutgoingByFromId) {
    const weights = getNormalizedOutgoingWeight(outgoing);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) {
      continue;
    }
    outgoingByFromId.set(
      fromId,
      outgoing.map((lane, idx) => ({
        toFacilityId: lane.toFacilityId,
        fraction: weights[idx]! / totalWeight,
      })),
    );
  }

  const shareByFacilityId = new Map<string, number>([
    [fulfillingFacilityId, 1],
  ]);
  const nonRootFeedingIds = Array.from(feedingFacilityIds).filter(
    (id) => id !== fulfillingFacilityId,
  );

  for (let iter = 0; iter < 64; iter += 1) {
    let maxDelta = 0;
    for (const facilityId of nonRootFeedingIds) {
      const outgoing = outgoingByFromId.get(facilityId);
      if (!outgoing || outgoing.length === 0) {
        continue;
      }
      let nextShare = 0;
      for (const edge of outgoing) {
        nextShare += edge.fraction * (shareByFacilityId.get(edge.toFacilityId) ?? 0);
      }
      const clamped = Math.min(1, Math.max(0, nextShare));
      const prev = shareByFacilityId.get(facilityId) ?? 0;
      const delta = Math.abs(clamped - prev);
      if (delta > maxDelta) {
        maxDelta = delta;
      }
      shareByFacilityId.set(facilityId, clamped);
    }
    if (maxDelta < 1e-9) {
      break;
    }
  }

  return shareByFacilityId;
}

/**
 * Scopes a verified partner's network to the full upstream subgraph feeding
 * `fulfilledByFacilityId` when two-sided facility reconciliation has been bound
 * on `VERIFIED_PARTNER_LINK`.
 *
 * Traverses active inbound lanes (`volumeSharePct > 0`) transitively from the
 * fulfilling own facility so multi-hop internal topologies (e.g.
 * supplier -> own transit facility -> fulfilling plant), branches, diamonds,
 * and cycles are resolved without infinite recursion or duplicate entries while
 * excluding unrelated branches. Shared upstream own transit facilities have
 * their Scope 1 & 2 inventory allocated proportionally across the plants they
 * serve so a hub feeding multiple reconciled plants is not counted at 100%
 * against each plant.
 *
 * When `fulfilledByFacilityId` is omitted or does not match an own facility in
 * `partnerNetwork`, falls back conservatively to the partner's full active upstream
 * network per `docs/PRIVACY_CONTRACT.md`.
 */
export function scopePartnerNetworkForReconciliation(
  partnerNetwork: WorkspaceNetworkResponse,
  fulfilledByFacilityId?: string | null,
): WorkspaceNetworkResponse {
  if (!fulfilledByFacilityId) {
    return partnerNetwork;
  }

  const fulfillingOwnFacility = partnerNetwork.facilities.find(
    (f) => f.facilityId === fulfilledByFacilityId && f.isOwnFacility,
  );
  if (!fulfillingOwnFacility) {
    // Conservative fallback: evaluate entire active upstream network
    return partnerNetwork;
  }

  const activeLanes = partnerNetwork.lanes.filter(
    (lane) => lane.volumeSharePct > 0,
  );
  const inboundByToFacilityId = new Map<
    string,
    WorkspaceNetworkResponse["lanes"]
  >();
  for (const lane of activeLanes) {
    const existing = inboundByToFacilityId.get(lane.toFacilityId);
    if (existing) {
      existing.push(lane);
    } else {
      inboundByToFacilityId.set(lane.toFacilityId, [lane]);
    }
  }

  const feedingFacilityIds = new Set<string>([
    fulfillingOwnFacility.facilityId,
  ]);
  const scopedLaneIds = new Set<string>();
  const queue: string[] = [fulfillingOwnFacility.facilityId];
  let head = 0;

  while (head < queue.length) {
    const currentFacilityId = queue[head++]!;
    const inboundLanes = inboundByToFacilityId.get(currentFacilityId);
    if (!inboundLanes) {
      continue;
    }
    for (const lane of inboundLanes) {
      scopedLaneIds.add(lane.laneId);
      if (!feedingFacilityIds.has(lane.fromFacilityId)) {
        feedingFacilityIds.add(lane.fromFacilityId);
        queue.push(lane.fromFacilityId);
      }
    }
  }

  const ownFacilityShareById = computeUpstreamOwnFacilityShares(
    activeLanes,
    feedingFacilityIds,
    fulfillingOwnFacility.facilityId,
  );

  const scopedLanes = partnerNetwork.lanes.filter((lane) =>
    scopedLaneIds.has(lane.laneId),
  );
  const scopedFacilities = partnerNetwork.facilities
    .filter((f) => feedingFacilityIds.has(f.facilityId))
    .map((facility) => {
      if (
        !facility.isOwnFacility ||
        facility.facilityId === fulfillingOwnFacility.facilityId
      ) {
        return facility;
      }
      const rawShare = ownFacilityShareById.get(facility.facilityId) ?? 1;
      const share = Math.abs(1 - rawShare) < 1e-6 ? 1 : rawShare;
      if (share >= 1) {
        return facility;
      }
      const scaledEstimatedScope12 =
        typeof facility.estimatedScope12Tco2e === "number" &&
        Number.isFinite(facility.estimatedScope12Tco2e) &&
        facility.estimatedScope12Tco2e > 0
          ? round6(facility.estimatedScope12Tco2e * share)
          : facility.estimatedScope12Tco2e;
      const scaledAnnualElectricityMwh =
        typeof facility.annualElectricityMwh === "number" &&
        Number.isFinite(facility.annualElectricityMwh) &&
        facility.annualElectricityMwh > 0
          ? round6(facility.annualElectricityMwh * share)
          : facility.annualElectricityMwh;
      return {
        ...facility,
        estimatedScope12Tco2e: scaledEstimatedScope12,
        annualElectricityMwh: scaledAnnualElectricityMwh,
      };
    });

  return {
    ...partnerNetwork,
    facilities: scopedFacilities,
    lanes: scopedLanes,
  };
}

/**
 * Creates the server-side `resolvePartnerHiddenSummaries` function wired into
 * `OrgScopedAnalyticsRepository`.
 *
 * Traverses `VERIFIED_PARTNER_LINK` edges strictly server-side into verified
 * Tier-1 partners' upstream networks (Org B -> Org C -> Org D, ...) with
 * cycle-safe per-path `visitedOrgIds` and `MAX_TRAVERSAL_DEPTH`, returning
 * ONLY anonymized aggregate Scope 3 totals and coarse region-level risk flags
 * keyed strictly by Org A's Tier-1 `facilityId`.
 *
 * ZERO Tier-2+ facility IDs, org IDs, company names, total revenues, emails,
 * or coordinates ever leave this resolver.
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

      const [partnerOrg, rawPartnerNetwork] = await Promise.all([
        authRepo.findOrganizationById(link.partnerOrgId),
        workspaceRepo.getNetwork(link.partnerOrgId),
      ]);
      const partnerNetwork = scopePartnerNetworkForReconciliation(
        rawPartnerNetwork,
        link.fulfilledByFacilityId,
      );
      const isFacilityScoped =
        Boolean(link.fulfilledByFacilityId) &&
        partnerNetwork !== rawPartnerNetwork;

      const deeperHiddenSummaries = await resolveForOrg(
        link.partnerOrgId,
        riskSignals,
        nextVisited,
        depth + 1,
        partnerNetwork,
      );

      const asOfDate = new Date();
      const partnerCommercials = derivePartnerCommercials(
        partnerNetwork,
        riskSignals,
        asOfDate,
      );

      const partnerSummary = evaluateNetworkAnalytics({
        organization: {
          orgId: isFacilityScoped ? undefined : partnerOrg?.orgId,
          name: isFacilityScoped ? undefined : partnerOrg?.name,
          countryCode: isFacilityScoped ? undefined : partnerOrg?.countryCode,
          scope1Tco2e: isFacilityScoped
            ? null
            : (partnerOrg?.scope1Tco2e ?? null),
          scope2Tco2e: isFacilityScoped
            ? null
            : (partnerOrg?.scope2Tco2e ?? null),
          scope2MarketTco2e: isFacilityScoped
            ? null
            : (partnerOrg?.scope2MarketTco2e ?? null),
        },
        inputs: partnerNetwork.inputs,
        facilities: partnerNetwork.facilities,
        lanes: partnerNetwork.lanes,
        riskSignals,
        partnerHiddenSummaries: deeperHiddenSummaries,
        laneCommercialsByLaneId: partnerCommercials.laneCommercialsByLaneId,
        incotermsByLaneId: partnerCommercials.incotermsByLaneId,
        asOfDate,
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

      const hiddenUpstreamScope3Tco2e = round2(
        partnerPrimaryScope12 +
          partnerSummary.esg.upstreamScope3Tco2e +
          partnerSummary.esg.transportScope3Tco2e,
      );

      // Privacy-safe server-side Economic Attribution Intensity (tCO2e / EUR):
      // Strict denominator scoping: never divide a single reconciled facility's
      // emissions by whole-organization revenue!
      const partnerOrgProductRev = rawPartnerNetwork.products.reduce(
        (sum, prod) =>
          sum +
          (typeof prod.annualRevenueEur === "number" &&
          Number.isFinite(prod.annualRevenueEur) &&
          prod.annualRevenueEur > 0
            ? prod.annualRevenueEur
            : 0),
        0,
      );
      const partnerOrgRevenueEur =
        typeof partnerOrg?.annualRevenueEur === "number" &&
        Number.isFinite(partnerOrg.annualRevenueEur) &&
        partnerOrg.annualRevenueEur > 0
          ? partnerOrg.annualRevenueEur
          : partnerOrgProductRev > 0
            ? partnerOrgProductRev
            : null;

      let supplierEmissionIntensityTco2ePerEur: number | null = null;
      let partnerTotalEmissionsCapTco2e: number | null = null;
      let partnerInventoryKey = `partner:${link.partnerOrgId}:org`;

      if (isFacilityScoped) {
        const fulfillingFac = partnerNetwork.facilities.find(
          (f) => f.facilityId === link.fulfilledByFacilityId && f.isOwnFacility,
        );
        const facRev =
          typeof fulfillingFac?.annualRevenueEur === "number" &&
          Number.isFinite(fulfillingFac.annualRevenueEur) &&
          fulfillingFac.annualRevenueEur > 0
            ? fulfillingFac.annualRevenueEur
            : null;
        if (facRev !== null && partnerSummary.esg.totalTco2e > 0) {
          supplierEmissionIntensityTco2ePerEur = round6(
            partnerSummary.esg.totalTco2e / facRev,
          );
          partnerTotalEmissionsCapTco2e = round2(partnerSummary.esg.totalTco2e);
          partnerInventoryKey = `partner:${link.partnerOrgId}:fac:${link.fulfilledByFacilityId}`;
        } else if (partnerOrgRevenueEur !== null) {
          // Fall back consistently to org-wide emissions / org-wide revenue across the complete partner network
          const orgWideDeeperHiddenSummaries = await resolveForOrg(
            link.partnerOrgId,
            riskSignals,
            nextVisited,
            depth + 1,
            rawPartnerNetwork,
          );
          const orgWideCommercials = derivePartnerCommercials(
            rawPartnerNetwork,
            riskSignals,
            asOfDate,
          );
          const orgWideSummary = evaluateNetworkAnalytics({
            organization: {
              orgId: partnerOrg?.orgId,
              name: partnerOrg?.name,
              countryCode: partnerOrg?.countryCode,
              scope1Tco2e: partnerOrg?.scope1Tco2e ?? null,
              scope2Tco2e: partnerOrg?.scope2Tco2e ?? null,
              scope2MarketTco2e: partnerOrg?.scope2MarketTco2e ?? null,
              annualRevenueEur: partnerOrgRevenueEur,
            },
            inputs: rawPartnerNetwork.inputs,
            facilities: rawPartnerNetwork.facilities,
            lanes: rawPartnerNetwork.lanes,
            riskSignals,
            partnerHiddenSummaries: orgWideDeeperHiddenSummaries,
            laneCommercialsByLaneId: orgWideCommercials.laneCommercialsByLaneId,
            incotermsByLaneId: orgWideCommercials.incotermsByLaneId,
            asOfDate,
          });
          if (orgWideSummary.esg.totalTco2e > 0) {
            supplierEmissionIntensityTco2ePerEur = round6(
              orgWideSummary.esg.totalTco2e / partnerOrgRevenueEur,
            );
            partnerTotalEmissionsCapTco2e = round2(
              orgWideSummary.esg.totalTco2e,
            );
          }
        }
      } else if (
        partnerOrgRevenueEur !== null &&
        partnerSummary.esg.totalTco2e > 0
      ) {
        supplierEmissionIntensityTco2ePerEur = round6(
          partnerSummary.esg.totalTco2e / partnerOrgRevenueEur,
        );
        partnerTotalEmissionsCapTco2e = round2(partnerSummary.esg.totalTco2e);
      }

      evaluations.push({
        targetFacilityId: link.targetFacilityId,
        partnerOrgId: link.partnerOrgId,
        partnerInventoryKey,
        hiddenUpstreamScope3Tco2e,
        supplierEmissionIntensityTco2ePerEur,
        partnerTotalEmissionsCapTco2e,
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
        supplierEmissionIntensityTco2ePerEur:
          ev.supplierEmissionIntensityTco2ePerEur,
        partnerTotalEmissionsCapTco2e: ev.partnerTotalEmissionsCapTco2e,
        partnerInventoryKey: ev.partnerInventoryKey,
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

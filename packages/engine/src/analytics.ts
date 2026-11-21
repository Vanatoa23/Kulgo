import {
  AnalyticsSummarySchema,
  SimulateAnalyticsResponseSchema,
  type AnalyticsSummary,
  type AnonymizedRiskAlert,
  type Facility,
  type HhiMetric,
  type RiskSignal,
  type RiskStatus,
  type SimulateAnalyticsResponse,
  type SimulatedLaneChange,
  type SupplyInput,
  type SupplyLane,
  type VolumeUnit,
} from "@kulgo/shared";
import { haversineDistanceKm } from "./baselines.js";
import { computeEsgSummary, estimateLaneCo2eTonnes } from "./esg.js";
import { isPointInWktPolygon } from "./geo.js";
import { computeHhi, type ShareEntry } from "./hhi.js";

/**
 * Strictly anonymized server-side aggregate derived from a verified partner's
 * hidden Tier-2+ network. Contains ZERO Tier-2+ facility IDs, org IDs,
 * company names, emails, or exact coordinates.
 */
export interface HiddenPartnerAggregate {
  hiddenUpstreamScope3Tco2e: number;
  hasSanctionedUpstream: boolean;
  regionCode: string | null;
  hasSharedChokepoint?: boolean;
  chokepointRegionCode?: string | null;
}

export interface NetworkAnalyticsInput {
  organization: {
    scope1Tco2e: number | null;
    scope2Tco2e: number | null;
  };
  inputs: readonly SupplyInput[];
  facilities: readonly Facility[];
  lanes: readonly SupplyLane[];
  riskSignals: readonly RiskSignal[];
  /**
   * Optional map keyed strictly by the buyer organization's own Tier-1 facilityId.
   */
  partnerHiddenSummaries?: ReadonlyMap<string, HiddenPartnerAggregate>;
  /**
   * Injectable reference date for deterministic contract-expiry evaluation.
   */
  asOfDate?: Date;
}

const MS_PER_DAY = 86_400_000;
const CONTRACT_RED_DAYS = 90;
const CONTRACT_YELLOW_DAYS = 180;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toAnnualTonnes(
  annualVolume: number | null,
  volumeUnit: VolumeUnit,
): number | null {
  if (annualVolume === null || annualVolume <= 0) {
    return null;
  }
  if (volumeUnit === "TONNES") {
    return annualVolume;
  }
  if (volumeUnit === "KG") {
    return annualVolume / 1000;
  }
  return null;
}

function computeEffectiveLaneCo2e(
  lane: SupplyLane,
  facilitiesById: ReadonlyMap<string, Facility>,
): number {
  if (lane.volumeSharePct <= 0) {
    return 0;
  }

  const from = facilitiesById.get(lane.fromFacilityId);
  const to = facilitiesById.get(lane.toFacilityId);

  const distanceKm =
    lane.distanceKm !== null && lane.distanceKm > 0
      ? lane.distanceKm
      : from && to
        ? haversineDistanceKm(from.lat, from.lng, to.lat, to.lng)
        : 0;

  const annualTonnes = toAnnualTonnes(lane.annualVolume, lane.volumeUnit);
  if (annualTonnes !== null && distanceKm > 0) {
    return estimateLaneCo2eTonnes({
      distanceKm,
      annualTonnes,
      transportMode: lane.transportMode,
    });
  }

  return lane.estimatedLaneCo2e !== null && lane.estimatedLaneCo2e > 0
    ? lane.estimatedLaneCo2e
    : 0;
}

function computeOwnScope12(
  organization: NetworkAnalyticsInput["organization"],
  facilities: readonly Facility[],
): { scope1: number; scope2: number } {
  if (
    organization.scope1Tco2e !== null ||
    organization.scope2Tco2e !== null
  ) {
    return {
      scope1: round2(Math.max(0, organization.scope1Tco2e ?? 0)),
      scope2: round2(Math.max(0, organization.scope2Tco2e ?? 0)),
    };
  }

  const ownTotal = facilities
    .filter((f) => f.isOwnFacility)
    .reduce((sum, f) => sum + Math.max(0, f.estimatedScope12Tco2e ?? 0), 0);

  const scope1 = round2(ownTotal * 0.4);
  const scope2 = round2(ownTotal - scope1);
  return { scope1, scope2 };
}

function daysUntilContractEnd(contractEndDate: string, asOfDate: Date): number {
  const endMs = Date.parse(`${contractEndDate}T00:00:00Z`);
  return Math.ceil((endMs - asOfDate.getTime()) / MS_PER_DAY);
}

/**
 * Pure, deterministic analytics engine for Kulgo M2.
 * Computes HHI concentration (supplier, country, per-material), SPOF alerts,
 * contract-expiry warnings, RiskSignal polygon & corridor alerts, and
 * Scope 1/2/3 ESG roll-ups, validated against strict Zod DTOs.
 */
export function evaluateNetworkAnalytics(
  input: NetworkAnalyticsInput,
): AnalyticsSummary {
  const asOfDate = input.asOfDate ?? new Date();
  const facilitiesById = new Map<string, Facility>();
  for (const facility of input.facilities) {
    facilitiesById.set(facility.facilityId, facility);
  }

  const inputsById = new Map<string, SupplyInput>();
  for (const item of input.inputs) {
    inputsById.set(item.inputId, item);
  }

  const activeLanes = input.lanes.filter((lane) => lane.volumeSharePct > 0);
  const activeSignals = input.riskSignals.filter((signal) => signal.active);

  // --- 1. HHI Concentration Metrics ---
  const hhiMetrics: HhiMetric[] = [];

  if (activeLanes.length > 0) {
    const allHaveSpend = activeLanes.every(
      (lane) =>
        lane.annualSpendEur !== null &&
        Number.isFinite(lane.annualSpendEur) &&
        lane.annualSpendEur > 0,
    );
    const allHaveNormalizedVolume =
      !allHaveSpend &&
      activeLanes.every((lane) => {
        const tonnes = toAnnualTonnes(lane.annualVolume, lane.volumeUnit);
        return tonnes !== null && Number.isFinite(tonnes) && tonnes > 0;
      });
    const allHaveRawPositiveVolume =
      !allHaveSpend &&
      !allHaveNormalizedVolume &&
      activeLanes.every(
        (lane) =>
          lane.annualVolume !== null &&
          Number.isFinite(lane.annualVolume) &&
          lane.annualVolume > 0,
      );

    const supplierEntries: ShareEntry[] = [];
    const countryEntries: ShareEntry[] = [];
    const lanesByMaterialKey = new Map<
      string,
      { label: string; lanes: SupplyLane[] }
    >();

    for (const lane of activeLanes) {
      let weight: number;
      if (allHaveSpend) {
        weight = lane.annualSpendEur!;
      } else if (allHaveNormalizedVolume) {
        weight = toAnnualTonnes(lane.annualVolume, lane.volumeUnit)!;
      } else if (allHaveRawPositiveVolume) {
        weight = lane.annualVolume!;
      } else {
        weight = lane.volumeSharePct;
      }

      supplierEntries.push({ key: lane.fromFacilityId, weight });

      const fromFacility = facilitiesById.get(lane.fromFacilityId);
      if (fromFacility) {
        countryEntries.push({ key: fromFacility.countryCode, weight });
      }

      const linkedInput = lane.inputId
        ? inputsById.get(lane.inputId)
        : undefined;
      const materialKey = linkedInput?.inputId ?? `cat:${lane.materialCategory}`;
      const materialLabel = linkedInput
        ? `${linkedInput.name} (${linkedInput.category})`
        : lane.materialCategory;

      const group = lanesByMaterialKey.get(materialKey) ?? {
        label: materialLabel,
        lanes: [],
      };
      group.lanes.push(lane);
      lanesByMaterialKey.set(materialKey, group);
    }

    hhiMetrics.push(
      computeHhi("SUPPLIER", "Overall Supplier Concentration", supplierEntries),
    );
    if (countryEntries.length > 0) {
      hhiMetrics.push(
        computeHhi("COUNTRY", "Geographic Country Concentration", countryEntries),
      );
    }

    for (const [, group] of lanesByMaterialKey) {
      const entries: ShareEntry[] = group.lanes.map((lane) => ({
        key: lane.fromFacilityId,
        weight: lane.volumeSharePct,
      }));
      hhiMetrics.push(computeHhi("MATERIAL", group.label, entries));
    }
  }

  // --- 2. Anonymized Risk Alerts ---
  const alerts: AnonymizedRiskAlert[] = [];

  // 2a. SPOF (Single Point of Failure) alerts per material
  const lanesByMaterial = new Map<string, { label: string; lanes: SupplyLane[] }>();
  for (const lane of activeLanes) {
    const linkedInput = lane.inputId ? inputsById.get(lane.inputId) : undefined;
    const key = linkedInput?.inputId ?? `cat:${lane.materialCategory}`;
    const label = linkedInput ? linkedInput.name : lane.materialCategory;
    const group = lanesByMaterial.get(key) ?? { label, lanes: [] };
    group.lanes.push(lane);
    lanesByMaterial.set(key, group);
  }

  for (const [key, group] of lanesByMaterial) {
    const uniqueSuppliers = new Set(group.lanes.map((l) => l.fromFacilityId));
    if (uniqueSuppliers.size === 1) {
      const onlyFacilityId = Array.from(uniqueSuppliers)[0]!;
      const onlyFacility = facilitiesById.get(onlyFacilityId);
      const hasRedLane = group.lanes.some((l) => l.riskStatus === "RED");
      const severity: RiskStatus = hasRedLane ? "RED" : "YELLOW";

      alerts.push({
        alertId: `spof-${key}`,
        severity,
        category: "SINGLE_SOURCE",
        title: `Single-source dependency: ${group.label}`,
        summary: `100% of active volume for ${group.label} relies on a single Tier-1 supplier (${onlyFacility?.name ?? "supplier"}).`,
        affectedTier1FacilityIds: [onlyFacilityId],
        affectedRegionCode: onlyFacility?.countryCode ?? null,
        confidence: onlyFacility?.isPartnerVerified
          ? "NETWORK_VERIFIED"
          : "ESTIMATED",
        recommendedAction:
          "Qualify a secondary supplier or split volume in the What-If Simulator to reduce HHI below 5,000.",
      });
    }
  }

  // 2b. Contract Expiry Warnings
  for (const lane of activeLanes) {
    if (!lane.contractEndDate) continue;
    const daysRemaining = daysUntilContractEnd(lane.contractEndDate, asOfDate);
    if (daysRemaining > CONTRACT_YELLOW_DAYS) continue;

    const fromFacility = facilitiesById.get(lane.fromFacilityId);
    const linkedInput = lane.inputId ? inputsById.get(lane.inputId) : undefined;
    const materialLabel = linkedInput?.name ?? lane.materialCategory;
    const severity: RiskStatus =
      daysRemaining <= CONTRACT_RED_DAYS ? "RED" : "YELLOW";

    const title =
      daysRemaining < 0
        ? `Contract expired: ${materialLabel}`
        : `Contract expiring in ${daysRemaining}d: ${materialLabel}`;
    const summary =
      daysRemaining < 0
        ? `Supply agreement with ${fromFacility?.name ?? "Tier-1 supplier"} ended on ${lane.contractEndDate} (${Math.abs(daysRemaining)} days overdue).`
        : `Supply agreement with ${fromFacility?.name ?? "Tier-1 supplier"} expires on ${lane.contractEndDate} (${daysRemaining} days remaining).`;

    alerts.push({
      alertId: `contract-${lane.laneId}`,
      severity,
      category: "CONTRACT_EXPIRY",
      title,
      summary,
      affectedTier1FacilityIds: [lane.fromFacilityId],
      affectedRegionCode: fromFacility?.countryCode ?? null,
      confidence: "NETWORK_VERIFIED",
      recommendedAction:
        daysRemaining <= CONTRACT_RED_DAYS
          ? "Initiate immediate contract renewal or shift volume to an alternate corridor."
          : "Begin renewal negotiations and benchmark alternative suppliers ahead of expiry.",
    });
  }

  // 2c. RiskSignal Polygon & Geopolitical / Sanctions Corridor Alerts
  const activeSupplierIds = new Set(activeLanes.map((l) => l.fromFacilityId));
  const activeSupplierFacilities = Array.from(activeSupplierIds)
    .map((id) => facilitiesById.get(id))
    .filter((f): f is Facility => f !== undefined && !f.isOwnFacility);

  const signalCoveredFacilityIds = new Set<string>();

  for (const signal of activeSignals) {
    const matchedFacilities = activeSupplierFacilities.filter(
      (f) =>
        isPointInWktPolygon(f.lat, f.lng, signal.polygonWkt) ||
        signal.affectedCountryCodes.includes(f.countryCode),
    );
    if (matchedFacilities.length === 0) continue;

    for (const f of matchedFacilities) {
      signalCoveredFacilityIds.add(f.facilityId);
    }

    const category: AnonymizedRiskAlert["category"] =
      signal.kind === "SANCTIONS" ? "SECONDARY_SANCTION" : "GEOPOLITICAL";

    alerts.push({
      alertId: `signal-${signal.signalId}`,
      severity: signal.severity,
      category,
      title: signal.title,
      summary:
        signal.description ??
        `${matchedFacilities.length} active Tier-1 supplier(s) intersect the ${signal.title} risk zone.`,
      affectedTier1FacilityIds: matchedFacilities.map((f) => f.facilityId),
      affectedRegionCode: signal.regionCode ?? matchedFacilities[0]?.countryCode ?? null,
      confidence: "ESTIMATED",
      recommendedAction:
        signal.severity === "RED"
          ? "Audit sanctions exposure immediately and simulate reallocating volume to EU/Nordic suppliers."
          : "Monitor corridor transit risk and prepare multimodal contingency routing.",
    });
  }

  // 2d. Lane-level RED / YELLOW corridor alerts not already covered by a RiskSignal
  for (const lane of activeLanes) {
    if (lane.riskStatus === "GREEN") continue;
    if (signalCoveredFacilityIds.has(lane.fromFacilityId)) continue;

    const fromFacility = facilitiesById.get(lane.fromFacilityId);
    const linkedInput = lane.inputId ? inputsById.get(lane.inputId) : undefined;
    const materialLabel = linkedInput?.name ?? lane.materialCategory;
    const isSanction = (lane.riskReason ?? "").toLowerCase().includes("sanction");

    alerts.push({
      alertId: `lane-risk-${lane.laneId}`,
      severity: lane.riskStatus,
      category: isSanction ? "SECONDARY_SANCTION" : "GEOPOLITICAL",
      title: `${lane.riskStatus === "RED" ? "High-risk" : "Elevated-risk"} corridor: ${materialLabel}`,
      summary:
        lane.riskReason ??
        `Active ${lane.transportMode} lane from ${fromFacility?.name ?? "supplier"} is flagged ${lane.riskStatus}.`,
      affectedTier1FacilityIds: [lane.fromFacilityId],
      affectedRegionCode: fromFacility?.countryCode ?? null,
      confidence: fromFacility?.isPartnerVerified
        ? "NETWORK_VERIFIED"
        : "ESTIMATED",
      recommendedAction:
        "Review alternative sourcing corridors or adjust volume allocation in the What-If Simulator.",
    });
  }

  // 2e. Hidden Tier-2+ partner upstream risk (strictly anonymized)
  if (input.partnerHiddenSummaries) {
    const chokepointByRegion = new Map<string, string[]>();

    for (const facility of activeSupplierFacilities) {
      const hidden = input.partnerHiddenSummaries.get(facility.facilityId);
      if (!hidden) continue;

      if (hidden.hasSanctionedUpstream) {
        alerts.push({
          alertId: `partner-upstream-${facility.facilityId}`,
          severity: "RED",
          category: "SECONDARY_SANCTION",
          title: "Hidden upstream sanctions exposure",
          summary:
            "A Network-Verified Tier-1 partner has an anonymized upstream dependency linked to a sanctioned corridor.",
          affectedTier1FacilityIds: [facility.facilityId],
          affectedRegionCode: hidden.regionCode,
          confidence: "NETWORK_VERIFIED",
          recommendedAction:
            "Engage verified Tier-1 partner on upstream compliance or evaluate alternative EU suppliers.",
        });
      }

      if (hidden.hasSharedChokepoint) {
        const regionKey = hidden.chokepointRegionCode ?? hidden.regionCode ?? "UPSTREAM";
        const existing = chokepointByRegion.get(regionKey) ?? [];
        existing.push(facility.facilityId);
        chokepointByRegion.set(regionKey, existing);
      }
    }

    for (const [regionKey, affectedIds] of chokepointByRegion) {
      if (affectedIds.length < 2) continue;
      alerts.push({
        alertId: `partner-chokepoint-${regionKey.toLowerCase()}`,
        severity: "RED",
        category: "SHARED_UPSTREAM_CHOKEPOINT",
        title: "Shared hidden upstream chokepoint detected",
        summary: `${affectedIds.length} Network-Verified Tier-1 partners share an anonymized upstream dependency or transit chokepoint.`,
        affectedTier1FacilityIds: affectedIds,
        affectedRegionCode: regionKey === "UPSTREAM" ? null : regionKey,
        confidence: "NETWORK_VERIFIED",
        recommendedAction:
          "Diversify sourcing via the Alternative Suppliers Directory or simulate reallocating volume in the What-If Simulator.",
      });
    }
  }

  // Sort alerts: RED first, then YELLOW, then GREEN
  const severityRank: Record<RiskStatus, number> = { RED: 0, YELLOW: 1, GREEN: 2 };
  alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  // --- 3. Scope 1 / 2 / 3 ESG Roll-up ---
  const { scope1, scope2 } = computeOwnScope12(
    input.organization,
    input.facilities,
  );
  const laneTransportCo2eTonnes = activeLanes.map((lane) =>
    computeEffectiveLaneCo2e(lane, facilitiesById),
  );

  const esg = computeEsgSummary({
    ownScope1Tco2e: scope1,
    ownScope2Tco2e: scope2,
    suppliers: activeSupplierFacilities.map((facility) => {
      const hidden = input.partnerHiddenSummaries?.get(facility.facilityId);
      return {
        isPartnerVerified: facility.isPartnerVerified,
        sector: facility.sector,
        reportedScope12Tco2e: facility.estimatedScope12Tco2e,
        hiddenUpstreamScope3Tco2e: hidden?.hiddenUpstreamScope3Tco2e ?? null,
      };
    }),
    laneTransportCo2eTonnes,
  });

  // --- 4. Resilience Score & Overall Status ---
  let resilienceScore = 100;
  let overallStatus: RiskStatus = "GREEN";

  if (activeLanes.length > 0) {
    const materialHhis = hhiMetrics.filter((m) => m.dimension === "MATERIAL");
    const avgMaterialHhi =
      materialHhis.length > 0
        ? materialHhis.reduce((sum, m) => sum + m.rawHhi, 0) /
          materialHhis.length
        : 0;
    const spofCount = materialHhis.filter((m) => m.isSinglePointOfFailure).length;
    const redAlertCount = alerts.filter((a) => a.severity === "RED").length;
    const yellowAlertCount = alerts.filter((a) => a.severity === "YELLOW").length;

    const concentrationPenalty = Math.min(35, (avgMaterialHhi / 10000) * 35);
    const alertPenalty = Math.min(45, redAlertCount * 14 + yellowAlertCount * 5);
    const spofPenalty = Math.min(20, spofCount * 3);

    resilienceScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(100 - concentrationPenalty - alertPenalty - spofPenalty),
      ),
    );

    if (redAlertCount > 0 || resilienceScore < 50) {
      overallStatus = "RED";
    } else if (yellowAlertCount > 0 || resilienceScore < 75) {
      overallStatus = "YELLOW";
    }
  }

  return AnalyticsSummarySchema.parse({
    resilienceScore,
    overallStatus,
    verifiedCoveragePct: esg.verifiedCoveragePct,
    confidence: esg.confidence,
    hhiMetrics,
    alerts,
    esg,
    riskSignals: activeSignals,
    computedAt: asOfDate.toISOString(),
  });
}

function summarizeHhiStats(summary: AnalyticsSummary): {
  maxHhi: number;
  avgHhi: number;
  spofCount: number;
} {
  const materialHhis = summary.hhiMetrics.filter(
    (m) => m.dimension === "MATERIAL",
  );
  const pool = materialHhis.length > 0 ? materialHhis : summary.hhiMetrics;
  if (pool.length === 0) {
    return { maxHhi: 0, avgHhi: 0, spofCount: 0 };
  }
  const maxHhi = Math.max(...pool.map((m) => m.rawHhi));
  const avgHhi = Math.round(
    pool.reduce((sum, m) => sum + m.rawHhi, 0) / pool.length,
  );
  const spofCount = materialHhis.filter((m) => m.isSinglePointOfFailure).length;
  return { maxHhi, avgHhi, spofCount };
}

/**
 * Stateless What-If Simulator.
 * Applies temporary lane volume-split / transport-mode overrides in memory
 * and returns baseline vs. simulated analytics plus exact deltas.
 */
export function simulateNetworkAnalytics(
  input: NetworkAnalyticsInput,
  laneChanges: readonly SimulatedLaneChange[],
): SimulateAnalyticsResponse {
  const baseline = evaluateNetworkAnalytics(input);

  const changesByLaneId = new Map<string, SimulatedLaneChange>();
  for (const change of laneChanges) {
    changesByLaneId.set(change.laneId, change);
  }

  let appliedChangesCount = 0;
  const simulatedLanes: SupplyLane[] = input.lanes.map((lane) => {
    const change = changesByLaneId.get(lane.laneId);
    if (!change) {
      return lane;
    }

    appliedChangesCount += 1;

    const nextVolumeSharePct =
      change.volumeSharePct !== undefined
        ? change.volumeSharePct
        : lane.volumeSharePct;

    let nextAnnualVolume = lane.annualVolume;
    if (change.annualVolume !== undefined) {
      nextAnnualVolume = change.annualVolume;
    } else if (
      change.volumeSharePct !== undefined &&
      lane.annualVolume !== null &&
      lane.volumeSharePct > 0
    ) {
      nextAnnualVolume = round2(
        lane.annualVolume * (change.volumeSharePct / lane.volumeSharePct),
      );
    }

    let nextAnnualSpendEur = lane.annualSpendEur;
    if (
      change.volumeSharePct !== undefined &&
      lane.annualSpendEur !== null &&
      lane.annualSpendEur !== undefined &&
      lane.volumeSharePct > 0
    ) {
      nextAnnualSpendEur = round2(
        lane.annualSpendEur * (change.volumeSharePct / lane.volumeSharePct),
      );
    }

    const nextTransportMode = change.transportMode ?? lane.transportMode;
    const nextRiskStatus = change.riskStatus ?? lane.riskStatus;

    // Clear cached estimatedLaneCo2e when mode or volume changes so engine recomputes it
    const transportOrVolumeChanged =
      change.transportMode !== undefined ||
      change.volumeSharePct !== undefined ||
      change.annualVolume !== undefined;

    return {
      ...lane,
      volumeSharePct: nextVolumeSharePct,
      annualVolume: nextAnnualVolume,
      annualSpendEur: nextAnnualSpendEur,
      transportMode: nextTransportMode,
      riskStatus: nextRiskStatus,
      estimatedLaneCo2e: transportOrVolumeChanged ? null : lane.estimatedLaneCo2e,
    };
  });

  const simulated = evaluateNetworkAnalytics({
    ...input,
    lanes: simulatedLanes,
  });

  const baseHhi = summarizeHhiStats(baseline);
  const simHhi = summarizeHhiStats(simulated);
  const baseRedAlerts = baseline.alerts.filter((a) => a.severity === "RED").length;
  const simRedAlerts = simulated.alerts.filter((a) => a.severity === "RED").length;

  return SimulateAnalyticsResponseSchema.parse({
    baseline,
    simulated,
    deltas: {
      resilienceScoreDelta: round2(
        simulated.resilienceScore - baseline.resilienceScore,
      ),
      maxHhiDelta: round2(simHhi.maxHhi - baseHhi.maxHhi),
      avgHhiDelta: round2(simHhi.avgHhi - baseHhi.avgHhi),
      alertCountDelta: simulated.alerts.length - baseline.alerts.length,
      redAlertCountDelta: simRedAlerts - baseRedAlerts,
      spofCountDelta: simHhi.spofCount - baseHhi.spofCount,
      transportScope3Tco2eDelta: round2(
        simulated.esg.transportScope3Tco2e - baseline.esg.transportScope3Tco2e,
      ),
      totalTco2eDelta: round2(
        simulated.esg.totalTco2e - baseline.esg.totalTco2e,
      ),
    },
    appliedChangesCount,
  });
}

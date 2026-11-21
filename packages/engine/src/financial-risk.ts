import {
  FinancialRiskSummarySchema,
  FinancialSimulationDeltaSchema,
  type Contract,
  type ContractLine,
  type DefectBufferRecommendation,
  type Facility,
  type FinancialConfidenceBadge,
  type FinancialRiskSummary,
  type FinancialSimulationDelta,
  type FinancialViewMode,
  type MaterialFinancialRisk,
  type Product,
  type ProductFinancialRisk,
  type RiskSignal,
  type SupplyInput,
  type SupplyLane,
  type TransportMode,
} from "@kulgo/shared";
import {
  FINANCIAL_RISK_BENCHMARK_VERSION,
  FINANCIAL_RISK_PARAMS_V1,
  inferCorridorKey,
  resolveSectorDefectBaseline,
  type CorridorBaselineKey,
  type ExpeditingShiftKey,
  type SwitchingReadinessTier,
} from "./baselines.js";
import { deriveNetworkCommercials } from "./contracts.js";

const DAY_COUNT_BASIS = FINANCIAL_RISK_PARAMS_V1.dayCountBasis;
const WEIGHTS = FINANCIAL_RISK_PARAMS_V1.ttrSupportMass;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Strictly anonymized server-side hidden risk multiplier tuple for a
 * buyer-visible Tier-1 lane. Opaque eventGroupId and raw multipliers
 * are consumed internally for common-shock deduplication and NEVER
 * emitted in public FinancialRiskSummary DTOs.
 */
export interface HiddenFinancialRiskInput {
  eventGroupId: string;
  hiddenProbabilityMultiplier: number; // validated in [1, 2]
  hiddenTtrMultiplier: number; // validated in [1, 2]
  verified: boolean;
}

export interface FinancialRiskInput {
  products: readonly Product[];
  inputs: readonly SupplyInput[];
  facilities: readonly Facility[];
  lanes: readonly SupplyLane[];
  contracts?: readonly Contract[];
  contractLines?: readonly ContractLine[];
  riskSignals?: readonly RiskSignal[];
  /**
   * Optional per-lane live risk multiplier override (e.g. from Sub-Project 1
   * or scenario stress test), keyed by laneId. Bounds: [0, 5].
   */
  liveRiskMultiplierByLaneId?: ReadonlyMap<string, number>;
  /**
   * Optional anonymized Tier-2+ upstream risk multipliers computed server-side
   * in OrgScopedAnalyticsRepository, keyed by buyer's Tier-1 laneId or fromFacilityId.
   */
  hiddenRiskByLaneId?: ReadonlyMap<string, HiddenFinancialRiskInput>;
  asOfDate: string; // ISO YYYY-MM-DD
  viewMode?: FinancialViewMode;
  windowStart?: string;
  windowEndExclusive?: string;
  fxRatesToEur?: Readonly<Record<string, number>>;
}

/**
 * Derives a bounded sub-additive liveRiskMultiplier in [1, 5] from matched
 * Sub-Project 1 RiskSignals so concurrent alerts never compound explosively.
 */
export function deriveLiveRiskMultiplierFromSignals(
  signals: readonly RiskSignal[],
): number {
  const activeSignals = signals.filter(
    (s) => s.active && s.lifecycle !== "RESOLVED",
  );
  if (activeSignals.length === 0) return 1;

  let sumSqExcess = 0;
  for (const sig of activeSignals) {
    let mu = 1.0;
    if (sig.verificationStatus === "ALLEGED") {
      mu = 1.1;
    } else if (sig.severity === "RED") {
      mu = sig.kind === "SANCTIONS" ? 2.5 : 2.25;
    } else if (sig.severity === "YELLOW") {
      mu = 1.45;
    }
    const excess = Math.max(0, mu - 1);
    sumSqExcess += excess * excess;
  }

  return clamp(
    1 + Math.sqrt(sumSqExcess),
    FINANCIAL_RISK_PARAMS_V1.liveRiskMultiplierBounds[0],
    FINANCIAL_RISK_PARAMS_V1.liveRiskMultiplierBounds[1],
  );
}

/**
 * Hazard / survival scaling for annual disruption probability, followed by
 * horizon pro-ration over D calendar days.
 */
export function computeEffectiveHorizonProb(
  pBase: number,
  modeProbMultiplier: number,
  liveRiskMultiplier: number,
  hiddenProbMultiplier: number,
  horizonDays: number,
  isCertainEvent = false,
): number {
  if (horizonDays <= 0) return 0;
  if (isCertainEvent) return 1;
  if (!Number.isFinite(pBase) || pBase <= 0) return 0;

  const safeLive = clamp(
    Number.isFinite(liveRiskMultiplier) ? liveRiskMultiplier : 1,
    FINANCIAL_RISK_PARAMS_V1.liveRiskMultiplierBounds[0],
    FINANCIAL_RISK_PARAMS_V1.liveRiskMultiplierBounds[1],
  );
  if (safeLive === 0) return 0;

  const safeHidden = clamp(
    Number.isFinite(hiddenProbMultiplier) ? hiddenProbMultiplier : 1,
    FINANCIAL_RISK_PARAMS_V1.hiddenProbabilityMultiplierBounds[0],
    FINANCIAL_RISK_PARAMS_V1.hiddenProbabilityMultiplierBounds[1],
  );

  const clampedBase = clamp(pBase, 0, FINANCIAL_RISK_PARAMS_V1.probabilityCap);
  const lambdaBase = -Math.log(1 - clampedBase);
  const lambdaEff = lambdaBase * modeProbMultiplier * safeLive * safeHidden;
  const pAnnualEff = clamp(
    1 - Math.exp(-lambdaEff),
    0,
    FINANCIAL_RISK_PARAMS_V1.probabilityCap,
  );
  return 1 - Math.pow(1 - pAnnualEff, horizonDays / DAY_COUNT_BASIS);
}

/**
 * Exact gross-up defect/faulty-unit buffer recommendation:
 * recommendedOrderBufferPct = 100 * d / (1 - d)
 * recommendedBufferUnits = ceil(n / (1 - d)) - n
 */
export function computeDefectBufferRecommendation(params: {
  laneId: string | null;
  inputId: string | null;
  annualUsableVolume: number;
  defectRatePct: number | null | undefined;
  sectorOrCategory?: string | null;
  leadTimeDays?: number | null;
  unitPriceEur?: number | null;
}): DefectBufferRecommendation {
  const baseline = resolveSectorDefectBaseline(params.sectorOrCategory);
  const isBaselineEstimate =
    params.defectRatePct === null || params.defectRatePct === undefined;
  const rawPct = isBaselineEstimate ? baseline.base : params.defectRatePct!;
  const safePct = clamp(Number.isFinite(rawPct) ? rawPct : 0, 0, 95);
  const d = safePct / 100;

  const orderFreq =
    params.leadTimeDays !== null &&
    params.leadTimeDays !== undefined &&
    params.leadTimeDays > 0
      ? Math.max(1, Math.round(DAY_COUNT_BASIS / Math.max(7, params.leadTimeDays)))
      : 12;

  const annualVol = Math.max(
    0,
    Number.isFinite(params.annualUsableVolume) ? params.annualUsableVolume : 0,
  );
  const orderVol = annualVol / orderFreq;

  const bufferPct = d > 0 ? (d / (1 - d)) * 100 : 0;
  const grossAnnual = d > 0 ? Math.ceil(annualVol / (1 - d)) : annualVol;
  const bufferUnitsAnnual = Math.max(0, grossAnnual - annualVol);
  const grossPerOrder = d > 0 ? Math.ceil(orderVol / (1 - d)) : orderVol;
  const bufferUnitsPerOrder = Math.max(0, grossPerOrder - orderVol);

  const expectedFaultyAnnual = annualVol * d;
  const expectedFaultyPerOrder = orderVol * d;

  const defectOverheadCostEur =
    params.unitPriceEur !== null &&
    params.unitPriceEur !== undefined &&
    Number.isFinite(params.unitPriceEur) &&
    params.unitPriceEur >= 0
      ? round2(bufferUnitsAnnual * params.unitPriceEur)
      : null;

  return {
    laneId: params.laneId,
    inputId: params.inputId,
    defectRatePct: round2(safePct),
    isBaselineEstimate,
    orderFrequencyPerYear: orderFreq,
    expectedFaultyUnitsPerOrder: round4(expectedFaultyPerOrder),
    expectedFaultyUnitsAnnual: round4(expectedFaultyAnnual),
    recommendedOrderBufferPct: round4(bufferPct),
    recommendedBufferUnitsPerOrder: round4(bufferUnitsPerOrder),
    recommendedBufferUnitsAnnual: round4(bufferUnitsAnnual),
    defectOverheadCostEur,
  };
}

function selectExpeditingShiftKey(mode: TransportMode): ExpeditingShiftKey {
  switch (mode) {
    case "SEA":
      return "SEA_TO_AIR";
    case "RAIL":
      return "RAIL_TO_ROAD";
    case "ROAD":
      return "ROAD_TO_AIR";
    case "MULTIMODAL":
      return "MULTIMODAL_TO_AIR";
    case "AIR":
      return "ROAD_TO_AIR";
  }
}

function computeLaneMitigationCost(params: {
  lane: SupplyLane;
  dailySpendEur: number;
  gapDays: number;
  switchingTier: SwitchingReadinessTier;
}): number {
  const { lane, dailySpendEur, gapDays, switchingTier } = params;
  if (gapDays <= 0) return 0;
  const shiftKey = selectExpeditingShiftKey(lane.transportMode);
  const freightMult =
    FINANCIAL_RISK_PARAMS_V1.expeditingFreightMultipliers[shiftKey].base;
  const swCfg = FINANCIAL_RISK_PARAMS_V1.switching[switchingTier];

  if (
    lane.ordinaryFreightCostPerUnitEur !== null &&
    lane.ordinaryFreightCostPerUnitEur !== undefined &&
    lane.annualVolume !== null &&
    lane.annualVolume > 0
  ) {
    const expQty = (lane.annualVolume / DAY_COUNT_BASIS) * gapDays;
    return expQty * lane.ordinaryFreightCostPerUnitEur * (freightMult - 1);
  }
  if (dailySpendEur > 0) {
    const modeMod =
      FINANCIAL_RISK_PARAMS_V1.transportModeModifiers[lane.transportMode];
    const expCost =
      dailySpendEur * gapDays * modeMod.freightCostShare * (freightMult - 1);
    const swCost =
      swCfg.eur[1] + dailySpendEur * gapDays * (swCfg.spotPremiumPct[1] / 100);
    return 0.65 * expCost + 0.35 * swCost;
  }
  return 0;
}

interface DiscreteLossPoint {
  loss: number;
  mass: number;
}

function computeQuantileVar(
  points: readonly DiscreteLossPoint[],
  alpha: number,
): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.loss - b.loss);
  let cumulative = 0;
  for (const pt of sorted) {
    cumulative += pt.mass;
    if (cumulative >= alpha - 1e-12) {
      return round2(Math.max(0, pt.loss));
    }
  }
  return round2(Math.max(0, sorted[sorted.length - 1]!.loss));
}

interface PortfolioEventGroup {
  eventKey: string;
  pHorizon: number;
  ttrSupport: [number, number, number, number];
  /** Loss per TTR support point j in {0,1,2,3} for this event group */
  orgLosses: [number, number, number, number];
  materialLosses: Map<string, [number, number, number, number]>;
  productLosses: Map<string, [number, number, number, number]>;
}

function aggregateCompetingEvents(
  events: readonly PortfolioEventGroup[],
): {
  orgEal: number;
  orgVar90: number;
  orgVar95: number;
  orgCondTailP90: number;
  materialEal: Map<string, number>;
  materialVar90: Map<string, number>;
  materialVar95: Map<string, number>;
  materialCondTailP90: Map<string, number>;
  productEal: Map<string, number>;
  productVar90: Map<string, number>;
  productVar95: Map<string, number>;
  productCondTailP90: Map<string, number>;
} {
  const hazards = events.map((ev) => {
    const p = clamp(ev.pHorizon, 0, 1);
    return p >= 1 ? Number.POSITIVE_INFINITY : -Math.log(1 - p);
  });
  const certainIndex = hazards.findIndex((h) => !Number.isFinite(h));
  const totalLambda =
    certainIndex >= 0
      ? Number.POSITIVE_INFINITY
      : hazards.reduce((s, h) => s + h, 0);
  const pAny =
    certainIndex >= 0
      ? 1
      : totalLambda > 0
        ? 1 - Math.exp(-totalLambda)
        : 0;

  const pis = events.map((_, idx) => {
    if (certainIndex >= 0) return idx === certainIndex ? 1 : 0;
    if (totalLambda <= 0) return 0;
    return pAny * (hazards[idx]! / totalLambda);
  });

  const sumPi = pis.reduce((s, x) => s + x, 0);
  const zeroMass = Math.max(0, 1 - sumPi);

  const orgPoints: DiscreteLossPoint[] = [{ loss: 0, mass: zeroMass }];
  let orgEal = 0;
  let orgCondTailP90 = 0;

  const matIds = new Set<string>();
  const prodIds = new Set<string>();
  for (const ev of events) {
    for (const mId of ev.materialLosses.keys()) matIds.add(mId);
    for (const pId of ev.productLosses.keys()) prodIds.add(pId);
  }

  const matPoints = new Map<string, DiscreteLossPoint[]>();
  const matEal = new Map<string, number>();
  const matCondTail = new Map<string, number>();
  for (const mId of matIds) {
    matPoints.set(mId, [{ loss: 0, mass: zeroMass }]);
    matEal.set(mId, 0);
    matCondTail.set(mId, 0);
  }

  const prodPoints = new Map<string, DiscreteLossPoint[]>();
  const prodEal = new Map<string, number>();
  const prodCondTail = new Map<string, number>();
  for (const pId of prodIds) {
    prodPoints.set(pId, [{ loss: 0, mass: zeroMass }]);
    prodEal.set(pId, 0);
    prodCondTail.set(pId, 0);
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const pi = pis[i]!;
    if (pi <= 0) continue;

    orgCondTailP90 = Math.max(orgCondTailP90, ev.orgLosses[1]);
    for (let j = 0; j < 4; j++) {
      const m = pi * WEIGHTS[j]!;
      orgEal += m * ev.orgLosses[j]!;
      orgPoints.push({ loss: ev.orgLosses[j]!, mass: m });
    }

    for (const mId of matIds) {
      const losses = ev.materialLosses.get(mId);
      if (!losses) {
        matPoints.get(mId)!.push({ loss: 0, mass: pi });
        continue;
      }
      matCondTail.set(mId, Math.max(matCondTail.get(mId)!, losses[1]));
      for (let j = 0; j < 4; j++) {
        const m = pi * WEIGHTS[j]!;
        matEal.set(mId, matEal.get(mId)! + m * losses[j]!);
        matPoints.get(mId)!.push({ loss: losses[j]!, mass: m });
      }
    }

    for (const pId of prodIds) {
      const losses = ev.productLosses.get(pId);
      if (!losses) {
        prodPoints.get(pId)!.push({ loss: 0, mass: pi });
        continue;
      }
      prodCondTail.set(pId, Math.max(prodCondTail.get(pId)!, losses[1]));
      for (let j = 0; j < 4; j++) {
        const m = pi * WEIGHTS[j]!;
        prodEal.set(pId, prodEal.get(pId)! + m * losses[j]!);
        prodPoints.get(pId)!.push({ loss: losses[j]!, mass: m });
      }
    }
  }

  const materialVar90 = new Map<string, number>();
  const materialVar95 = new Map<string, number>();
  for (const [mId, pts] of matPoints.entries()) {
    materialVar90.set(mId, computeQuantileVar(pts, 0.9));
    materialVar95.set(mId, computeQuantileVar(pts, 0.95));
  }

  const productVar90 = new Map<string, number>();
  const productVar95 = new Map<string, number>();
  for (const [pId, pts] of prodPoints.entries()) {
    productVar90.set(pId, computeQuantileVar(pts, 0.9));
    productVar95.set(pId, computeQuantileVar(pts, 0.95));
  }

  return {
    orgEal: round2(orgEal),
    orgVar90: computeQuantileVar(orgPoints, 0.9),
    orgVar95: computeQuantileVar(orgPoints, 0.95),
    orgCondTailP90: round2(orgCondTailP90),
    materialEal: new Map(
      Array.from(matEal.entries()).map(([k, v]) => [k, round2(v)]),
    ),
    materialVar90,
    materialVar95,
    materialCondTailP90: new Map(
      Array.from(matCondTail.entries()).map(([k, v]) => [k, round2(v)]),
    ),
    productEal: new Map(
      Array.from(prodEal.entries()).map(([k, v]) => [k, round2(v)]),
    ),
    productVar90,
    productVar95,
    productCondTailP90: new Map(
      Array.from(prodCondTail.entries()).map(([k, v]) => [k, round2(v)]),
    ),
  };
}

/**
 * Pure, deterministic end-to-end Financial Risk & Provisions computation.
 * Implements Level 0 -> Level 1 -> Level 2 progressive disclosure,
 * competing-first-event EAL & quantile VaR, TTS vs TTR gaps with renewal cliffs,
 * defect gross-up buffers, expediting/switching costs, and carrying-cost trade-offs.
 */
export function computeFinancialRiskSummary(
  input: FinancialRiskInput,
): FinancialRiskSummary {
  const contracts = input.contracts ?? [];
  const contractLines = input.contractLines ?? [];
  const riskSignals = input.riskSignals ?? [];

  const commercials = deriveNetworkCommercials(
    input.lanes,
    input.inputs,
    contracts,
    contractLines,
    {
      asOfDate: input.asOfDate,
      viewMode: input.viewMode ?? "PERIOD_WINDOW",
      windowStart: input.windowStart,
      windowEndExclusive: input.windowEndExclusive,
      fxRatesToEur: input.fxRatesToEur,
    },
  );

  const facilityById = new Map(input.facilities.map((f) => [f.facilityId, f]));
  const productById = new Map(input.products.map((p) => [p.productId, p]));
  const inputById = new Map(input.inputs.map((i) => [i.inputId, i]));

  const horizonDays =
    commercials.viewMode === "RUN_RATE"
      ? DAY_COUNT_BASIS
      : commercials.windowDays;

  // Determine per-lane live risk multiplier from matched RiskSignals if not overridden
  const resolveLaneLiveMultiplier = (lane: SupplyLane): number => {
    const override = input.liveRiskMultiplierByLaneId?.get(lane.laneId);
    if (override !== undefined && Number.isFinite(override)) {
      return clamp(override, 0, 5);
    }
    const fromFac = facilityById.get(lane.fromFacilityId);
    if (!fromFac) return 1;
    const matched = riskSignals.filter(
      (s) =>
        s.active &&
        s.lifecycle !== "RESOLVED" &&
        (s.affectedCountryCodes.includes(fromFac.countryCode) ||
          (fromFac.sector && s.affectedSectors.includes(fromFac.sector))),
    );
    return deriveLiveRiskMultiplierFromSignals(matched);
  };

  interface LaneRiskSpec {
    lane: SupplyLane;
    inputId: string | null;
    productId: string | null;
    corridor: CorridorBaselineKey;
    eventGroupKey: string;
    pHorizonBase: number;
    ttrSupport: [number, number, number, number];
    ttsDays: number | null;
    effectiveTtsBase: number;
    share: number;
    gammaUnmitigated: number;
    dailySpendEur: number;
    dailyMarginBaseEur: number | null;
    dailyMarginLowEur: number | null;
    dailyMarginHighEur: number | null;
    horizonMarginCapEur: number | null;
    isEstimatedProxy: boolean;
    hasMonetaryExposure: boolean;
    carryingCostPct: number;
    networkVerified: boolean;
    switchingTier: SwitchingReadinessTier;
  }

  // Count active non-lapsed lanes per material for warm-backup readiness
  const activeLanesByInput = new Map<string, SupplyLane[]>();
  for (const lane of input.lanes) {
    const summary = commercials.laneSummaries.get(lane.laneId);
    if (summary?.laneCommercialState === "LAPSED_UNCONTRACTED") continue;
    if (lane.inputId) {
      const arr = activeLanesByInput.get(lane.inputId) ?? [];
      arr.push(lane);
      activeLanesByInput.set(lane.inputId, arr);
    }
  }

  const laneSpecs: LaneRiskSpec[] = [];
  let anyNetworkVerified = false;
  let anyMonetaryExposure = false;
  let anyEstimatedProxy = false;
  let anyFormalContract = false;
  const orgMissingReasons = new Set<string>();

  for (const lane of input.lanes) {
    const laneComm = commercials.laneSummaries.get(lane.laneId)!;
    if (laneComm.laneCommercialState === "LAPSED_UNCONTRACTED") continue;

    if (laneComm.confidenceBadge === "CONTRACTED" || laneComm.confidenceBadge === "IMPORTED") {
      anyFormalContract = true;
    }

    const fromFac = facilityById.get(lane.fromFacilityId);
    const toFac = facilityById.get(lane.toFacilityId);
    const mat = lane.inputId ? inputById.get(lane.inputId) : undefined;
    const prod = mat?.productId ? productById.get(mat.productId) : undefined;
    const matComm = lane.inputId
      ? commercials.materialSummaries.get(lane.inputId)
      : undefined;

    const hidden =
      input.hiddenRiskByLaneId?.get(lane.laneId) ??
      input.hiddenRiskByLaneId?.get(lane.fromFacilityId);
    const networkVerified =
      Boolean(fromFac?.isPartnerVerified) || Boolean(hidden?.verified);
    if (networkVerified) anyNetworkVerified = true;

    const corridor = inferCorridorKey(
      fromFac?.countryCode ?? "DE",
      toFac?.countryCode ?? "EE",
      lane.transportMode,
    );
    const corridorPrior = FINANCIAL_RISK_PARAMS_V1.corridors[corridor];
    const modeMod = FINANCIAL_RISK_PARAMS_V1.transportModeModifiers[lane.transportMode];

    const liveMult = resolveLaneLiveMultiplier(lane);
    const hiddenProbMult = hidden?.hiddenProbabilityMultiplier ?? 1;
    const hiddenTtrMult = clamp(
      hidden?.hiddenTtrMultiplier ?? 1,
      FINANCIAL_RISK_PARAMS_V1.hiddenTtrMultiplierBounds[0],
      FINANCIAL_RISK_PARAMS_V1.hiddenTtrMultiplierBounds[1],
    );

    const pBase =
      lane.customAnnualDisruptionProb !== null &&
      lane.customAnnualDisruptionProb !== undefined
        ? lane.customAnnualDisruptionProb
        : corridorPrior.pBase;
    const isCertain = pBase >= 1;

    const pHorizonBase = computeEffectiveHorizonProb(
      pBase,
      lane.customAnnualDisruptionProb !== null &&
        lane.customAnnualDisruptionProb !== undefined
        ? 1
        : modeMod.probMultiplier,
      liveMult,
      hiddenProbMult,
      horizonDays,
      isCertain,
    );

    const baseTtrP50 =
      lane.customTtrDays !== null && lane.customTtrDays !== undefined
        ? lane.customTtrDays
        : corridorPrior.ttrP50 * modeMod.ttrMultiplier;
    const baseTtrP90 =
      lane.customTtrDays !== null && lane.customTtrDays !== undefined
        ? lane.customTtrDays * 2.2
        : corridorPrior.ttrP90 * modeMod.ttrMultiplier;
    const baseTtrP95 =
      lane.customTtrDays !== null && lane.customTtrDays !== undefined
        ? lane.customTtrDays * 3.0
        : corridorPrior.ttrP95 * modeMod.ttrMultiplier;

    const siblingCount = lane.inputId
      ? (activeLanesByInput.get(lane.inputId)?.length ?? 1)
      : 1;
    const switchingTier: SwitchingReadinessTier =
      siblingCount >= 2 ? "WARM_SECONDARY" : "UNQUALIFIED";

    // Apply renewal cliff TTR floor if material is in a renewal cliff (>30% expiring in 90d)
    const cliffFloorDays =
      matComm?.isRenewalCliff
        ? FINANCIAL_RISK_PARAMS_V1.switching[switchingTier].days[1] *
          (matComm.atRiskVolumePct / 100)
        : 0;

    const ttrP50 = Math.max(baseTtrP50 * hiddenTtrMult, cliffFloorDays);
    const ttrP90 = Math.max(baseTtrP90 * hiddenTtrMult, cliffFloorDays);
    const ttrP95 = Math.max(baseTtrP95 * hiddenTtrMult, cliffFloorDays);
    const ttrTail = ttrP95 * FINANCIAL_RISK_PARAMS_V1.ttrTailCapFactor;
    const ttrSupport: [number, number, number, number] = [
      ttrP50,
      ttrP90,
      ttrP95,
      ttrTail,
    ];

    const sharePct =
      laneComm.totalDemandSharePct ??
      laneComm.knownMappedSharePct ??
      lane.volumeSharePct;
    const share = clamp(sharePct / 100, 0, 1);

    const gammaUnmitigated =
      siblingCount >= 2 && share < 1
        ? clamp(
            1 -
              (FINANCIAL_RISK_PARAMS_V1.warmBackupSurgeSlack * (1 - share)) /
                Math.max(0.01, share),
            0.2,
            1.0,
          )
        : 1.0;

    const activeSpendInView = laneComm.activeSpendEur ?? 0;
    const dailySpendEur =
      activeSpendInView > 0 ? activeSpendInView / horizonDays : 0;

    const ttsMeasured =
      lane.safetyStockDays !== null && lane.safetyStockDays !== undefined
        ? lane.safetyStockDays
        : null;
    const effectiveTtsBase =
      ttsMeasured !== null
        ? ttsMeasured
        : FINANCIAL_RISK_PARAMS_V1.level1.defaultTtsDays;

    const carryingCostPct =
      lane.carryingCostPct ??
      toFac?.defaultCarryingCostPct ??
      FINANCIAL_RISK_PARAMS_V1.carryingCostPct.base;

    // Determine monetary exposure tier: Level 2 (actual product rev/margin) -> Level 1 (spend proxy) -> Level 0 (null)
    let dailyMarginBaseEur: number | null = null;
    let dailyMarginLowEur: number | null = null;
    let dailyMarginHighEur: number | null = null;
    let horizonMarginCapEur: number | null = null;
    let isEstimatedProxy = false;
    let hasMonetaryExposure = false;

    const criticality = mat?.materialCriticality ?? 1.0;

    if (
      prod &&
      prod.annualRevenueEur !== null &&
      prod.annualRevenueEur !== undefined &&
      prod.grossMarginPct !== null &&
      prod.grossMarginPct !== undefined
    ) {
      const annualMargin = prod.annualRevenueEur * (prod.grossMarginPct / 100);
      const gmPerDay = (annualMargin / DAY_COUNT_BASIS) * criticality;
      dailyMarginBaseEur = gmPerDay;
      dailyMarginLowEur = gmPerDay;
      dailyMarginHighEur = gmPerDay;
      horizonMarginCapEur = annualMargin * (horizonDays / DAY_COUNT_BASIS);
      hasMonetaryExposure = true;
    } else if (dailySpendEur > 0) {
      // Level 1 spend-to-margin proxy (explicitly flagged ESTIMATED_PROXY_EUR)
      const [lowF, baseF, highF] = FINANCIAL_RISK_PARAMS_V1.level1.spendToMarginFactor;
      const annualSpendEquiv = dailySpendEur * DAY_COUNT_BASIS;
      dailyMarginLowEur = (annualSpendEquiv * lowF) / DAY_COUNT_BASIS;
      dailyMarginBaseEur = (annualSpendEquiv * baseF) / DAY_COUNT_BASIS;
      dailyMarginHighEur = (annualSpendEquiv * highF) / DAY_COUNT_BASIS;
      horizonMarginCapEur =
        dailyMarginHighEur * horizonDays;
      isEstimatedProxy = true;
      hasMonetaryExposure = true;
      anyEstimatedProxy = true;
      orgMissingReasons.add("MISSING_PRODUCT_REVENUE_OR_MARGIN");
    } else {
      orgMissingReasons.add("MISSING_COMMERCIAL_DATA");
    }

    if (ttsMeasured === null) {
      orgMissingReasons.add("MISSING_SAFETY_STOCK_DAYS");
    }
    if (hasMonetaryExposure) anyMonetaryExposure = true;

    // Event group key deduplicates shared corridor/country shocks or opaque Tier-2+ chokepoints
    const eventGroupKey =
      hidden?.eventGroupId ??
      `${corridor}::${fromFac?.countryCode ?? "XX"}::${lane.transportMode}`;

    laneSpecs.push({
      lane,
      inputId: lane.inputId,
      productId: prod?.productId ?? null,
      corridor,
      eventGroupKey,
      pHorizonBase,
      ttrSupport,
      ttsDays: ttsMeasured,
      effectiveTtsBase,
      share,
      gammaUnmitigated,
      dailySpendEur,
      dailyMarginBaseEur,
      dailyMarginLowEur,
      dailyMarginHighEur,
      horizonMarginCapEur,
      isEstimatedProxy,
      hasMonetaryExposure,
      carryingCostPct,
      networkVerified,
      switchingTier,
    });
  }

  // Helper to evaluate a scenario ("low" | "base" | "high") across all event groups
  const buildEventGroups = (
    scenario: "low" | "base" | "high",
  ): PortfolioEventGroup[] => {
    const grouped = new Map<string, LaneRiskSpec[]>();
    for (const spec of laneSpecs) {
      if (!spec.hasMonetaryExposure) continue;
      const arr = grouped.get(spec.eventGroupKey) ?? [];
      arr.push(spec);
      grouped.set(spec.eventGroupKey, arr);
    }

    const groups: PortfolioEventGroup[] = [];
    for (const [eventKey, specs] of grouped.entries()) {
      const pRaw = Math.max(...specs.map((s) => s.pHorizonBase));
      const pHorizon =
        scenario === "low"
          ? clamp(
              pRaw * FINANCIAL_RISK_PARAMS_V1.sensitivity.pLow,
              0,
              FINANCIAL_RISK_PARAMS_V1.probabilityCap,
            )
          : scenario === "high"
            ? clamp(
                pRaw * FINANCIAL_RISK_PARAMS_V1.sensitivity.pHigh,
                0,
                FINANCIAL_RISK_PARAMS_V1.probabilityCap,
              )
            : pRaw;

      const ttrSupport: [number, number, number, number] = [
        Math.max(...specs.map((s) => s.ttrSupport[0])),
        Math.max(...specs.map((s) => s.ttrSupport[1])),
        Math.max(...specs.map((s) => s.ttrSupport[2])),
        Math.max(...specs.map((s) => s.ttrSupport[3])),
      ];

      const orgLosses: [number, number, number, number] = [0, 0, 0, 0];
      const matLosses = new Map<string, [number, number, number, number]>();
      const prodLosses = new Map<string, [number, number, number, number]>();

      for (let j = 0; j < 4; j++) {
        // For low sensitivity, evaluate at p50 (j=0); for high sensitivity, evaluate at stress tail (j=3)
        const ttrIdx = scenario === "low" ? 0 : scenario === "high" ? 3 : j;
        const prodBottleneckMargin = new Map<string, number>();
        let unattachedMarginLoss = 0;
        let totalMitigationLoss = 0;

        for (const s of specs) {
          const tts =
            scenario === "low"
              ? s.effectiveTtsBase + FINANCIAL_RISK_PARAMS_V1.sensitivity.ttsDeltaDays
              : scenario === "high"
                ? Math.max(
                    0,
                    s.effectiveTtsBase -
                      FINANCIAL_RISK_PARAMS_V1.sensitivity.ttsDeltaDays,
                  )
                : s.effectiveTtsBase;

          const gap = Math.min(
            horizonDays,
            Math.max(0, s.ttrSupport[ttrIdx]! - tts),
          );
          if (gap <= 0) continue;

          const dailyMargin =
            scenario === "low"
              ? (s.dailyMarginLowEur ?? 0)
              : scenario === "high"
                ? (s.dailyMarginHighEur ?? 0)
                : (s.dailyMarginBaseEur ?? 0);

          const effExposureShare = s.isEstimatedProxy
            ? s.gammaUnmitigated
            : s.share * s.gammaUnmitigated;
          const rawMarginLoss = gap * dailyMargin * effExposureShare;
          const cappedMarginLoss =
            s.horizonMarginCapEur !== null
              ? Math.min(s.horizonMarginCapEur, rawMarginLoss)
              : rawMarginLoss;

          // Mitigation cost: explicit freight quote first, else provisional alpha_freight + switching blend
          const mitigationCost = computeLaneMitigationCost({
            lane: s.lane,
            dailySpendEur: s.dailySpendEur,
            gapDays: gap,
            switchingTier: s.switchingTier,
          });

          totalMitigationLoss += mitigationCost;

          if (s.productId) {
            // Deduplicate product margin loss within a shared event group (worst bottleneck)
            const prev = prodBottleneckMargin.get(s.productId) ?? 0;
            prodBottleneckMargin.set(
              s.productId,
              Math.max(prev, cappedMarginLoss),
            );
          } else {
            unattachedMarginLoss += cappedMarginLoss;
          }

          if (s.inputId) {
            const arr = matLosses.get(s.inputId) ?? [0, 0, 0, 0];
            arr[j] = arr[j]! + cappedMarginLoss + mitigationCost;
            matLosses.set(s.inputId, arr);
          }
        }

        let sumProdMargin = 0;
        for (const [pId, mLoss] of prodBottleneckMargin.entries()) {
          sumProdMargin += mLoss;
          const arr = prodLosses.get(pId) ?? [0, 0, 0, 0];
          arr[j] = arr[j]! + mLoss;
          prodLosses.set(pId, arr);
        }

        // Attribute mitigation cost proportionally to products in this group
        if (totalMitigationLoss > 0 && prodBottleneckMargin.size > 0) {
          for (const pId of prodBottleneckMargin.keys()) {
            const arr = prodLosses.get(pId)!;
            arr[j] = arr[j]! + totalMitigationLoss / prodBottleneckMargin.size;
          }
        }

        orgLosses[j] = sumProdMargin + unattachedMarginLoss + totalMitigationLoss;
      }

      groups.push({
        eventKey,
        pHorizon,
        ttrSupport,
        orgLosses,
        materialLosses: matLosses,
        productLosses: prodLosses,
      });
    }

    // Add virtual SPOT_UNCONTRACTED ("Ghost Lane") events for materials with known positive uncontractedDemand
    for (const [inputId, matComm] of commercials.materialSummaries.entries()) {
      if (
        matComm.uncontractedDemand === null ||
        matComm.uncontractedDemand <= 0 ||
        matComm.uncontractedDemandPct === null
      ) {
        continue;
      }
      const mat = inputById.get(inputId);
      const prod = mat?.productId ? productById.get(mat.productId) : undefined;
      if (
        !prod ||
        prod.annualRevenueEur === null ||
        prod.annualRevenueEur === undefined ||
        prod.grossMarginPct === null ||
        prod.grossMarginPct === undefined
      ) {
        continue;
      }

      const ghostShare = clamp(matComm.uncontractedDemandPct / 100, 0, 1);
      const ghostCorridor = FINANCIAL_RISK_PARAMS_V1.corridors.EU_NORDIC_BALTIC_INTRA;
      const pGhostRaw = computeEffectiveHorizonProb(
        ghostCorridor.pBase,
        1,
        FINANCIAL_RISK_PARAMS_V1.spotGhost.probabilityMultiplier,
        1,
        horizonDays,
      );
      const pGhost =
        scenario === "low"
          ? pGhostRaw * FINANCIAL_RISK_PARAMS_V1.sensitivity.pLow
          : scenario === "high"
            ? Math.min(0.95, pGhostRaw * FINANCIAL_RISK_PARAMS_V1.sensitivity.pHigh)
            : pGhostRaw;

      const pen = FINANCIAL_RISK_PARAMS_V1.spotGhost.ttrPenaltyDays;
      const ttrSupport: [number, number, number, number] = [
        ghostCorridor.ttrP50 + pen,
        ghostCorridor.ttrP90 + pen,
        ghostCorridor.ttrP95 + pen,
        (ghostCorridor.ttrP95 + pen) * FINANCIAL_RISK_PARAMS_V1.ttrTailCapFactor,
      ];

      const gmPerDay =
        (prod.annualRevenueEur * (prod.grossMarginPct / 100)) / DAY_COUNT_BASIS;
      const losses: [number, number, number, number] = [0, 0, 0, 0];
      for (let j = 0; j < 4; j++) {
        const ttrIdx = scenario === "low" ? 0 : scenario === "high" ? 3 : j;
        const tts =
          scenario === "low"
            ? 14
            : scenario === "high"
              ? 0
              : FINANCIAL_RISK_PARAMS_V1.level1.defaultTtsDays;
        const gap = Math.min(horizonDays, Math.max(0, ttrSupport[ttrIdx]! - tts));
        losses[j] = gap * gmPerDay * ghostShare;
      }

      groups.push({
        eventKey: `SPOT_UNCONTRACTED::${inputId}`,
        pHorizon: pGhost,
        ttrSupport,
        orgLosses: losses,
        materialLosses: new Map([[inputId, losses]]),
        productLosses: new Map([[prod.productId, losses]]),
      });
    }

    return groups;
  };

  const baseAgg = anyMonetaryExposure
    ? aggregateCompetingEvents(buildEventGroups("base"))
    : null;
  const lowAgg = anyMonetaryExposure
    ? aggregateCompetingEvents(buildEventGroups("low"))
    : null;
  const highAgg = anyMonetaryExposure
    ? aggregateCompetingEvents(buildEventGroups("high"))
    : null;

  // Build MaterialFinancialRisk array
  const materials: MaterialFinancialRisk[] = input.inputs.map((mat) => {
    const matComm = commercials.materialSummaries.get(mat.inputId);
    const matSpecs = laneSpecs.filter((s) => s.inputId === mat.inputId);
    const matHasMonetary = matSpecs.some((s) => s.hasMonetaryExposure);
    const matIsProxy = matSpecs.some((s) => s.isEstimatedProxy);
    const matVerified = matSpecs.some((s) => s.networkVerified);

    const effTtrBase =
      matSpecs.length > 0
        ? round2(Math.max(...matSpecs.map((s) => s.ttrSupport[0])))
        : 0;
    const ttsList = matSpecs
      .map((s) => s.ttsDays)
      .filter((x): x is number => x !== null);
    const ttsDays = ttsList.length > 0 ? round2(Math.min(...ttsList)) : null;
    const ttsForGap =
      ttsDays !== null
        ? ttsDays
        : FINANCIAL_RISK_PARAMS_V1.level1.defaultTtsDays;
    const unprotectedGapDaysBase = round2(Math.max(0, effTtrBase - ttsForGap));

    const totalDailySpend = matSpecs.reduce((s, x) => s + x.dailySpendEur, 0);
    const avgCarryingPct =
      matSpecs.length > 0
        ? matSpecs.reduce((s, x) => s + x.carryingCostPct, 0) / matSpecs.length
        : FINANCIAL_RISK_PARAMS_V1.carryingCostPct.base;
    const carryingCostAnnualEur =
      totalDailySpend > 0 && ttsDays !== null
        ? round2(totalDailySpend * ttsDays * (avgCarryingPct / 100))
        : null;

    // Evaluate defect buffer on primary material volume
    const primaryLane = matSpecs[0]?.lane;
    const defectBuffer =
      matComm && matComm.mappedActiveVolume !== null && matComm.mappedActiveVolume > 0
        ? computeDefectBufferRecommendation({
            laneId: primaryLane?.laneId ?? null,
            inputId: mat.inputId,
            annualUsableVolume: matComm.mappedActiveVolume,
            defectRatePct: primaryLane?.defectRatePct,
            sectorOrCategory: mat.category,
            leadTimeDays: primaryLane?.leadTimeDays,
            unitPriceEur:
              matComm.mappedActiveVolume > 0 && matComm.mappedActiveSpendEur > 0
                ? matComm.mappedActiveSpendEur / matComm.mappedActiveVolume
                : null,
          })
        : null;

    // Candidate optimal safety stock days (simple marginal comparison up to TTR p50)
    let recommendedSafetyStockDays: number | null = null;
    if (matHasMonetary && totalDailySpend > 0 && effTtrBase > 0) {
      const matBaseEal = baseAgg?.materialEal.get(mat.inputId) ?? 0;
      const marginalDailyCarry = totalDailySpend * (avgCarryingPct / 100);
      const marginalDailyEal =
        unprotectedGapDaysBase > 0 ? matBaseEal / unprotectedGapDaysBase : 0;
      recommendedSafetyStockDays =
        marginalDailyEal > marginalDailyCarry
          ? Math.ceil(effTtrBase)
          : ttsForGap;
    }

    const matMissing: string[] = [];
    if (!matHasMonetary) matMissing.push("MISSING_COMMERCIAL_DATA");
    if (matIsProxy) matMissing.push("MISSING_PRODUCT_REVENUE_OR_MARGIN");
    if (ttsDays === null) matMissing.push("MISSING_SAFETY_STOCK_DAYS");
    if (matComm?.volumeIncomplete) matMissing.push("VOLUME_INCOMPLETE");
    if (matComm?.hasUnitConflict) matMissing.push("UNIT_CONFLICT");

    const badge: FinancialConfidenceBadge = matHasMonetary
      ? matIsProxy
        ? "ESTIMATED"
        : "HYBRID"
      : "ESTIMATED";

    return {
      inputId: mat.inputId,
      inputName: mat.name,
      baseUnit: mat.baseUnit ?? mat.unit,
      totalAnnualDemand: matComm?.totalAnnualDemand ?? null,
      mappedActiveVolume:
        matComm?.mappedActiveVolume !== null &&
        matComm?.mappedActiveVolume !== undefined
          ? round4(matComm.mappedActiveVolume)
          : null,
      uncontractedDemand:
        matComm?.uncontractedDemand !== null &&
        matComm?.uncontractedDemand !== undefined
          ? round4(matComm.uncontractedDemand)
          : null,
      uncontractedDemandPct:
        matComm?.uncontractedDemandPct !== null &&
        matComm?.uncontractedDemandPct !== undefined
          ? round2(matComm.uncontractedDemandPct)
          : null,
      isRenewalCliff: matComm?.isRenewalCliff ?? false,
      atRiskVolumePct: matComm?.atRiskVolumePct ?? 0,
      hasUnitConflict: matComm?.hasUnitConflict ?? false,
      unprotectedGapDaysBase,
      effectiveTtrDaysBase: effTtrBase,
      ttsDays,
      lowEur: matHasMonetary ? (lowAgg?.materialEal.get(mat.inputId) ?? 0) : null,
      baseEur: matHasMonetary
        ? (baseAgg?.materialEal.get(mat.inputId) ?? 0)
        : null,
      highEur: matHasMonetary
        ? (highAgg?.materialEal.get(mat.inputId) ?? 0)
        : null,
      varP90Eur: matHasMonetary
        ? (baseAgg?.materialVar90.get(mat.inputId) ?? 0)
        : null,
      varP95Eur: matHasMonetary
        ? (baseAgg?.materialVar95.get(mat.inputId) ?? 0)
        : null,
      conditionalTailLossP90Eur: matHasMonetary
        ? (baseAgg?.materialCondTailP90.get(mat.inputId) ?? 0)
        : null,
      expeditingCostBaseEur:
        matHasMonetary && unprotectedGapDaysBase > 0
          ? round2(
              matSpecs.reduce(
                (sum, spec) =>
                  sum +
                  computeLaneMitigationCost({
                    lane: spec.lane,
                    dailySpendEur: spec.dailySpendEur,
                    gapDays: Math.max(
                      0,
                      spec.ttrSupport[0] - spec.effectiveTtsBase,
                    ),
                    switchingTier: spec.switchingTier,
                  }),
                0,
              ),
            )
          : matHasMonetary
            ? 0
            : null,
      carryingCostAnnualEur,
      recommendedSafetyStockDays,
      defectBuffer,
      confidenceBadge: badge,
      networkVerified: matVerified,
      isEstimatedProxy: matIsProxy,
      missingReasons: matMissing,
    };
  });

  // Build ProductFinancialRisk array
  const products: ProductFinancialRisk[] = input.products.map((prod) => {
    const prodSpecs = laneSpecs.filter((s) => s.productId === prod.productId);
    const hasRevMargin =
      prod.annualRevenueEur !== null &&
      prod.annualRevenueEur !== undefined &&
      prod.grossMarginPct !== null &&
      prod.grossMarginPct !== undefined;
    const prodHasMonetary = prodSpecs.some((s) => s.hasMonetaryExposure);
    const prodIsProxy = prodSpecs.some((s) => s.isEstimatedProxy);
    const prodVerified = prodSpecs.some((s) => s.networkVerified);

    const missing: string[] = [];
    if (!hasRevMargin) missing.push("MISSING_PRODUCT_REVENUE_OR_MARGIN");
    if (!prodHasMonetary) missing.push("MISSING_COMMERCIAL_DATA");

    return {
      productId: prod.productId,
      productName: prod.name,
      annualRevenueEur: prod.annualRevenueEur ?? null,
      grossMarginPct: prod.grossMarginPct ?? null,
      lowEur: prodHasMonetary
        ? (lowAgg?.productEal.get(prod.productId) ?? 0)
        : null,
      baseEur: prodHasMonetary
        ? (baseAgg?.productEal.get(prod.productId) ?? 0)
        : null,
      highEur: prodHasMonetary
        ? (highAgg?.productEal.get(prod.productId) ?? 0)
        : null,
      varP90Eur: prodHasMonetary
        ? (baseAgg?.productVar90.get(prod.productId) ?? 0)
        : null,
      varP95Eur: prodHasMonetary
        ? (baseAgg?.productVar95.get(prod.productId) ?? 0)
        : null,
      conditionalTailLossP90Eur: prodHasMonetary
        ? (baseAgg?.productCondTailP90.get(prod.productId) ?? 0)
        : null,
      confidenceBadge: prodHasMonetary && hasRevMargin ? "HYBRID" : "ESTIMATED",
      networkVerified: prodVerified,
      isEstimatedProxy: prodIsProxy,
      missingReasons: missing,
    };
  });

  const laneCommercials = Array.from(commercials.laneSummaries.values());
  const totalActiveSpendEur = round2(
    laneCommercials.reduce((s, l) => s + (l.activeSpendEur ?? 0), 0),
  );
  const uncontractedMaterialCount = materials.filter(
    (m) => m.uncontractedDemand !== null && m.uncontractedDemand > 0,
  ).length;
  const renewalCliffCount = materials.filter((m) => m.isRenewalCliff).length;
  const lapsedLaneCount = laneCommercials.filter(
    (l) => l.laneCommercialState === "LAPSED_UNCONTRACTED",
  ).length;
  const holdoverLaneCount = laneCommercials.filter(
    (l) => l.laneCommercialState === "HOLDOVER",
  ).length;

  let missingInputsPrompt: string | null = null;
  if (!anyMonetaryExposure) {
    missingInputsPrompt =
      "Add lane annual spend or product revenue & gross margin to unlock € EAL and provision bands.";
  } else if (anyEstimatedProxy || orgMissingReasons.has("MISSING_SAFETY_STOCK_DAYS")) {
    missingInputsPrompt =
      "Add safety stock days & product gross margin to narrow this € EAL range.";
  }

  const orgBadge: FinancialConfidenceBadge =
    anyMonetaryExposure && (anyFormalContract || !anyEstimatedProxy)
      ? "HYBRID"
      : "ESTIMATED";

  const baseEur = anyMonetaryExposure ? (baseAgg?.orgEal ?? 0) : null;
  const annualizedBaseEalEur =
    baseEur !== null ? round2(baseEur * (DAY_COUNT_BASIS / horizonDays)) : null;

  return FinancialRiskSummarySchema.parse({
    benchmarkVersion: FINANCIAL_RISK_BENCHMARK_VERSION,
    viewMode: commercials.viewMode,
    asOfDate: commercials.asOfDate,
    windowStart: commercials.windowStart,
    windowEndExclusive: commercials.windowEndExclusive,
    lowEur: anyMonetaryExposure ? (lowAgg?.orgEal ?? 0) : null,
    baseEur,
    highEur: anyMonetaryExposure ? (highAgg?.orgEal ?? 0) : null,
    annualizedBaseEalEur,
    varP90Eur: anyMonetaryExposure ? (baseAgg?.orgVar90 ?? 0) : null,
    varP95Eur: anyMonetaryExposure ? (baseAgg?.orgVar95 ?? 0) : null,
    conditionalTailLossP90Eur: anyMonetaryExposure
      ? (baseAgg?.orgCondTailP90 ?? 0)
      : null,
    totalActiveSpendEur,
    uncontractedMaterialCount,
    renewalCliffCount,
    lapsedLaneCount,
    holdoverLaneCount,
    confidenceBadge: orgBadge,
    networkVerified: anyNetworkVerified,
    isEstimatedProxy: anyEstimatedProxy,
    missingInputsPrompt,
    missingReasons: Array.from(orgMissingReasons).sort(),
    laneCommercials,
    materials,
    products,
  });
}

/**
 * Computes stateless What-If financial deltas (EAL delta, carrying cost delta,
 * incremental working capital, true working-capital ROI %, and payback years).
 */
export function computeFinancialSimulationDelta(params: {
  baseline: FinancialRiskSummary;
  simulated: FinancialRiskSummary;
  baselineLanes: readonly SupplyLane[];
  simulatedLanes: readonly SupplyLane[];
  oneTimeQualificationEur?: number;
}): FinancialSimulationDelta {
  const { baseline, simulated } = params;

  const baseEalDeltaEur =
    baseline.baseEur !== null && simulated.baseEur !== null
      ? round2(simulated.baseEur - baseline.baseEur)
      : null;
  const lowEalDeltaEur =
    baseline.lowEur !== null && simulated.lowEur !== null
      ? round2(simulated.lowEur - baseline.lowEur)
      : null;
  const highEalDeltaEur =
    baseline.highEur !== null && simulated.highEur !== null
      ? round2(simulated.highEur - baseline.highEur)
      : null;
  const varP90DeltaEur =
    baseline.varP90Eur !== null && simulated.varP90Eur !== null
      ? round2(simulated.varP90Eur - baseline.varP90Eur)
      : null;

  // Compute working capital & carrying cost delta across lanes
  const baseLaneCommById = new Map(
    baseline.laneCommercials.map((l) => [l.laneId, l]),
  );
  const simLaneCommById = new Map(
    simulated.laneCommercials.map((l) => [l.laneId, l]),
  );

  const calcWorkingCapitalAndCarry = (
    lanes: readonly SupplyLane[],
    commMap: Map<string, FinancialRiskSummary["laneCommercials"][number]>,
  ) => {
    let wc = 0;
    let carry = 0;
    for (const lane of lanes) {
      const spend = commMap.get(lane.laneId)?.activeSpendEur ?? lane.annualSpendEur ?? 0;
      const tts =
        lane.safetyStockDays ?? FINANCIAL_RISK_PARAMS_V1.level1.defaultTtsDays;
      const h =
        (lane.carryingCostPct ?? FINANCIAL_RISK_PARAMS_V1.carryingCostPct.base) /
        100;
      if (spend > 0 && tts > 0) {
        const laneWc = (spend / DAY_COUNT_BASIS) * tts;
        wc += laneWc;
        carry += laneWc * h;
      }
    }
    return { wc, carry };
  };

  const baseStock = calcWorkingCapitalAndCarry(
    params.baselineLanes,
    baseLaneCommById,
  );
  const simStock = calcWorkingCapitalAndCarry(
    params.simulatedLanes,
    simLaneCommById,
  );

  const incrementalWorkingCapitalEur = round2(simStock.wc - baseStock.wc);
  const carryingCostDeltaEur = round2(simStock.carry - baseStock.carry);
  const otherRecurringCostDeltaEur = round2(
    simulated.totalActiveSpendEur - baseline.totalActiveSpendEur,
  );

  const ealReductionEur =
    baseEalDeltaEur !== null ? -baseEalDeltaEur : null;
  const netAnnualBenefitEur =
    ealReductionEur !== null
      ? round2(
          ealReductionEur - carryingCostDeltaEur - otherRecurringCostDeltaEur,
        )
      : null;

  const incrementalInvestment =
    Math.max(0, incrementalWorkingCapitalEur) +
    Math.max(0, params.oneTimeQualificationEur ?? 0);

  let workingCapitalRoiPct: number | null = null;
  let paybackYears: number | null = null;
  let paybackReason: string | null = null;

  if (netAnnualBenefitEur === null) {
    paybackReason = "MISSING_MONETARY_EXPOSURE";
  } else if (incrementalInvestment <= 0) {
    paybackReason = "NO_INCREMENTAL_CAPITAL_INVESTED";
  } else if (netAnnualBenefitEur <= 0) {
    workingCapitalRoiPct = round2(
      (netAnnualBenefitEur / incrementalInvestment) * 100,
    );
    paybackReason = "NO_POSITIVE_PAYBACK";
  } else {
    workingCapitalRoiPct = round2(
      (netAnnualBenefitEur / incrementalInvestment) * 100,
    );
    paybackYears = round2(incrementalInvestment / netAnnualBenefitEur);
  }

  return FinancialSimulationDeltaSchema.parse({
    baseEalDeltaEur,
    lowEalDeltaEur,
    highEalDeltaEur,
    varP90DeltaEur,
    carryingCostDeltaEur,
    incrementalWorkingCapitalEur,
    otherRecurringCostDeltaEur,
    netAnnualBenefitEur,
    workingCapitalRoiPct,
    paybackYears,
    paybackReason,
  });
}

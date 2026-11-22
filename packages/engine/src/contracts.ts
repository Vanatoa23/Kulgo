import { resolveLaneDirection } from "@kulgo/shared";
import type {
  Contract,
  ContractConfidence,
  ContractLifecycleState,
  ContractLine,
  DerivedLaneCommercialSummary,
  FinancialConfidenceBadge,
  FinancialViewMode,
  Facility,
  HhiWeightingBasis,
  LaneCommercialState,
  SupplyInput,
  SupplyLane,
  UnitFamily,
} from "@kulgo/shared";
import { FINANCIAL_RISK_PARAMS_V1 } from "./baselines.js";

const MS_PER_DAY = 86_400_000;
const DAY_COUNT_BASIS = FINANCIAL_RISK_PARAMS_V1.dayCountBasis;

export function parseIsoDateToUtcDay(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    throw new Error(`Invalid ISO civil date: ${isoDate}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${isoDate}`);
  }
  return Math.floor(utcMs / MS_PER_DAY);
}

export function formatUtcDay(dayIndex: number): string {
  const d = new Date(dayIndex * MS_PER_DAY);
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addCalendarMonthsUtc(isoDate: string, months: number): string {
  const dayIndex = parseIsoDateToUtcDay(isoDate);
  const d = new Date(dayIndex * MS_PER_DAY);
  const startYear = d.getUTCFullYear();
  const startMonth = d.getUTCMonth();
  const startDay = d.getUTCDate();

  const totalMonths = startYear * 12 + startMonth + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(startDay, lastDayOfTargetMonth);
  return formatUtcDay(
    Math.floor(Date.UTC(targetYear, targetMonth, clampedDay) / MS_PER_DAY),
  );
}

export function daysBetweenHalfOpen(
  startDay: number,
  endExclusiveDay: number,
): number {
  return Math.max(0, endExclusiveDay - startDay);
}

export function overlapDaysHalfOpen(
  aStart: number,
  aEndExclusive: number,
  bStart: number,
  bEndExclusive: number,
): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEndExclusive, bEndExclusive);
  return Math.max(0, end - start);
}

export function inferUnitFamily(unit: string): UnitFamily | null {
  const u = unit.trim().toUpperCase();
  if (u === "KG" || u === "TONNES" || u === "T" || u === "G" || u === "MG") {
    return "MASS";
  }
  if (u === "UNITS" || u === "PCS" || u === "PIECES" || u === "EA") {
    return "COUNT";
  }
  if (u === "LITERS" || u === "L" || u === "ML" || u === "M3") {
    return "VOLUME";
  }
  if (u === "M2" || u === "SQM") {
    return "AREA";
  }
  if (u === "EUR_VALUE" || u === "EUR") {
    return "CURRENCY";
  }
  return null;
}

const SI_MASS_TO_KG: Record<string, number> = {
  TONNES: 1000,
  T: 1000,
  KG: 1,
  G: 0.001,
  MG: 0.000001,
};

const SI_VOLUME_TO_LITERS: Record<string, number> = {
  M3: 1000,
  LITERS: 1,
  L: 1,
  ML: 0.001,
};

export function toBaseUnit(
  quantity: number | null | undefined,
  fromUnit: string,
  baseUnit: string,
  unitConversionFactors?: Readonly<Record<string, number>>,
): { value: number | null; unitConflict: boolean } {
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity)) {
    return { value: null, unitConflict: false };
  }
  const src = fromUnit.trim().toUpperCase();
  const dst = baseUnit.trim().toUpperCase();
  if (src === dst) {
    return { value: quantity, unitConflict: false };
  }

  if (unitConversionFactors) {
    const exactFactor =
      unitConversionFactors[fromUnit] ??
      unitConversionFactors[src] ??
      unitConversionFactors[fromUnit.trim()];
    if (
      exactFactor !== undefined &&
      Number.isFinite(exactFactor) &&
      exactFactor > 0
    ) {
      return { value: quantity * exactFactor, unitConflict: false };
    }
  }

  if (src in SI_MASS_TO_KG && dst in SI_MASS_TO_KG) {
    const kg = quantity * SI_MASS_TO_KG[src]!;
    return { value: kg / SI_MASS_TO_KG[dst]!, unitConflict: false };
  }

  if (src in SI_VOLUME_TO_LITERS && dst in SI_VOLUME_TO_LITERS) {
    const liters = quantity * SI_VOLUME_TO_LITERS[src]!;
    return { value: liters / SI_VOLUME_TO_LITERS[dst]!, unitConflict: false };
  }

  const srcFam = inferUnitFamily(src);
  const dstFam = inferUnitFamily(dst);
  if (srcFam === "COUNT" && dstFam === "COUNT") {
    return { value: quantity, unitConflict: false };
  }

  return { value: null, unitConflict: true };
}

export function toEur(
  nativeSpend: number | null | undefined,
  currency: string,
  fxRatesToEur?: Readonly<Record<string, number>>,
): { value: number | null; missingCurrency: string | null } {
  if (
    nativeSpend === null ||
    nativeSpend === undefined ||
    !Number.isFinite(nativeSpend)
  ) {
    return { value: null, missingCurrency: null };
  }
  const curr = currency.trim().toUpperCase();
  if (curr === "EUR") {
    return { value: nativeSpend, missingCurrency: null };
  }
  const rate = fxRatesToEur?.[curr];
  if (rate !== undefined && Number.isFinite(rate) && rate > 0) {
    return { value: nativeSpend * rate, missingCurrency: null };
  }
  return { value: null, missingCurrency: curr };
}

export interface ContractDerivationOptions {
  asOfDate: string;
  facilities?: readonly Facility[];
  /** Source quantities for simulations that will allocate their edited inputs later. */
  applyAllocationSplits?: boolean;
  /** Per-destination What-If spend, applied after allocation and before material totals. */
  annualSpendEurOverrides?: ReadonlyMap<string, number | null>;
  viewMode?: FinancialViewMode;
  windowStart?: string;
  windowEndExclusive?: string;
  fxRatesToEur?: Readonly<Record<string, number>>;
}

export interface EvaluatedContractLine {
  contract: Contract;
  line: ContractLine;
  lifecycleState: ContractLifecycleState;
  activeAtAsOf: boolean;
  overlapDays: number;
  dailyVolume: number | null;
  dailySpendEur: number | null;
  volumeInView: number | null;
  spendEurInView: number | null;
  unitConflict: boolean;
  missingCurrency: string | null;
  isAtRisk90d: boolean;
  isNoticeAtRisk90d: boolean;
  nextExpiryIso: string | null;
  nextNoticeDeadlineIso: string | null;
}

export interface MaterialCommercialDerivation {
  inputId: string;
  baseUnit: string;
  totalAnnualDemand: number | null;
  proRatedDemand: number | null;
  mappedActiveVolume: number | null;
  mappedActiveSpendEur: number;
  uncontractedDemand: number | null;
  uncontractedDemandPct: number | null;
  lowerBoundUncontractedDemand: number | null;
  isOvercontracted: boolean;
  volumeIncomplete: boolean;
  hasUnitConflict: boolean;
  atRiskVolumePct: number;
  isRenewalCliff: boolean;
  hasNoticeAtRisk: boolean;
  weightingBasis: HhiWeightingBasis | null;
}

export interface CommercialDerivationResult {
  asOfDate: string;
  viewMode: FinancialViewMode;
  windowStart: string;
  windowEndExclusive: string;
  windowDays: number;
  laneSummaries: Map<string, DerivedLaneCommercialSummary>;
  materialSummaries: Map<string, MaterialCommercialDerivation>;
  evaluatedLines: EvaluatedContractLine[];
}

function resolveLineNativeSpend(line: ContractLine): number | null {
  if (line.committedSpend !== null && Number.isFinite(line.committedSpend)) {
    return line.committedSpend;
  }
  if (
    line.committedVolume !== null &&
    line.unitPrice !== null &&
    Number.isFinite(line.committedVolume) &&
    Number.isFinite(line.unitPrice)
  ) {
    return line.committedVolume * line.unitPrice;
  }
  return null;
}

function summarizeConfidenceBadge(
  confidences: ContractConfidence[],
): FinancialConfidenceBadge {
  if (confidences.length === 0) return "ESTIMATED";
  const unique = new Set(confidences);
  if (unique.size === 1) {
    const only = confidences[0]!;
    return only;
  }
  return "HYBRID";
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Pure deterministic contract & commercial derivation for all lanes and materials.
 * Supports both Current Run-Rate (point-in-time annualized) and Period Window T
 * (exact UTC civil-day overlap), denominator-hygienic C_both unit pricing,
 * HOLDOVER/AUTO_RENEW/AUTO_ARCHIVE lifecycles, renewal cliffs (>30% in 90d),
 * and uncontracted demand ("Ghost Lane") detection.
 */
export function deriveNetworkCommercials(
  lanes: readonly SupplyLane[],
  inputs: readonly SupplyInput[],
  contracts: readonly Contract[],
  contractLines: readonly ContractLine[],
  options: ContractDerivationOptions,
): CommercialDerivationResult {
  const asOfDate = options.asOfDate;
  const asOfDay = parseIsoDateToUtcDay(asOfDate);
  const viewMode: FinancialViewMode = options.viewMode ?? "PERIOD_WINDOW";
  const windowStart = options.windowStart ?? asOfDate;
  const windowEndExclusive =
    options.windowEndExclusive ??
    addCalendarMonthsUtc(
      windowStart,
      FINANCIAL_RISK_PARAMS_V1.defaultWindowCalendarMonths,
    );
  const windowStartDay = parseIsoDateToUtcDay(windowStart);
  const windowEndDay = parseIsoDateToUtcDay(windowEndExclusive);
  const windowDays = Math.max(
    1,
    daysBetweenHalfOpen(windowStartDay, windowEndDay),
  );
  const fx = options.fxRatesToEur;
  const lookaheadDays = FINANCIAL_RISK_PARAMS_V1.renewalCliff.lookaheadDays;

  const contractById = new Map(contracts.map((c) => [c.contractId, c]));
  const inputById = new Map(inputs.map((i) => [i.inputId, i]));

  // Group lines by laneId
  const linesByLane = new Map<string, ContractLine[]>();
  for (const line of contractLines) {
    const arr = linesByLane.get(line.laneId) ?? [];
    arr.push(line);
    linesByLane.set(line.laneId, arr);
  }

  const evaluatedLines: EvaluatedContractLine[] = [];
  const rawLaneMap = new Map<
    string,
    {
      lane: SupplyLane;
      baseUnit: string;
      state: LaneCommercialState;
      activeVolume: number | null;
      activeSpendEur: number | null;
      cBothVolume: number;
      cBothSpendEur: number;
      spendOnlyExcludedEur: number;
      assumedHoldoverVolume: number;
      atRiskRunRateVolume: number;
      totalRunRateVolume: number;
      atRiskRunRateSpend: number;
      totalRunRateSpend: number;
      hasUnitConflict: boolean;
      hasNoticeAtRisk: boolean;
      missingFxCurrencies: Set<string>;
      nextExpirationDay: number | null;
      nextNoticeDay: number | null;
      activeContractIds: Set<string>;
      activeConfidences: ContractConfidence[];
    }
  >();

  for (const lane of lanes) {
    const input = lane.inputId ? inputById.get(lane.inputId) : undefined;
    const baseUnit = input?.baseUnit ?? input?.unit ?? lane.volumeUnit;
    const conversionFactors = input?.unitConversionFactors;
    const laneLines = linesByLane.get(lane.laneId) ?? [];

    // Double-counting guardrail: if any non-archived FRAMEWORK or SPOT_PO exists on lane,
    // implicit ESTIMATE contracts on the same lane are archived.
    const hasFormalContract = laneLines.some((l) => {
      const c = contractById.get(l.contractId);
      return (
        c !== undefined &&
        !c.isManuallyArchived &&
        (c.contractType === "FRAMEWORK" || c.contractType === "SPOT_PO")
      );
    });

    let volumeSum = 0;
    let hasAnyValidVolume = false;
    let spendSum = 0;
    let hasAnyValidSpend = false;
    let cBothVolume = 0;
    let cBothSpendEur = 0;
    let spendOnlyExcludedEur = 0;
    let assumedHoldoverVolume = 0;
    let atRiskRunRateVolume = 0;
    let totalRunRateVolume = 0;
    let atRiskRunRateSpend = 0;
    let totalRunRateSpend = 0;
    let hasUnitConflict = false;
    let hasNoticeAtRisk = false;
    let hasHoldoverLine = false;
    let hasExpiredArchiveLine = false;
    const missingFxCurrencies = new Set<string>();
    let nextExpirationDay: number | null = null;
    let nextNoticeDay: number | null = null;
    const activeContractIds = new Set<string>();
    const activeConfidences: ContractConfidence[] = [];

    // If no ContractLine records exist on the lane, check legacy/Level-1 direct lane fields
    if (laneLines.length === 0) {
      const hasLegacyCommercials =
        (lane.annualVolume !== null && lane.annualVolume > 0) ||
        (lane.annualSpendEur !== null && lane.annualSpendEur > 0);

      if (hasLegacyCommercials) {
        const volRes = toBaseUnit(
          lane.annualVolume,
          lane.volumeUnit,
          baseUnit,
          conversionFactors,
        );
        if (volRes.unitConflict) hasUnitConflict = true;
        const scale = viewMode === "RUN_RATE" ? 1 : windowDays / DAY_COUNT_BASIS;
        if (volRes.value !== null && volRes.value > 0) {
          hasAnyValidVolume = true;
          volumeSum = volRes.value * scale;
          totalRunRateVolume = volRes.value;
        }
        if (lane.annualSpendEur !== null && lane.annualSpendEur >= 0) {
          hasAnyValidSpend = true;
          spendSum = lane.annualSpendEur * scale;
          totalRunRateSpend = lane.annualSpendEur;
        }
        if (hasAnyValidVolume && hasAnyValidSpend) {
          cBothVolume = volumeSum;
          cBothSpendEur = spendSum;
        } else if (hasAnyValidSpend && !hasAnyValidVolume) {
          spendOnlyExcludedEur = spendSum;
        }
        if (lane.contractEndDate) {
          const endDay = parseIsoDateToUtcDay(lane.contractEndDate);
          const daysUntil = endDay - asOfDay;
          if (daysUntil >= 0) {
            nextExpirationDay = endDay;
            if (daysUntil <= lookaheadDays) {
              atRiskRunRateVolume = totalRunRateVolume;
              atRiskRunRateSpend = totalRunRateSpend;
            }
          }
        }
        activeConfidences.push("ESTIMATED");
      }

      rawLaneMap.set(lane.laneId, {
        lane,
        baseUnit,
        state: hasLegacyCommercials ? "ACTIVE" : "LEVEL_0_UNPRICED",
        activeVolume: hasAnyValidVolume ? volumeSum : null,
        activeSpendEur: hasAnyValidSpend ? spendSum : null,
        cBothVolume,
        cBothSpendEur,
        spendOnlyExcludedEur,
        assumedHoldoverVolume: 0,
        atRiskRunRateVolume,
        totalRunRateVolume,
        atRiskRunRateSpend,
        totalRunRateSpend,
        hasUnitConflict,
        hasNoticeAtRisk: false,
        missingFxCurrencies,
        nextExpirationDay,
        nextNoticeDay: null,
        activeContractIds,
        activeConfidences,
      });
      continue;
    }

    for (const line of laneLines) {
      const contract = contractById.get(line.contractId);
      if (!contract) continue;

      const startIso = line.startDateOverride ?? contract.startDate;
      const endIso = line.endDateOverride ?? contract.endDate;
      const startDay = parseIsoDateToUtcDay(startIso);
      const signedEndExclusiveDay = endIso
        ? parseIsoDateToUtcDay(endIso) + 1
        : null;
      const archiveDay = contract.archiveEffectiveDate
        ? parseIsoDateToUtcDay(contract.archiveEffectiveDate)
        : null;

      let lifecycleState: ContractLifecycleState = "ACTIVE";
      let effEndExclusiveDay: number = Number.POSITIVE_INFINITY;

      if (contract.isManuallyArchived) {
        lifecycleState = "ARCHIVED_MANUAL";
        effEndExclusiveDay = archiveDay ?? startDay;
      } else if (hasFormalContract && contract.contractType === "ESTIMATE") {
        lifecycleState = "ARCHIVED_BY_FRAMEWORK";
        effEndExclusiveDay = archiveDay ?? startDay;
      } else if (asOfDay < startDay) {
        lifecycleState = "SCHEDULED";
        if (contract.expiryBehavior === "AUTO_ARCHIVE" && signedEndExclusiveDay !== null) {
          effEndExclusiveDay = signedEndExclusiveDay;
        } else if (
          contract.expiryBehavior === "AUTO_RENEW" &&
          contract.nonRenewalNoticeGiven &&
          signedEndExclusiveDay !== null
        ) {
          effEndExclusiveDay = signedEndExclusiveDay;
        }
      } else if (signedEndExclusiveDay !== null) {
        if (contract.expiryBehavior === "AUTO_ARCHIVE") {
          effEndExclusiveDay = signedEndExclusiveDay;
          if (asOfDay >= signedEndExclusiveDay) {
            lifecycleState = "ARCHIVED_EXPIRED";
            hasExpiredArchiveLine = true;
          }
        } else if (contract.expiryBehavior === "HOLDOVER") {
          if (archiveDay !== null) {
            effEndExclusiveDay = archiveDay;
            if (asOfDay >= archiveDay) {
              lifecycleState = "ARCHIVED_MANUAL";
              hasExpiredArchiveLine = true;
            }
          } else {
            effEndExclusiveDay = Number.POSITIVE_INFINITY;
            if (asOfDay >= signedEndExclusiveDay) {
              lifecycleState = "EXPIRED_ASSUMED_HOLDOVER";
              hasHoldoverLine = true;
            }
          }
        } else if (contract.expiryBehavior === "AUTO_RENEW") {
          if (contract.nonRenewalNoticeGiven) {
            effEndExclusiveDay = signedEndExclusiveDay;
            if (asOfDay >= signedEndExclusiveDay) {
              lifecycleState = "ARCHIVED_EXPIRED";
              hasExpiredArchiveLine = true;
            }
          } else {
            effEndExclusiveDay = archiveDay ?? Number.POSITIVE_INFINITY;
          }
        }
      }

      if (archiveDay !== null && archiveDay < effEndExclusiveDay) {
        effEndExclusiveDay = archiveDay;
      }

      // Compute daily rates
      const termDays =
        signedEndExclusiveDay !== null
          ? Math.max(1, daysBetweenHalfOpen(startDay, signedEndExclusiveDay))
          : DAY_COUNT_BASIS;

      const volRes = toBaseUnit(
        line.committedVolume,
        line.unit,
        baseUnit,
        conversionFactors,
      );
      if (volRes.unitConflict) hasUnitConflict = true;

      const nativeSpend = resolveLineNativeSpend(line);
      const eurRes = toEur(nativeSpend, line.currency, fx);
      if (eurRes.missingCurrency) {
        missingFxCurrencies.add(eurRes.missingCurrency);
      }

      const rateDenom =
        line.cadence === "TOTAL_OVER_TERM" ? termDays : DAY_COUNT_BASIS;

      const dailyVolume =
        volRes.value !== null ? volRes.value / rateDenom : null;
      const dailySpendEur =
        eurRes.value !== null ? eurRes.value / rateDenom : null;

      const isActiveAtAsOf =
        lifecycleState !== "ARCHIVED_MANUAL" &&
        lifecycleState !== "ARCHIVED_BY_FRAMEWORK" &&
        lifecycleState !== "ARCHIVED_EXPIRED" &&
        asOfDay >= startDay &&
        asOfDay < effEndExclusiveDay;

      const overlapDays =
        lifecycleState === "ARCHIVED_MANUAL" ||
        lifecycleState === "ARCHIVED_BY_FRAMEWORK"
          ? 0
          : overlapDaysHalfOpen(
              startDay,
              effEndExclusiveDay,
              windowStartDay,
              windowEndDay,
            );

      const volumeInView =
        dailyVolume !== null
          ? viewMode === "RUN_RATE"
            ? isActiveAtAsOf
              ? dailyVolume * DAY_COUNT_BASIS
              : 0
            : dailyVolume * overlapDays
          : null;

      const spendEurInView =
        dailySpendEur !== null
          ? viewMode === "RUN_RATE"
            ? isActiveAtAsOf
              ? dailySpendEur * DAY_COUNT_BASIS
              : 0
            : dailySpendEur * overlapDays
          : null;

      // Renewal cliff & notice deadline tracking
      let isAtRisk90d = false;
      let isNoticeAtRisk90d = false;
      let lineNextExpiryDay: number | null = null;
      let lineNextNoticeDay: number | null = null;

      if (isActiveAtAsOf && signedEndExclusiveDay !== null) {
        const inclusiveEndDay = signedEndExclusiveDay - 1;
        if (lifecycleState === "EXPIRED_ASSUMED_HOLDOVER") {
          isAtRisk90d = true;
          lineNextExpiryDay = inclusiveEndDay;
        } else if (
          contract.expiryBehavior === "AUTO_ARCHIVE" ||
          (contract.expiryBehavior === "AUTO_RENEW" &&
            contract.nonRenewalNoticeGiven)
        ) {
          lineNextExpiryDay = inclusiveEndDay;
          const daysUntilEnd = signedEndExclusiveDay - asOfDay;
          if (daysUntilEnd > 0 && daysUntilEnd <= lookaheadDays) {
            isAtRisk90d = true;
          }
        } else if (
          contract.expiryBehavior === "AUTO_RENEW" &&
          contract.noticePeriodDays > 0
        ) {
          // Find current cycle's notice deadline >= asOfDay
          let cycleEndExcl = signedEndExclusiveDay;
          while (cycleEndExcl <= asOfDay) {
            cycleEndExcl += termDays;
          }
          const noticeDay = cycleEndExcl - contract.noticePeriodDays;
          lineNextNoticeDay = noticeDay;
          const daysUntilNotice = noticeDay - asOfDay;
          if (daysUntilNotice >= 0 && daysUntilNotice <= lookaheadDays) {
            isNoticeAtRisk90d = true;
            hasNoticeAtRisk = true;
          }
        }
      }

      if (
        lineNextExpiryDay !== null &&
        (nextExpirationDay === null || lineNextExpiryDay < nextExpirationDay)
      ) {
        nextExpirationDay = lineNextExpiryDay;
      }
      if (
        lineNextNoticeDay !== null &&
        (nextNoticeDay === null || lineNextNoticeDay < nextNoticeDay)
      ) {
        nextNoticeDay = lineNextNoticeDay;
      }

      const contributesInView =
        viewMode === "RUN_RATE" ? isActiveAtAsOf : overlapDays > 0;

      if (contributesInView) {
        activeContractIds.add(contract.contractId);
        activeConfidences.push(contract.confidence);

        if (volumeInView !== null && volumeInView > 0) {
          hasAnyValidVolume = true;
          volumeSum += volumeInView;
          if (lifecycleState === "EXPIRED_ASSUMED_HOLDOVER") {
            assumedHoldoverVolume += volumeInView;
          }
        }
        if (spendEurInView !== null && spendEurInView >= 0) {
          hasAnyValidSpend = true;
          spendSum += spendEurInView;
        }

        // Denominator-hygienic C_both: strictly lines with BOTH positive volume AND known spend
        if (
          volumeInView !== null &&
          volumeInView > 0 &&
          spendEurInView !== null &&
          spendEurInView >= 0
        ) {
          cBothVolume += volumeInView;
          cBothSpendEur += spendEurInView;
        } else if (
          (volumeInView === null || volumeInView <= 0) &&
          spendEurInView !== null &&
          spendEurInView > 0
        ) {
          spendOnlyExcludedEur += spendEurInView;
        }
      }

      if (isActiveAtAsOf) {
        if (dailyVolume !== null && dailyVolume > 0) {
          const rrVol = dailyVolume * DAY_COUNT_BASIS;
          totalRunRateVolume += rrVol;
          if (isAtRisk90d) atRiskRunRateVolume += rrVol;
        }
        if (dailySpendEur !== null && dailySpendEur > 0) {
          const rrSpend = dailySpendEur * DAY_COUNT_BASIS;
          totalRunRateSpend += rrSpend;
          if (isAtRisk90d) atRiskRunRateSpend += rrSpend;
        }
      }

      evaluatedLines.push({
        contract,
        line,
        lifecycleState,
        activeAtAsOf: isActiveAtAsOf,
        overlapDays,
        dailyVolume,
        dailySpendEur,
        volumeInView,
        spendEurInView,
        unitConflict: volRes.unitConflict,
        missingCurrency: eurRes.missingCurrency,
        isAtRisk90d,
        isNoticeAtRisk90d,
        nextExpiryIso:
          lineNextExpiryDay !== null ? formatUtcDay(lineNextExpiryDay) : null,
        nextNoticeDeadlineIso:
          lineNextNoticeDay !== null ? formatUtcDay(lineNextNoticeDay) : null,
      });
    }

    let state: LaneCommercialState = "ACTIVE";
    if (activeContractIds.size === 0) {
      state = hasExpiredArchiveLine ? "LAPSED_UNCONTRACTED" : "LEVEL_0_UNPRICED";
    } else if (hasHoldoverLine) {
      state = "HOLDOVER";
    }

    rawLaneMap.set(lane.laneId, {
      lane,
      baseUnit,
      state,
      activeVolume: hasAnyValidVolume ? volumeSum : null,
      activeSpendEur: hasAnyValidSpend ? spendSum : null,
      cBothVolume,
      cBothSpendEur,
      spendOnlyExcludedEur,
      assumedHoldoverVolume,
      atRiskRunRateVolume,
      totalRunRateVolume,
      atRiskRunRateSpend,
      totalRunRateSpend,
      hasUnitConflict,
      hasNoticeAtRisk,
      missingFxCurrencies,
      nextExpirationDay,
      nextNoticeDay,
      activeContractIds,
      activeConfidences,
    });
  }

  // Apply allocationSplitPct to derived active quantities across sibling split groups
  // (same origin facility, direction, and material) WITHOUT mutating signed ContractLines.
  const splitGroups = new Map<string, SupplyLane[]>();
  const facilitiesById = new Map(options.facilities?.map((f) => [f.facilityId, f]));
  for (const lane of lanes) {
    const dir = resolveLaneDirection(
      lane,
      facilitiesById.get(lane.fromFacilityId),
      facilitiesById.get(lane.toFacilityId),
    );
    const matKey = lane.inputId ?? lane.materialCategory.trim().toLowerCase();
    const key = `${lane.fromFacilityId}::${dir}::${matKey}`;
    const arr = splitGroups.get(key) ?? [];
    arr.push(lane);
    splitGroups.set(key, arr);
  }

  for (const groupLanes of options.applyAllocationSplits === false ? [] : splitGroups.values()) {
    if (groupLanes.length < 2) continue;
    if (
      !groupLanes.every(
        (l) =>
          l.allocationSplitPct !== null &&
          l.allocationSplitPct !== undefined &&
          Number.isFinite(l.allocationSplitPct),
      )
    ) {
      continue;
    }
    const splitSum = groupLanes.reduce(
      (s, l) => s + (l.allocationSplitPct ?? 0),
      0,
    );
    if (Math.abs(splitSum - 100) > 0.5) continue;

    const rawEntries = groupLanes
      .map((l) => rawLaneMap.get(l.laneId))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
    const nonLapsed = rawEntries.filter((r) => r.state !== "LAPSED_UNCONTRACTED");
    if (nonLapsed.length === 0) continue;
    // Lapsed destinations cannot receive active commercials. Normalize over the
    // eligible destinations so their percentages cannot make the pool disappear.
    const eligibleSplitSum = nonLapsed.reduce(
      (sum, r) => sum + (r.lane.allocationSplitPct ?? 0), 0,
    );
    // With no eligible allocation, retain the original active quantities.
    if (eligibleSplitSum <= 0) continue;

    // Pool volume in a common reference unit (the first lane's baseUnit)
    const refUnit = nonLapsed[0]!.baseUnit;
    let canPoolVolume = true;
    let anyVolume = false;
    let pooledVolInRef = 0;
    let pooledCBothVolInRef = 0;
    let pooledHoldoverVolInRef = 0;
    let pooledAtRiskRunRateVolInRef = 0;
    let pooledTotalRunRateVolInRef = 0;

    for (const r of nonLapsed) {
      if (r.hasUnitConflict) {
        canPoolVolume = false;
        break;
      }
      const conv = toBaseUnit(1, r.baseUnit, refUnit);
      if (conv.unitConflict || conv.value === null) {
        canPoolVolume = false;
        break;
      }
      const factor = conv.value;
      if (r.activeVolume !== null) {
        anyVolume = true;
        pooledVolInRef += r.activeVolume * factor;
      }
      pooledCBothVolInRef += r.cBothVolume * factor;
      pooledHoldoverVolInRef += r.assumedHoldoverVolume * factor;
      pooledAtRiskRunRateVolInRef += r.atRiskRunRateVolume * factor;
      pooledTotalRunRateVolInRef += r.totalRunRateVolume * factor;
    }

    const anySpend = nonLapsed.some((r) => r.activeSpendEur !== null);
    const pooledSpend = nonLapsed.reduce((s, r) => s + (r.activeSpendEur ?? 0), 0);
    const pooledCBothSpend = nonLapsed.reduce((s, r) => s + r.cBothSpendEur, 0);
    const pooledSpendOnlyExcluded = nonLapsed.reduce(
      (s, r) => s + r.spendOnlyExcludedEur,
      0,
    );
    const pooledAtRiskRunRateSpend = nonLapsed.reduce(
      (s, r) => s + r.atRiskRunRateSpend,
      0,
    );
    const pooledTotalRunRateSpend = nonLapsed.reduce(
      (s, r) => s + r.totalRunRateSpend,
      0,
    );

    const groupContractIds = new Set<string>();
    const groupConfidences = new Set<ContractConfidence>();
    let groupHasActiveContract = false;
    let groupHasHoldover = false;
    for (const r of nonLapsed) {
      if (r.state === "ACTIVE" || r.state === "HOLDOVER") {
        groupHasActiveContract = true;
      }
      if (r.state === "HOLDOVER") {
        groupHasHoldover = true;
      }
      for (const cid of r.activeContractIds) groupContractIds.add(cid);
      for (const conf of r.activeConfidences) groupConfidences.add(conf);
    }

    for (const r of rawEntries) {
      if (r.state === "LAPSED_UNCONTRACTED") continue;
      const frac = (r.lane.allocationSplitPct ?? 0) / eligibleSplitSum;

      if (canPoolVolume && anyVolume) {
        const backConv = toBaseUnit(1, refUnit, r.baseUnit);
        const invFactor = backConv.value ?? 1;
        r.activeVolume = pooledVolInRef * frac * invFactor;
        r.cBothVolume = pooledCBothVolInRef * frac * invFactor;
        r.assumedHoldoverVolume = pooledHoldoverVolInRef * frac * invFactor;
        r.atRiskRunRateVolume = pooledAtRiskRunRateVolInRef * frac * invFactor;
        r.totalRunRateVolume = pooledTotalRunRateVolInRef * frac * invFactor;
      }
      if (anySpend) {
        r.activeSpendEur = pooledSpend * frac;
        r.cBothSpendEur = pooledCBothSpend * frac;
        r.spendOnlyExcludedEur = pooledSpendOnlyExcluded * frac;
        r.atRiskRunRateSpend = pooledAtRiskRunRateSpend * frac;
        r.totalRunRateSpend = pooledTotalRunRateSpend * frac;
      }
      if (r.state === "LEVEL_0_UNPRICED" && groupHasActiveContract && frac > 0) {
        r.state = groupHasHoldover ? "HOLDOVER" : "ACTIVE";
        for (const cid of groupContractIds) r.activeContractIds.add(cid);
        for (const conf of groupConfidences) {
          if (!r.activeConfidences.includes(conf)) {
            r.activeConfidences.push(conf);
          }
        }
      }
    }
  }

  // A scenario override names a destination, not an additional source for its
  // allocation group. Recompute spend-dependent aggregates before deriving shares.
  for (const [laneId, annualSpend] of options.annualSpendEurOverrides ?? []) {
    const raw = rawLaneMap.get(laneId);
    if (!raw || raw.state === "LAPSED_UNCONTRACTED") continue;
    const nextSpend = annualSpend === null ? null
      : annualSpend * (viewMode === "RUN_RATE" ? 1 : windowDays / DAY_COUNT_BASIS);
    const previousSpend = raw.activeSpendEur;
    if (nextSpend === previousSpend) continue;
    if (previousSpend !== null && previousSpend > 0 && nextSpend !== null) {
      const ratio = nextSpend / previousSpend;
      raw.cBothSpendEur *= ratio;
      raw.spendOnlyExcludedEur *= ratio;
      raw.atRiskRunRateSpend *= ratio;
      raw.totalRunRateSpend *= ratio;
    } else {
      const hasVolume = raw.activeVolume !== null && raw.activeVolume > 0;
      raw.cBothVolume = nextSpend !== null && hasVolume ? raw.activeVolume! : 0;
      raw.cBothSpendEur = hasVolume ? (nextSpend ?? 0) : 0;
      raw.spendOnlyExcludedEur = hasVolume ? 0 : (nextSpend ?? 0);
      const atRiskFraction = raw.totalRunRateVolume > 0
        ? raw.atRiskRunRateVolume / raw.totalRunRateVolume
        : raw.nextExpirationDay !== null && raw.nextExpirationDay - asOfDay <= lookaheadDays ? 1 : 0;
      raw.totalRunRateSpend = annualSpend ?? 0;
      raw.atRiskRunRateSpend = raw.totalRunRateSpend * atRiskFraction;
    }
    raw.activeSpendEur = nextSpend;
    if (raw.state === "LEVEL_0_UNPRICED" && nextSpend !== null && nextSpend > 0) {
      raw.state = "ACTIVE";
      if (raw.activeConfidences.length === 0) raw.activeConfidences.push("ESTIMATED");
    }
  }

  // Group lanes by material inputId to derive shares, uncontracted demand, and renewal cliffs
  const materialSummaries = new Map<string, MaterialCommercialDerivation>();
  const lanesByInput = new Map<string, string[]>();
  for (const lane of lanes) {
    if (!lane.inputId) continue;
    const arr = lanesByInput.get(lane.inputId) ?? [];
    arr.push(lane.laneId);
    lanesByInput.set(lane.inputId, arr);
  }

  const laneShareInfo = new Map<
    string,
    {
      knownMappedSharePct: number | null;
      totalDemandSharePct: number | null;
      weightingBasis: HhiWeightingBasis | null;
    }
  >();

  for (const input of inputs) {
    const laneIds = lanesByInput.get(input.inputId) ?? [];
    const baseUnit = input.baseUnit ?? input.unit;
    const activeRawLanes = laneIds
      .map((id) => rawLaneMap.get(id)!)
      .filter((r) => r.state !== "LAPSED_UNCONTRACTED");

    const hasUnitConflict = activeRawLanes.some((r) => r.hasUnitConflict);
    const allHaveVolume =
      activeRawLanes.length > 0 &&
      !hasUnitConflict &&
      activeRawLanes.every((r) => r.activeVolume !== null && r.activeVolume > 0);
    const anyHasVolume =
      !hasUnitConflict &&
      activeRawLanes.some((r) => r.activeVolume !== null && r.activeVolume > 0);
    const anyHasSpend = activeRawLanes.some(
      (r) => r.activeSpendEur !== null && r.activeSpendEur > 0,
    );

    const mappedVolSum = activeRawLanes.reduce(
      (sum, r) => sum + (r.activeVolume ?? 0),
      0,
    );
    const mappedSpendSum = activeRawLanes.reduce(
      (sum, r) => sum + (r.activeSpendEur ?? 0),
      0,
    );
    const declaredShareSum = activeRawLanes.reduce(
      (sum, r) => sum + Math.max(0, r.lane.volumeSharePct),
      0,
    );

    let weightingBasis: HhiWeightingBasis | null = null;
    if (anyHasVolume && allHaveVolume) {
      weightingBasis = "VOLUME_BASE_UNIT";
    } else if (anyHasSpend) {
      weightingBasis = "SPEND_EUR";
    } else if (declaredShareSum > 0) {
      weightingBasis = "VOLUME_SHARE_PCT";
    }

    const totalAnnualDemand =
      input.totalAnnualDemand !== undefined && input.totalAnnualDemand !== null
        ? input.totalAnnualDemand
        : null;
    const proRatedDemand =
      totalAnnualDemand !== null
        ? viewMode === "RUN_RATE"
          ? totalAnnualDemand
          : totalAnnualDemand * (windowDays / DAY_COUNT_BASIS)
        : null;

    let uncontractedDemand: number | null = null;
    let uncontractedDemandPct: number | null = null;
    let lowerBoundUncontractedDemand: number | null = null;
    let isOvercontracted = false;
    const volumeIncomplete =
      activeRawLanes.length > 0 && !allHaveVolume;

    if (proRatedDemand !== null && proRatedDemand > 0) {
      if (allHaveVolume || activeRawLanes.length === 0) {
        if (mappedVolSum > proRatedDemand) {
          isOvercontracted = true;
          uncontractedDemand = 0;
          uncontractedDemandPct = 0;
        } else {
          uncontractedDemand = Math.max(0, proRatedDemand - mappedVolSum);
          uncontractedDemandPct = Math.min(
            100,
            Math.max(0, (uncontractedDemand / proRatedDemand) * 100),
          );
        }
      } else {
        // Volume incomplete across active lanes: never claim exact ghost demand
        uncontractedDemand = null;
        uncontractedDemandPct = null;
        lowerBoundUncontractedDemand = Math.max(0, proRatedDemand - mappedVolSum);
      }
    }

    // Renewal cliff at material level
    const totalMatRunRateVol = activeRawLanes.reduce(
      (s, r) => s + r.totalRunRateVolume,
      0,
    );
    const atRiskMatRunRateVol = activeRawLanes.reduce(
      (s, r) => s + r.atRiskRunRateVolume,
      0,
    );
    const totalMatRunRateSpend = activeRawLanes.reduce(
      (s, r) => s + r.totalRunRateSpend,
      0,
    );
    const atRiskMatRunRateSpend = activeRawLanes.reduce(
      (s, r) => s + r.atRiskRunRateSpend,
      0,
    );

    const atRiskVolumePct =
      totalMatRunRateVol > 0
        ? Math.min(100, (atRiskMatRunRateVol / totalMatRunRateVol) * 100)
        : totalMatRunRateSpend > 0
          ? Math.min(100, (atRiskMatRunRateSpend / totalMatRunRateSpend) * 100)
          : 0;
    const isRenewalCliff =
      atRiskVolumePct >
      FINANCIAL_RISK_PARAMS_V1.renewalCliff.thresholdExclusivePct;
    const hasNoticeAtRisk = activeRawLanes.some((r) => r.hasNoticeAtRisk);

    materialSummaries.set(input.inputId, {
      inputId: input.inputId,
      baseUnit,
      totalAnnualDemand,
      proRatedDemand,
      mappedActiveVolume: anyHasVolume ? mappedVolSum : null,
      mappedActiveSpendEur: mappedSpendSum,
      uncontractedDemand,
      uncontractedDemandPct,
      lowerBoundUncontractedDemand,
      isOvercontracted,
      volumeIncomplete,
      hasUnitConflict,
      atRiskVolumePct: round2(atRiskVolumePct),
      isRenewalCliff,
      hasNoticeAtRisk,
      weightingBasis,
    });

    // Assign lane shares
    for (const r of activeRawLanes) {
      let knownMappedSharePct: number | null = null;
      let totalDemandSharePct: number | null = null;
      if (weightingBasis === "VOLUME_BASE_UNIT" && mappedVolSum > 0 && r.activeVolume !== null) {
        knownMappedSharePct = round2((r.activeVolume / mappedVolSum) * 100);
        const demandDenom = Math.max(proRatedDemand ?? 0, mappedVolSum);
        totalDemandSharePct =
          demandDenom > 0 ? round2((r.activeVolume / demandDenom) * 100) : null;
      } else if (weightingBasis === "SPEND_EUR" && mappedSpendSum > 0 && r.activeSpendEur !== null) {
        knownMappedSharePct = round2((r.activeSpendEur / mappedSpendSum) * 100);
        totalDemandSharePct = knownMappedSharePct;
      } else if (weightingBasis === "VOLUME_SHARE_PCT" && declaredShareSum > 0) {
        knownMappedSharePct = round2(
          (Math.max(0, r.lane.volumeSharePct) / declaredShareSum) * 100,
        );
        totalDemandSharePct = knownMappedSharePct;
      }
      laneShareInfo.set(r.lane.laneId, {
        knownMappedSharePct,
        totalDemandSharePct,
        weightingBasis,
      });
    }
  }

  // Finalize DerivedLaneCommercialSummary map
  const laneSummaries = new Map<string, DerivedLaneCommercialSummary>();
  for (const [laneId, raw] of rawLaneMap.entries()) {
    const shareInfo = laneShareInfo.get(laneId);
    const weightedAvgUnitPrice =
      raw.cBothVolume > 0 ? round4(raw.cBothSpendEur / raw.cBothVolume) : null;
    const cBothSpendCoveragePct =
      raw.activeSpendEur !== null && raw.activeSpendEur > 0
        ? round2(Math.min(100, (raw.cBothSpendEur / raw.activeSpendEur) * 100))
        : null;
    const atRiskVolumePct =
      raw.totalRunRateVolume > 0
        ? round2(
            Math.min(100, (raw.atRiskRunRateVolume / raw.totalRunRateVolume) * 100),
          )
        : raw.totalRunRateSpend > 0
          ? round2(
              Math.min(100, (raw.atRiskRunRateSpend / raw.totalRunRateSpend) * 100),
            )
          : 0;

    laneSummaries.set(laneId, {
      laneId,
      viewMode,
      asOfDate,
      windowStart,
      windowEndExclusive,
      laneCommercialState: raw.state,
      activeVolume: raw.activeVolume !== null ? round4(raw.activeVolume) : null,
      baseUnit: raw.baseUnit,
      activeSpendEur:
        raw.activeSpendEur !== null ? round4(raw.activeSpendEur) : null,
      weightedAvgUnitPrice,
      spendOnlyExcludedEur: round4(raw.spendOnlyExcludedEur),
      cBothSpendCoveragePct,
      knownMappedSharePct: shareInfo?.knownMappedSharePct ?? null,
      totalDemandSharePct: shareInfo?.totalDemandSharePct ?? null,
      weightingBasis: shareInfo?.weightingBasis ?? null,
      nextExpirationDate:
        raw.nextExpirationDay !== null
          ? formatUtcDay(raw.nextExpirationDay)
          : null,
      nextNoticeDeadline:
        raw.nextNoticeDay !== null ? formatUtcDay(raw.nextNoticeDay) : null,
      atRiskVolumePct,
      assumedHoldoverVolume: round4(raw.assumedHoldoverVolume),
      hasUnitConflict: raw.hasUnitConflict,
      missingFxCurrencies: Array.from(raw.missingFxCurrencies).sort(),
      activeContractCount: raw.activeContractIds.size,
      confidenceBadge: summarizeConfidenceBadge(raw.activeConfidences),
    });
  }

  return {
    asOfDate,
    viewMode,
    windowStart,
    windowEndExclusive,
    windowDays,
    laneSummaries,
    materialSummaries,
    evaluatedLines,
  };
}

// --- ERP 12-Month PO History Auto-Clustering Helper ---

export interface ErpPoHistoryRow {
  supplierName: string;
  materialName: string;
  orderDate: string; // ISO YYYY-MM-DD
  quantity: number;
  unit: string;
  unitPrice: number;
  currency: string;
}

export interface DraftClusteredContract {
  supplierName: string;
  materialName: string;
  contractType: "FRAMEWORK" | "SPOT_PO";
  cadence: "PER_YEAR" | "TOTAL_OVER_TERM";
  expiryBehavior: "HOLDOVER" | "AUTO_ARCHIVE";
  confidence: "IMPORTED";
  startDate: string;
  endDate: string | null;
  committedVolume: number;
  unit: string;
  committedSpend: number;
  weightedAvgUnitPrice: number;
  currency: string;
  sourceOrderCount: number;
}

/**
 * Pure helper that clusters a 12-month ERP Purchase Order export into
 * recurring base FRAMEWORK contracts (stable price band, >= 3 orders) and
 * price/quantity outlier SPOT_PO top-ups with IMPORTED confidence.
 */
export function clusterErpPoHistoryToDraftContracts(
  rows: readonly ErpPoHistoryRow[],
  priceOutlierTolerancePct = 15,
): DraftClusteredContract[] {
  const groups = new Map<string, ErpPoHistoryRow[]>();
  for (const row of rows) {
    if (
      !Number.isFinite(row.quantity) ||
      row.quantity <= 0 ||
      !Number.isFinite(row.unitPrice) ||
      row.unitPrice < 0
    ) {
      continue;
    }
    const key = [
      row.supplierName.trim().toLowerCase(),
      row.materialName.trim().toLowerCase(),
      row.unit.trim().toUpperCase(),
      row.currency.trim().toUpperCase(),
    ].join("::");
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const drafts: DraftClusteredContract[] = [];

  for (const groupRows of groups.values()) {
    const sorted = [...groupRows].sort((a, b) =>
      a.orderDate.localeCompare(b.orderDate),
    );
    const prices = sorted.map((r) => r.unitPrice).sort((a, b) => a - b);
    const medianPrice = prices[Math.floor(prices.length / 2)]!;
    const tolerance = priceOutlierTolerancePct / 100;

    const stableRows: ErpPoHistoryRow[] = [];
    const outlierRows: ErpPoHistoryRow[] = [];

    for (const r of sorted) {
      const relDiff =
        medianPrice > 0
          ? Math.abs(r.unitPrice - medianPrice) / medianPrice
          : r.unitPrice === 0
            ? 0
            : 1;
      if (relDiff <= tolerance) {
        stableRows.push(r);
      } else {
        outlierRows.push(r);
      }
    }

    const first = sorted[0]!;
    if (stableRows.length >= 3) {
      const totalVol = stableRows.reduce((s, r) => s + r.quantity, 0);
      const totalSpend = stableRows.reduce(
        (s, r) => s + r.quantity * r.unitPrice,
        0,
      );
      drafts.push({
        supplierName: first.supplierName.trim(),
        materialName: first.materialName.trim(),
        contractType: "FRAMEWORK",
        cadence: "PER_YEAR",
        expiryBehavior: "HOLDOVER",
        confidence: "IMPORTED",
        startDate: stableRows[0]!.orderDate,
        endDate: null,
        committedVolume: round4(totalVol),
        unit: first.unit.trim().toUpperCase(),
        committedSpend: round2(totalSpend),
        weightedAvgUnitPrice: round4(totalSpend / totalVol),
        currency: first.currency.trim().toUpperCase(),
        sourceOrderCount: stableRows.length,
      });
    } else {
      outlierRows.push(...stableRows);
    }

    if (outlierRows.length > 0) {
      const orderedOutliers = [...outlierRows].sort((a, b) =>
        a.orderDate.localeCompare(b.orderDate),
      );
      const totalVol = orderedOutliers.reduce((s, r) => s + r.quantity, 0);
      const totalSpend = orderedOutliers.reduce(
        (s, r) => s + r.quantity * r.unitPrice,
        0,
      );
      drafts.push({
        supplierName: first.supplierName.trim(),
        materialName: first.materialName.trim(),
        contractType: "SPOT_PO",
        cadence: "TOTAL_OVER_TERM",
        expiryBehavior: "AUTO_ARCHIVE",
        confidence: "IMPORTED",
        startDate: orderedOutliers[0]!.orderDate,
        endDate: orderedOutliers[orderedOutliers.length - 1]!.orderDate,
        committedVolume: round4(totalVol),
        unit: first.unit.trim().toUpperCase(),
        committedSpend: round2(totalSpend),
        weightedAvgUnitPrice: round4(totalSpend / totalVol),
        currency: first.currency.trim().toUpperCase(),
        sourceOrderCount: orderedOutliers.length,
      });
    }
  }

  return drafts;
}

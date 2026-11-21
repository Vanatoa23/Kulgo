import {
  computeFinancialRiskSummary,
  computeFinancialSimulationDelta,
  evaluateNetworkAnalytics,
  simulateNetworkAnalytics,
  type HiddenFinancialRiskInput,
  type HiddenPartnerAggregate,
} from "@kulgo/engine";
import {
  AnalyticsSummarySchema,
  ExecutiveReportSchema,
  SimulateAnalyticsResponseSchema,
  type AnalyticsSummary,
  type ExecutiveReport,
  type FinancialViewMode,
  type RecommendedAction,
  type RiskSignal,
  type SimulateAnalyticsRequest,
  type SimulateAnalyticsResponse,
  type SupplyLane,
} from "@kulgo/shared";
import type { AuthRepository } from "../auth/repository.js";
import {
  assertOrgId,
  type NetworkFilters,
  type WorkspaceRepository,
} from "../workspace/repository.js";
import type { PartnerSummaryResolutionContext } from "./partner-resolver.js";
import type { RiskSignalRepository } from "./risk-signals.js";

export class AnalyticsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsValidationError";
  }
}

function toIsoDateUtc(date: Date): string {
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Collapses server-only Tier-2+ HiddenPartnerAggregate records into anonymized
 * scalar multipliers and opaque event-group keys for @kulgo/engine.
 * Zero Tier-2+ IDs, names, revenues, unit prices, or coordinates are passed.
 */
function buildHiddenFinancialRiskMap(
  lanes: readonly SupplyLane[],
  partnerHiddenSummaries?: ReadonlyMap<string, HiddenPartnerAggregate>,
): Map<string, HiddenFinancialRiskInput> | undefined {
  if (!partnerHiddenSummaries || partnerHiddenSummaries.size === 0) {
    return undefined;
  }
  const result = new Map<string, HiddenFinancialRiskInput>();
  for (const lane of lanes) {
    const hidden = partnerHiddenSummaries.get(lane.fromFacilityId);
    if (!hidden) continue;
    let probMult = 1.0;
    let ttrMult = 1.0;
    if (hidden.hasSanctionedUpstream) {
      probMult = Math.max(probMult, 1.65);
      ttrMult = Math.max(ttrMult, 1.45);
    }
    if (hidden.hasSharedChokepoint) {
      probMult = Math.max(probMult, 1.45);
      ttrMult = Math.max(ttrMult, 1.35);
    }
    const eventGroupId = hidden.chokepointRegionCode
      ? `hidden-chokepoint::${hidden.chokepointRegionCode}`
      : hidden.regionCode
        ? `hidden-region::${hidden.regionCode}`
        : `hidden-tier1::${lane.fromFacilityId}`;
    result.set(lane.laneId, {
      eventGroupId,
      hiddenProbabilityMultiplier: probMult,
      hiddenTtrMultiplier: ttrMult,
      verified: true,
    });
  }
  return result.size > 0 ? result : undefined;
}

export interface AnalyticsRepository {
  getSummary(
    orgId: string,
    filters?: NetworkFilters,
    asOfDate?: Date,
    viewMode?: FinancialViewMode,
  ): Promise<AnalyticsSummary>;

  getExecutiveReport(
    orgId: string,
    filters?: NetworkFilters,
    asOfDate?: Date,
    viewMode?: FinancialViewMode,
  ): Promise<ExecutiveReport>;

  simulate(
    orgId: string,
    request: SimulateAnalyticsRequest,
    asOfDate?: Date,
  ): Promise<SimulateAnalyticsResponse>;

  listRiskSignals(): Promise<RiskSignal[]>;
}

export interface OrgScopedAnalyticsRepositoryDeps {
  authRepo: AuthRepository;
  workspaceRepo: WorkspaceRepository;
  riskSignalRepo: RiskSignalRepository;
  /**
   * Optional server-side hook for resolving anonymized hidden Tier-2+ partner
   * aggregates via VERIFIED_PARTNER_LINK. Strictly returns anonymized totals
   * keyed only by Org A's Tier-1 facilityId.
   */
  resolvePartnerHiddenSummaries?: (
    orgId: string,
    activeNetwork?: PartnerSummaryResolutionContext,
  ) => Promise<ReadonlyMap<string, HiddenPartnerAggregate>>;
}

/**
 * Strictly org-scoped AnalyticsRepository wired to @kulgo/engine.
 * Every read and simulation requires an authenticated `orgId` and passes
 * only that organization's own network plus global RiskSignals into the engine.
 * All outputs are validated against `.strict()` Zod DTOs.
 */
export class OrgScopedAnalyticsRepository implements AnalyticsRepository {
  private readonly authRepo: AuthRepository;
  private readonly workspaceRepo: WorkspaceRepository;
  private readonly riskSignalRepo: RiskSignalRepository;
  private readonly resolvePartnerHiddenSummaries?: (
    orgId: string,
    activeNetwork?: PartnerSummaryResolutionContext,
  ) => Promise<ReadonlyMap<string, HiddenPartnerAggregate>>;

  constructor(deps: OrgScopedAnalyticsRepositoryDeps) {
    this.authRepo = deps.authRepo;
    this.workspaceRepo = deps.workspaceRepo;
    this.riskSignalRepo = deps.riskSignalRepo;
    this.resolvePartnerHiddenSummaries = deps.resolvePartnerHiddenSummaries;
  }

  async listRiskSignals(): Promise<RiskSignal[]> {
    return this.riskSignalRepo.listActive();
  }

  async getSummary(
    orgId: string,
    filters?: NetworkFilters,
    asOfDate?: Date,
    viewMode: FinancialViewMode = "PERIOD_WINDOW",
  ): Promise<AnalyticsSummary> {
    const safeOrgId = assertOrgId(orgId);
    const [organization, network, riskSignals] = await Promise.all([
      this.authRepo.findOrganizationById(safeOrgId),
      this.workspaceRepo.getNetwork(safeOrgId, filters),
      this.riskSignalRepo.listActive(),
    ]);
    const partnerHiddenSummaries = this.resolvePartnerHiddenSummaries
      ? await this.resolvePartnerHiddenSummaries(safeOrgId, network)
      : undefined;

    const summary = evaluateNetworkAnalytics({
      organization: {
        scope1Tco2e: organization?.scope1Tco2e ?? null,
        scope2Tco2e: organization?.scope2Tco2e ?? null,
      },
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: network.lanes,
      riskSignals,
      partnerHiddenSummaries,
      asOfDate,
    });

    const financialRisk = computeFinancialRiskSummary({
      products: network.products,
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: network.lanes,
      contracts: network.contracts,
      contractLines: network.contractLines,
      riskSignals,
      hiddenRiskByLaneId: buildHiddenFinancialRiskMap(
        network.lanes,
        partnerHiddenSummaries,
      ),
      asOfDate: toIsoDateUtc(asOfDate ?? new Date()),
      viewMode,
    });

    return AnalyticsSummarySchema.parse({ ...summary, financialRisk });
  }

  async getExecutiveReport(
    orgId: string,
    filters?: NetworkFilters,
    asOfDate?: Date,
    viewMode: FinancialViewMode = "PERIOD_WINDOW",
  ): Promise<ExecutiveReport> {
    const safeOrgId = assertOrgId(orgId);
    const [organization, network, riskSignals] = await Promise.all([
      this.authRepo.findOrganizationById(safeOrgId),
      this.workspaceRepo.getNetwork(safeOrgId, filters),
      this.riskSignalRepo.listActive(),
    ]);
    const partnerHiddenSummaries = this.resolvePartnerHiddenSummaries
      ? await this.resolvePartnerHiddenSummaries(safeOrgId, network)
      : undefined;

    if (!organization) {
      throw new AnalyticsValidationError("Organization not found");
    }

    const financialRisk = computeFinancialRiskSummary({
      products: network.products,
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: network.lanes,
      contracts: network.contracts,
      contractLines: network.contractLines,
      riskSignals,
      hiddenRiskByLaneId: buildHiddenFinancialRiskMap(
        network.lanes,
        partnerHiddenSummaries,
      ),
      asOfDate: toIsoDateUtc(asOfDate ?? new Date()),
      viewMode,
    });

    const summary = AnalyticsSummarySchema.parse({
      ...evaluateNetworkAnalytics({
        organization: {
          scope1Tco2e: organization.scope1Tco2e,
          scope2Tco2e: organization.scope2Tco2e,
        },
        inputs: network.inputs,
        facilities: network.facilities,
        lanes: network.lanes,
        riskSignals,
        partnerHiddenSummaries,
        asOfDate,
      }),
      financialRisk,
    });

    const tier1Suppliers = network.facilities.filter((f) => !f.isOwnFacility);
    const verifiedTier1Suppliers = tier1Suppliers.filter(
      (f) => f.isPartnerVerified,
    ).length;
    const unverifiedTier1Suppliers =
      tier1Suppliers.length - verifiedTier1Suppliers;
    const siteVerifiedFacilities = network.facilities.filter(
      (f) => f.locationPrecision === "SITE_VERIFIED",
    ).length;
    const hqEstimatedFacilities =
      network.facilities.length - siteVerifiedFacilities;

    const severityRank = { RED: 0, YELLOW: 1, GREEN: 2 } as const;
    const sortedAlerts = [...summary.alerts].sort(
      (a, b) => severityRank[a.severity] - severityRank[b.severity],
    );

    const actions: RecommendedAction[] = sortedAlerts.map((alert) => ({
      priority:
        alert.severity === "RED"
          ? "HIGH"
          : alert.severity === "YELLOW"
            ? "MEDIUM"
            : "LOW",
      category: alert.category,
      title: alert.title,
      action: alert.recommendedAction,
      affectedTier1FacilityIds: alert.affectedTier1FacilityIds,
      confidence: alert.confidence,
    }));

    if (
      organization.scope1Tco2e === null ||
      organization.scope2Tco2e === null
    ) {
      actions.push({
        priority: "MEDIUM",
        category: "CSRD_DISCLOSURE",
        title: "Complete Scope 1 & Scope 2 emissions reporting",
        action:
          "Enter your organization's annual Scope 1 and Scope 2 tCO2e in Org ESG Settings to complete CSRD baseline disclosures.",
        affectedTier1FacilityIds: [],
        confidence: "ESTIMATED",
      });
    }

    if (unverifiedTier1Suppliers > 0) {
      const unverifiedIds = tier1Suppliers
        .filter((f) => !f.isPartnerVerified)
        .map((f) => f.facilityId);
      actions.push({
        priority: verifiedTier1Suppliers === 0 ? "MEDIUM" : "LOW",
        category: "PARTNER_VERIFICATION",
        title: `Invite ${unverifiedTier1Suppliers} unverified Tier-1 supplier${unverifiedTier1Suppliers === 1 ? "" : "s"}`,
        action:
          "Send Kulgo partner invitations to unlock Network-Verified Scope 3 primary data and anonymized hidden upstream risk screening.",
        affectedTier1FacilityIds: unverifiedIds,
        confidence: "ESTIMATED",
      });
    }

    const scope3Methodology =
      summary.verifiedCoveragePct === 100 && tier1Suppliers.length > 0
        ? "PRIMARY_VERIFIED"
        : summary.verifiedCoveragePct > 0
          ? "HYBRID_VERIFIED_AND_ESTIMATED"
          : "SPEND_AND_FACTOR_ESTIMATED";

    return ExecutiveReportSchema.parse({
      reportVersion: "1.0",
      generatedAt: (asOfDate ?? new Date()).toISOString(),
      organization: {
        orgId: organization.orgId,
        name: organization.name,
        countryCode: organization.countryCode,
        sector: organization.sector,
        esgBadges: organization.esgBadges,
        scope1Tco2e: organization.scope1Tco2e,
        scope2Tco2e: organization.scope2Tco2e,
        openToNewBuyers: organization.openToNewBuyers,
        capabilities: organization.capabilities,
      },
      analytics: summary,
      verifiedPartnerCoverage: {
        totalTier1Suppliers: tier1Suppliers.length,
        verifiedTier1Suppliers,
        unverifiedTier1Suppliers,
        verifiedCoveragePct: summary.verifiedCoveragePct,
        siteVerifiedFacilities,
        hqEstimatedFacilities,
      },
      topRecommendedActions: actions.slice(0, 8),
      csrdDisclosures: {
        scope1Status:
          organization.scope1Tco2e !== null ? "REPORTED" : "MISSING",
        scope2Status:
          organization.scope2Tco2e !== null ? "REPORTED" : "MISSING",
        scope3Methodology,
        totalReportedTco2e: summary.esg.totalTco2e,
        privacyAttestation:
          "All Tier-2+ upstream risk alerts and Scope 3 roll-ups are computed strictly server-side and anonymized per Kulgo Privacy Contract. No hidden upstream supplier identities, emails, or exact coordinates are disclosed.",
      },
      financialExposure: financialRisk,
    });
  }

  async simulate(
    orgId: string,
    request: SimulateAnalyticsRequest,
    asOfDate?: Date,
  ): Promise<SimulateAnalyticsResponse> {
    const safeOrgId = assertOrgId(orgId);
    const filters: NetworkFilters = {
      productId: request.productId,
      inputId: request.inputId,
    };

    const [organization, network, riskSignals] = await Promise.all([
      this.authRepo.findOrganizationById(safeOrgId),
      this.workspaceRepo.getNetwork(safeOrgId, filters),
      this.riskSignalRepo.listActive(),
    ]);

    // Enforce strict org boundary: every simulated laneId must belong to this org's network
    const ownedLaneIds = new Set(network.lanes.map((lane) => lane.laneId));
    const unknownLaneIds = request.laneChanges
      .map((change) => change.laneId)
      .filter((laneId) => !ownedLaneIds.has(laneId));

    if (unknownLaneIds.length > 0) {
      throw new AnalyticsValidationError(
        "One or more referenced laneIds do not exist in this organization's visible network",
      );
    }

    const changesByLaneId = new Map(
      request.laneChanges.map((change) => [change.laneId, change]),
    );
    const simulatedLanes = network.lanes.map((lane) => {
      const change = changesByLaneId.get(lane.laneId);
      if (!change) {
        return lane;
      }
      return {
        ...lane,
        ...(change.volumeSharePct !== undefined
          ? { volumeSharePct: change.volumeSharePct }
          : {}),
        ...(change.transportMode !== undefined
          ? { transportMode: change.transportMode }
          : {}),
        ...(change.annualVolume !== undefined
          ? { annualVolume: change.annualVolume }
          : {}),
        ...(change.annualSpendEur !== undefined
          ? { annualSpendEur: change.annualSpendEur }
          : {}),
        ...(change.safetyStockDays !== undefined
          ? { safetyStockDays: change.safetyStockDays }
          : {}),
        ...(change.carryingCostPct !== undefined
          ? { carryingCostPct: change.carryingCostPct }
          : {}),
        ...(change.defectRatePct !== undefined
          ? { defectRatePct: change.defectRatePct }
          : {}),
        ...(change.riskStatus !== undefined
          ? { riskStatus: change.riskStatus }
          : {}),
      };
    });

    const [baselinePartnerHiddenSummaries, simulatedPartnerHiddenSummaries] =
      this.resolvePartnerHiddenSummaries
        ? await Promise.all([
            this.resolvePartnerHiddenSummaries(safeOrgId, network),
            this.resolvePartnerHiddenSummaries(safeOrgId, {
              facilities: network.facilities,
              lanes: simulatedLanes,
            }),
          ])
        : [undefined, undefined];

    const isoDate = toIsoDateUtc(asOfDate ?? new Date());
    const baselineFinancialRisk = computeFinancialRiskSummary({
      products: network.products,
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: network.lanes,
      contracts: network.contracts,
      contractLines: network.contractLines,
      riskSignals,
      hiddenRiskByLaneId: buildHiddenFinancialRiskMap(
        network.lanes,
        baselinePartnerHiddenSummaries,
      ),
      asOfDate: isoDate,
      viewMode: "RUN_RATE",
    });

    const simulatedFinancialRisk = computeFinancialRiskSummary({
      products: network.products,
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: simulatedLanes,
      // When simulating volume/spend changes directly on lanes, evaluate from simulated lanes
      contracts: request.laneChanges.some(
        (c) => c.annualSpendEur !== undefined || c.annualVolume !== undefined,
      )
        ? []
        : network.contracts,
      contractLines: request.laneChanges.some(
        (c) => c.annualSpendEur !== undefined || c.annualVolume !== undefined,
      )
        ? []
        : network.contractLines,
      riskSignals,
      hiddenRiskByLaneId: buildHiddenFinancialRiskMap(
        simulatedLanes,
        simulatedPartnerHiddenSummaries,
      ),
      asOfDate: isoDate,
      viewMode: "RUN_RATE",
    });

    const financialDeltas = computeFinancialSimulationDelta({
      baseline: baselineFinancialRisk,
      simulated: simulatedFinancialRisk,
      baselineLanes: network.lanes,
      simulatedLanes,
      oneTimeQualificationEur: request.oneTimeQualificationEur,
    });

    const baselineOnly = evaluateNetworkAnalytics({
      organization: {
        scope1Tco2e: organization?.scope1Tco2e ?? null,
        scope2Tco2e: organization?.scope2Tco2e ?? null,
      },
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: network.lanes,
      riskSignals,
      partnerHiddenSummaries: baselinePartnerHiddenSummaries,
      asOfDate,
    });

    const simulatedResult = simulateNetworkAnalytics(
      {
        organization: {
          scope1Tco2e: organization?.scope1Tco2e ?? null,
          scope2Tco2e: organization?.scope2Tco2e ?? null,
        },
        inputs: network.inputs,
        facilities: network.facilities,
        lanes: network.lanes,
        riskSignals,
        partnerHiddenSummaries: simulatedPartnerHiddenSummaries,
        asOfDate,
      },
      request.laneChanges,
    );

    const summarizeHhi = (summary: AnalyticsSummary) => {
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
      const spofCount = materialHhis.filter(
        (m) => m.isSinglePointOfFailure,
      ).length;
      return { maxHhi, avgHhi, spofCount };
    };

    const round2 = (value: number) => Math.round(value * 100) / 100;
    const baseHhi = summarizeHhi(baselineOnly);
    const simHhi = summarizeHhi(simulatedResult.simulated);
    const baseRedAlerts = baselineOnly.alerts.filter(
      (a) => a.severity === "RED",
    ).length;
    const simRedAlerts = simulatedResult.simulated.alerts.filter(
      (a) => a.severity === "RED",
    ).length;

    return SimulateAnalyticsResponseSchema.parse({
      baseline: { ...baselineOnly, financialRisk: baselineFinancialRisk },
      simulated: {
        ...simulatedResult.simulated,
        financialRisk: simulatedFinancialRisk,
      },
      deltas: {
        resilienceScoreDelta: round2(
          simulatedResult.simulated.resilienceScore -
            baselineOnly.resilienceScore,
        ),
        maxHhiDelta: round2(simHhi.maxHhi - baseHhi.maxHhi),
        avgHhiDelta: round2(simHhi.avgHhi - baseHhi.avgHhi),
        alertCountDelta:
          simulatedResult.simulated.alerts.length - baselineOnly.alerts.length,
        redAlertCountDelta: simRedAlerts - baseRedAlerts,
        spofCountDelta: simHhi.spofCount - baseHhi.spofCount,
        transportScope3Tco2eDelta: round2(
          simulatedResult.simulated.esg.transportScope3Tco2e -
            baselineOnly.esg.transportScope3Tco2e,
        ),
        totalTco2eDelta: round2(
          simulatedResult.simulated.esg.totalTco2e -
            baselineOnly.esg.totalTco2e,
        ),
        financialDeltas,
      },
      appliedChangesCount: simulatedResult.appliedChangesCount,
    });
  }
}

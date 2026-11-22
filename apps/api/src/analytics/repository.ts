import {
  FINANCIAL_RISK_PARAMS_V1,
  computeFinancialRiskSummary,
  computeFinancialSimulationDelta,
  deriveNetworkCommercials,
  evaluateEsgAndCompliance,
  evaluateNetworkAnalytics,
  toBaseUnit,
  type HiddenFinancialRiskInput,
  type HiddenPartnerAggregate,
} from "@kulgo/engine";
import {
  AnalyticsSummarySchema,
  EsgLedgerResponseSchema,
  ExecutiveReportSchema,
  FACTOR_MATRIX_VERSION,
  SimulateAnalyticsResponseSchema,
  VolumeUnitSchema,
  resolveLaneDirection,
  type AnalyticsSummary,
  type Contract,
  type ContractLine,
  type EsgLedgerResponse,
  type ExecutiveReport,
  type Facility,
  type FinancialViewMode,
  type Organization,
  type Product,
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

function filterSourcingLanes(
  lanes: readonly SupplyLane[],
  facilities: readonly Facility[],
): SupplyLane[] {
  const facById = new Map(facilities.map((f) => [f.facilityId, f]));
  return lanes.filter(
    (lane) =>
      resolveLaneDirection(
        lane,
        facById.get(lane.fromFacilityId),
        facById.get(lane.toFacilityId),
      ) !== "DOWNSTREAM",
  );
}

function attachDownstreamLaneCommercials<
  T extends { laneCommercials?: ReturnType<typeof deriveNetworkCommercials>["laneSummaries"] extends Map<string, infer V> ? V[] : never },
>(
  financialRisk: T,
  lanes: readonly SupplyLane[],
  facilities: readonly Facility[],
  inputs: Parameters<typeof deriveNetworkCommercials>[1],
  contracts: Parameters<typeof deriveNetworkCommercials>[2],
  contractLines: Parameters<typeof deriveNetworkCommercials>[3],
  options: { asOfDate: string; viewMode: FinancialViewMode },
): T {
  const facById = new Map(facilities.map((f) => [f.facilityId, f]));
  const downstreamLanes = lanes.filter(
    (lane) =>
      resolveLaneDirection(
        lane,
        facById.get(lane.fromFacilityId),
        facById.get(lane.toFacilityId),
      ) === "DOWNSTREAM",
  );
  if (downstreamLanes.length === 0) {
    return financialRisk;
  }
  const downstreamCommercials = deriveNetworkCommercials(
    downstreamLanes,
    inputs,
    contracts,
    contractLines,
    { ...options, facilities },
  );
  return {
    ...financialRisk,
    laneCommercials: [
      ...(financialRisk.laneCommercials ?? []),
      ...downstreamCommercials.laneSummaries.values(),
    ],
  };
}

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

function buildOrgAnalyticsContext(
  organization: Organization | null,
  products: readonly Product[],
) {
  const productRevSum = products.reduce(
    (sum, p) =>
      sum +
      (typeof p.annualRevenueEur === "number" &&
      Number.isFinite(p.annualRevenueEur) &&
      p.annualRevenueEur > 0
        ? p.annualRevenueEur
        : 0),
    0,
  );
  const annualRevenueEur =
    typeof organization?.annualRevenueEur === "number" &&
    Number.isFinite(organization.annualRevenueEur) &&
    organization.annualRevenueEur > 0
      ? organization.annualRevenueEur
      : productRevSum > 0
        ? productRevSum
        : null;

  return {
    orgId: organization?.orgId,
    name: organization?.name,
    countryCode: organization?.countryCode,
    scope1Tco2e: organization?.scope1Tco2e ?? null,
    scope2Tco2e: organization?.scope2Tco2e ?? null,
    scope2MarketTco2e: organization?.scope2MarketTco2e ?? null,
    annualRevenueEur,
    targetMarkets: organization?.targetMarkets ?? [],
    enabledCompliancePacks: organization?.enabledCompliancePacks ?? [],
  };
}

function buildLaneIncotermsMap(
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

  getEsgLedger(
    orgId: string,
    filters?: NetworkFilters,
    asOfDate?: Date,
    viewMode?: FinancialViewMode,
  ): Promise<EsgLedgerResponse>;

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
    const effectiveAsOfDate = asOfDate ?? new Date();
    const isoDate = toIsoDateUtc(effectiveAsOfDate);
    const [organization, network, riskSignals] = await Promise.all([
      this.authRepo.findOrganizationById(safeOrgId),
      this.workspaceRepo.getNetwork(safeOrgId, filters),
      this.riskSignalRepo.listActive(),
    ]);
    const partnerHiddenSummaries = this.resolvePartnerHiddenSummaries
      ? await this.resolvePartnerHiddenSummaries(safeOrgId, network)
      : undefined;

    const sourcingLanes = filterSourcingLanes(network.lanes, network.facilities);
    const commercials = deriveNetworkCommercials(
      sourcingLanes,
      network.inputs,
      network.contracts ?? [],
      network.contractLines ?? [],
      { asOfDate: isoDate, viewMode, facilities: network.facilities },
    );

    const financialRisk = attachDownstreamLaneCommercials(
      computeFinancialRiskSummary({
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
        commercials,
        asOfDate: isoDate,
        viewMode,
      }),
      network.lanes,
      network.facilities,
      network.inputs,
      network.contracts ?? [],
      network.contractLines ?? [],
      { asOfDate: isoDate, viewMode },
    );

    const incotermsByLaneId = buildLaneIncotermsMap(
      network.contracts,
      network.contractLines,
    );

    const summary = evaluateNetworkAnalytics({
      organization: buildOrgAnalyticsContext(organization, network.products),
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: network.lanes,
      riskSignals,
      partnerHiddenSummaries,
      laneCommercialsByLaneId: commercials.laneSummaries,
      incotermsByLaneId,
      asOfDate: effectiveAsOfDate,
    });

    return AnalyticsSummarySchema.parse({ ...summary, financialRisk });
  }

  async getEsgLedger(
    orgId: string,
    filters?: NetworkFilters,
    asOfDate?: Date,
    viewMode: FinancialViewMode = "PERIOD_WINDOW",
  ): Promise<EsgLedgerResponse> {
    const safeOrgId = assertOrgId(orgId);
    const effectiveAsOfDate = asOfDate ?? new Date();
    const isoDate = toIsoDateUtc(effectiveAsOfDate);
    const [organization, network] = await Promise.all([
      this.authRepo.findOrganizationById(safeOrgId),
      this.workspaceRepo.getNetwork(safeOrgId, filters),
    ]);
    if (!organization) {
      throw new AnalyticsValidationError("Organization not found");
    }

    const partnerHiddenSummaries = this.resolvePartnerHiddenSummaries
      ? await this.resolvePartnerHiddenSummaries(safeOrgId, network)
      : undefined;

    const sourcingLanes = filterSourcingLanes(network.lanes, network.facilities);
    const commercials = deriveNetworkCommercials(
      sourcingLanes,
      network.inputs,
      network.contracts ?? [],
      network.contractLines ?? [],
      { asOfDate: isoDate, viewMode, facilities: network.facilities },
    );
    const incotermsByLaneId = buildLaneIncotermsMap(
      network.contracts,
      network.contractLines,
    );

    const { summary, ledgerEntries } = evaluateEsgAndCompliance({
      organization: buildOrgAnalyticsContext(organization, network.products),
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: network.lanes,
      partnerHiddenSummaries,
      laneCommercialsByLaneId: commercials.laneSummaries,
      incotermsByLaneId,
    });

    return EsgLedgerResponseSchema.parse({
      ledgerVersion: "1.0",
      factorMatrixVersion: FACTOR_MATRIX_VERSION,
      generatedAt: effectiveAsOfDate.toISOString(),
      organizationId: organization.orgId,
      organizationName: organization.name,
      activeCompliancePacks: summary.activeCompliancePacks ?? ["GLOBAL_GHG_ISSB"],
      weightedPcafScore: summary.weightedPcafScore ?? null,
      totalTco2e: summary.totalTco2e,
      entries: ledgerEntries,
    });
  }

  async getExecutiveReport(
    orgId: string,
    filters?: NetworkFilters,
    asOfDate?: Date,
    viewMode: FinancialViewMode = "PERIOD_WINDOW",
  ): Promise<ExecutiveReport> {
    const safeOrgId = assertOrgId(orgId);
    const effectiveAsOfDate = asOfDate ?? new Date();
    const isoDate = toIsoDateUtc(effectiveAsOfDate);
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

    const sourcingLanes = filterSourcingLanes(network.lanes, network.facilities);
    const commercials = deriveNetworkCommercials(
      sourcingLanes,
      network.inputs,
      network.contracts ?? [],
      network.contractLines ?? [],
      { asOfDate: isoDate, viewMode, facilities: network.facilities },
    );

    const financialRisk = attachDownstreamLaneCommercials(
      computeFinancialRiskSummary({
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
        commercials,
        asOfDate: isoDate,
        viewMode,
      }),
      network.lanes,
      network.facilities,
      network.inputs,
      network.contracts ?? [],
      network.contractLines ?? [],
      { asOfDate: isoDate, viewMode },
    );

    const incotermsByLaneId = buildLaneIncotermsMap(
      network.contracts,
      network.contractLines,
    );

    const summary = AnalyticsSummarySchema.parse({
      ...evaluateNetworkAnalytics({
        organization: buildOrgAnalyticsContext(organization, network.products),
        inputs: network.inputs,
        facilities: network.facilities,
        lanes: network.lanes,
        riskSignals,
        partnerHiddenSummaries,
        laneCommercialsByLaneId: commercials.laneSummaries,
        incotermsByLaneId,
        asOfDate: effectiveAsOfDate,
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
      generatedAt: effectiveAsOfDate.toISOString(),
      organization: {
        orgId: organization.orgId,
        name: organization.name,
        countryCode: organization.countryCode,
        sector: organization.sector,
        esgBadges: organization.esgBadges,
        scope1Tco2e: organization.scope1Tco2e,
        scope2Tco2e: organization.scope2Tco2e,
        scope2MarketTco2e: organization.scope2MarketTco2e ?? null,
        targetMarkets: organization.targetMarkets ?? [],
        enabledCompliancePacks: organization.enabledCompliancePacks ?? [],
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
          "All Tier-2+ upstream risk alerts and Scope 3 roll-ups are computed strictly server-side and anonymized per Kulgo Privacy Contract. No hidden upstream supplier identities, partner revenues, emails, or exact coordinates are disclosed.",
        weightedPcafScore: summary.esg.weightedPcafScore ?? null,
        primaryDataSharePct: summary.esg.primaryDataSharePct ?? 0,
        activeCompliancePacks: summary.esg.activeCompliancePacks ?? ["GLOBAL_GHG_ISSB"],
      },
      financialExposure: financialRisk,
      complianceChecklist: summary.esg.complianceChecklist ?? [],
    });
  }

  async simulate(
    orgId: string,
    request: SimulateAnalyticsRequest,
    asOfDate?: Date,
  ): Promise<SimulateAnalyticsResponse> {
    const safeOrgId = assertOrgId(orgId);
    const effectiveAsOfDate = asOfDate ?? new Date();
    const isoDate = toIsoDateUtc(effectiveAsOfDate);
    const viewMode: FinancialViewMode = request.viewMode ?? "RUN_RATE";
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

    const baselineSourcingLanes = filterSourcingLanes(
      network.lanes,
      network.facilities,
    );
    const baselineCommercials = deriveNetworkCommercials(
      baselineSourcingLanes,
      network.inputs,
      network.contracts ?? [],
      network.contractLines ?? [],
      { asOfDate: isoDate, viewMode, facilities: network.facilities },
    );
    // Simulation edits feed into derivation again. Start with unallocated sources,
    // otherwise an allocated lane is pooled alongside its siblings a second time.
    const baselineSourceCommercials = deriveNetworkCommercials(
      baselineSourcingLanes, network.inputs, network.contracts ?? [], network.contractLines ?? [],
      { asOfDate: isoDate, viewMode, facilities: network.facilities, applyAllocationSplits: false },
    );
    const baselineScale =
      viewMode === "RUN_RATE"
        ? 1
        : baselineCommercials.windowDays /
          FINANCIAL_RISK_PARAMS_V1.dayCountBasis;

    const inputsById = new Map(
      network.inputs.map((item) => [item.inputId, item]),
    );
    const changesByLaneId = new Map(
      request.laneChanges.map((change) => [change.laneId, change]),
    );
    const commercialChangedLaneIds = new Set<string>();
    let appliedChangesCount = 0;

    const simulatedLanesWithContractBase = network.lanes.map((lane) => {
      const change = changesByLaneId.get(lane.laneId);
      if (!change) {
        return lane;
      }

      appliedChangesCount += 1;

      const volumeShareChanged =
        change.volumeSharePct !== undefined &&
        change.volumeSharePct !== lane.volumeSharePct;
      const volumeChanged = change.annualVolume !== undefined;
      const spendChanged = change.annualSpendEur !== undefined;
      const hasCommercialChange =
        volumeShareChanged || volumeChanged || spendChanged;

      const baseComm = baselineSourceCommercials.laneSummaries.get(lane.laneId);
      const isLapsedBaseline =
        baseComm?.laneCommercialState === "LAPSED_UNCONTRACTED";
      const addsExplicitCommercials =
        (typeof change.annualVolume === "number" && change.annualVolume > 0) ||
        (typeof change.annualSpendEur === "number" &&
          change.annualSpendEur > 0);
      // Preserve expired contract lines for lapsed lanes unless the edit explicitly
      // introduces positive simulated volume or spend, so a share-only edit cannot
      // relabel a lapsed lane as LEVEL_0_UNPRICED and revive it in HHI/SPOF.
      const shouldBypassContracts =
        hasCommercialChange && (!isLapsedBaseline || addsExplicitCommercials);

      if (shouldBypassContracts) {
        commercialChangedLaneIds.add(lane.laneId);
      }

      const ratio = volumeShareChanged
        ? lane.volumeSharePct > 0
          ? change.volumeSharePct! / lane.volumeSharePct
          : change.volumeSharePct === 0
            ? 0
            : 1
        : 1;

      let effectiveBaseVolume = lane.annualVolume;
      let effectiveBaseVolumeUnit = lane.volumeUnit;
      let effectiveBaseSpend = lane.annualSpendEur;
      if (shouldBypassContracts && baseComm) {
        if (baseComm.activeVolume !== null) {
          const annualizedVol =
            baselineScale > 0
              ? baseComm.activeVolume / baselineScale
              : baseComm.activeVolume;
          const fromUnit = baseComm.baseUnit ?? lane.volumeUnit;
          const parsedBaseUnit = VolumeUnitSchema.safeParse(fromUnit);
          if (change.annualVolume === undefined && parsedBaseUnit.success) {
            // Keep untouched (or share-scaled) volume in its canonical baseUnit
            // so custom input unitConversionFactors are never double-applied.
            effectiveBaseVolume = annualizedVol;
            effectiveBaseVolumeUnit = parsedBaseUnit.data;
          } else {
            const linkedInput = lane.inputId
              ? inputsById.get(lane.inputId)
              : undefined;
            const converted = toBaseUnit(
              annualizedVol,
              fromUnit,
              lane.volumeUnit,
            );
            if (!converted.unitConflict && converted.value !== null) {
              effectiveBaseVolume = converted.value;
            } else {
              const forwardFactor =
                linkedInput?.unitConversionFactors?.[lane.volumeUnit] ??
                linkedInput?.unitConversionFactors?.[
                  lane.volumeUnit.toUpperCase()
                ];
              effectiveBaseVolume =
                forwardFactor !== undefined &&
                Number.isFinite(forwardFactor) &&
                forwardFactor > 0
                  ? annualizedVol / forwardFactor
                  : annualizedVol;
            }
          }
        } else {
          effectiveBaseVolume = null;
        }

        effectiveBaseSpend =
          baseComm.activeSpendEur !== null
            ? baselineScale > 0
              ? baseComm.activeSpendEur / baselineScale
              : baseComm.activeSpendEur
            : null;
      }

      let nextAnnualVolume = lane.annualVolume;
      let nextVolumeUnit = lane.volumeUnit;
      if (change.annualVolume !== undefined) {
        nextAnnualVolume = change.annualVolume;
      } else if (shouldBypassContracts) {
        nextAnnualVolume =
          volumeShareChanged && effectiveBaseVolume !== null
            ? Math.max(0, effectiveBaseVolume * ratio)
            : effectiveBaseVolume;
        nextVolumeUnit = effectiveBaseVolumeUnit;
      }

      let nextAnnualSpendEur = lane.annualSpendEur;
      if (change.annualSpendEur !== undefined) {
        nextAnnualSpendEur = change.annualSpendEur;
      } else if (shouldBypassContracts) {
        nextAnnualSpendEur =
          volumeShareChanged && effectiveBaseSpend !== null
            ? Math.max(0, effectiveBaseSpend * ratio)
            : effectiveBaseSpend;
      }

      const transportOrVolumeChanged =
        (change.transportMode !== undefined &&
          change.transportMode !== lane.transportMode) ||
        volumeShareChanged ||
        volumeChanged;

      return {
        ...lane,
        ...(change.volumeSharePct !== undefined
          ? { volumeSharePct: change.volumeSharePct }
          : {}),
        ...(change.transportMode !== undefined
          ? { transportMode: change.transportMode }
          : {}),
        volumeUnit: nextVolumeUnit,
        annualVolume: nextAnnualVolume,
        annualSpendEur: nextAnnualSpendEur,
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
        estimatedLaneCo2e: transportOrVolumeChanged
          ? null
          : lane.estimatedLaneCo2e,
      };
    });

    const [baselinePartnerHiddenSummaries, simulatedPartnerHiddenSummaries] =
      this.resolvePartnerHiddenSummaries
        ? await Promise.all([
            this.resolvePartnerHiddenSummaries(safeOrgId, network),
            this.resolvePartnerHiddenSummaries(safeOrgId, {
              facilities: network.facilities,
              lanes: simulatedLanesWithContractBase,
            }),
          ])
        : [undefined, undefined];

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
      commercials: baselineCommercials,
      asOfDate: isoDate,
      viewMode,
    });

    // For any lane whose volumeSharePct/annualVolume/annualSpendEur is being simulated,
    // bypass unscaled contractLines on that lane so the simulated lane quantities take effect.
    const simulatedContractLines = (network.contractLines ?? []).filter(
      (cl) => !commercialChangedLaneIds.has(cl.laneId),
    );

    const simulatedSourcingLanes = filterSourcingLanes(
      simulatedLanesWithContractBase,
      network.facilities,
    );
    const simulatedCommercials = deriveNetworkCommercials(
      simulatedSourcingLanes,
      network.inputs,
      network.contracts ?? [],
      simulatedContractLines,
      { asOfDate: isoDate, viewMode, facilities: network.facilities },
    );

    const simulatedFinancialRisk = computeFinancialRiskSummary({
      products: network.products,
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: simulatedLanesWithContractBase,
      contracts: network.contracts,
      contractLines: simulatedContractLines,
      riskSignals,
      hiddenRiskByLaneId: buildHiddenFinancialRiskMap(
        simulatedLanesWithContractBase,
        simulatedPartnerHiddenSummaries,
      ),
      commercials: simulatedCommercials,
      asOfDate: isoDate,
      viewMode,
    });

    const financialDeltas = computeFinancialSimulationDelta({
      baseline: baselineFinancialRisk,
      simulated: simulatedFinancialRisk,
      baselineLanes: network.lanes,
      simulatedLanes: simulatedLanesWithContractBase,
      oneTimeQualificationEur: request.oneTimeQualificationEur,
    });

    const orgContext = buildOrgAnalyticsContext(organization, network.products);
    const incotermsByLaneId = buildLaneIncotermsMap(
      network.contracts,
      network.contractLines,
    );

    const baselineSummary = evaluateNetworkAnalytics({
      organization: orgContext,
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: network.lanes,
      riskSignals,
      partnerHiddenSummaries: baselinePartnerHiddenSummaries,
      laneCommercialsByLaneId: baselineCommercials.laneSummaries,
      incotermsByLaneId,
      asOfDate: effectiveAsOfDate,
    });

    const simulatedSummary = evaluateNetworkAnalytics({
      organization: orgContext,
      inputs: network.inputs,
      facilities: network.facilities,
      lanes: simulatedLanesWithContractBase,
      riskSignals,
      partnerHiddenSummaries: simulatedPartnerHiddenSummaries,
      laneCommercialsByLaneId: simulatedCommercials.laneSummaries,
      incotermsByLaneId,
      asOfDate: effectiveAsOfDate,
    });

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
    const baseHhi = summarizeHhi(baselineSummary);
    const simHhi = summarizeHhi(simulatedSummary);
    const baseRedAlerts = baselineSummary.alerts.filter(
      (a) => a.severity === "RED",
    ).length;
    const simRedAlerts = simulatedSummary.alerts.filter(
      (a) => a.severity === "RED",
    ).length;

    return SimulateAnalyticsResponseSchema.parse({
      baseline: { ...baselineSummary, financialRisk: baselineFinancialRisk },
      simulated: {
        ...simulatedSummary,
        financialRisk: simulatedFinancialRisk,
      },
      deltas: {
        resilienceScoreDelta: round2(
          simulatedSummary.resilienceScore - baselineSummary.resilienceScore,
        ),
        maxHhiDelta: round2(simHhi.maxHhi - baseHhi.maxHhi),
        avgHhiDelta: round2(simHhi.avgHhi - baseHhi.avgHhi),
        alertCountDelta:
          simulatedSummary.alerts.length - baselineSummary.alerts.length,
        redAlertCountDelta: simRedAlerts - baseRedAlerts,
        spofCountDelta: simHhi.spofCount - baseHhi.spofCount,
        transportScope3Tco2eDelta: round2(
          simulatedSummary.esg.transportScope3Tco2e -
            baselineSummary.esg.transportScope3Tco2e,
        ),
        totalTco2eDelta: round2(
          simulatedSummary.esg.totalTco2e - baselineSummary.esg.totalTco2e,
        ),
        financialDeltas,
      },
      appliedChangesCount,
    });
  }
}

import {
  evaluateNetworkAnalytics,
  simulateNetworkAnalytics,
  type HiddenPartnerAggregate,
} from "@kulgo/engine";
import {
  AnalyticsSummarySchema,
  SimulateAnalyticsResponseSchema,
  type AnalyticsSummary,
  type RiskSignal,
  type SimulateAnalyticsRequest,
  type SimulateAnalyticsResponse,
} from "@kulgo/shared";
import type { AuthRepository } from "../auth/repository.js";
import {
  assertOrgId,
  type NetworkFilters,
  type WorkspaceRepository,
} from "../workspace/repository.js";
import type { RiskSignalRepository } from "./risk-signals.js";

export class AnalyticsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsValidationError";
  }
}

export interface AnalyticsRepository {
  getSummary(
    orgId: string,
    filters?: NetworkFilters,
    asOfDate?: Date,
  ): Promise<AnalyticsSummary>;

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
  ): Promise<AnalyticsSummary> {
    const safeOrgId = assertOrgId(orgId);
    const [organization, network, riskSignals, partnerHiddenSummaries] =
      await Promise.all([
        this.authRepo.findOrganizationById(safeOrgId),
        this.workspaceRepo.getNetwork(safeOrgId, filters),
        this.riskSignalRepo.listActive(),
        this.resolvePartnerHiddenSummaries
          ? this.resolvePartnerHiddenSummaries(safeOrgId)
          : Promise.resolve(undefined),
      ]);

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

    return AnalyticsSummarySchema.parse(summary);
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

    const [organization, network, riskSignals, partnerHiddenSummaries] =
      await Promise.all([
        this.authRepo.findOrganizationById(safeOrgId),
        this.workspaceRepo.getNetwork(safeOrgId, filters),
        this.riskSignalRepo.listActive(),
        this.resolvePartnerHiddenSummaries
          ? this.resolvePartnerHiddenSummaries(safeOrgId)
          : Promise.resolve(undefined),
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

    const result = simulateNetworkAnalytics(
      {
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
      },
      request.laneChanges,
    );

    return SimulateAnalyticsResponseSchema.parse(result);
  }
}

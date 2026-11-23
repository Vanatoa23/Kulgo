import { randomUUID } from "node:crypto";
import {
  inferLaneChokepoints,
  matchFacilityRiskSignals,
  matchLaneRiskSignals,
  matchPartnerRegionRiskSignals,
  type AnonymizedPartnerRegionAlert,
  type FacilitySignalMatch,
  type LaneSignalMatch,
} from "@kulgo/engine";
import type {
  ChokepointCode,
  RiskSignal,
  WorkspaceNetworkResponse,
} from "@kulgo/shared";
import {
  MAX_TRAVERSAL_DEPTH,
  scopePartnerNetworkForReconciliation,
} from "../analytics/partner-resolver.js";
import type { RiskSignalRepository } from "../analytics/risk-signals.js";
import type { AuthRepository } from "../auth/repository.js";
import type { InvitationRepository } from "../invites/repository.js";
import type { WorkspaceRepository } from "../workspace/repository.js";
import type { AlertRepository } from "./alert-repository.js";
import { fetchStage1Signals } from "./feeds/stage1.js";
import {
  classifyUnstructuredItems,
  preFilterUnstructuredItems,
  type UnstructuredFeedItem,
} from "./feeds/stage2.js";
import type { LlmRouter } from "./llm-router.js";
import {
  dispatchInstantRedAlerts,
  type DispatchSummary,
  type EmailProvider,
  type OrgSignalMatchBundle,
} from "./notifications.js";
import type { WebhookDnsLookup } from "./webhook-security.js";

export const DEFAULT_SWEEP_LEASE_KEY = "global-intelligence-sweep";
export const DEFAULT_SWEEP_LEASE_TTL_MS = 15 * 60 * 1000;

export interface OrgMatchedFeed {
  signals: RiskSignal[];
  facilityMatches: FacilitySignalMatch[];
  laneMatches: LaneSignalMatch[];
  partnerRegionAlerts: AnonymizedPartnerRegionAlert[];
}

export interface SweepRunResult {
  startedAt: string;
  completedAt: string;
  skipped?: boolean;
  leaseKey?: string;
  stage1Fetched: number;
  stage2Classified: number;
  upsertedNew: number;
  upsertedMerged: number;
  resolvedExpired: number;
  dispatch: DispatchSummary;
  errors: string[];
}

export interface IntelligenceRunnerDeps {
  authRepo: AuthRepository;
  workspaceRepo: WorkspaceRepository;
  inviteRepo: InvitationRepository;
  riskSignalRepo: RiskSignalRepository;
  alertRepo: AlertRepository;
  llmRouter: LlmRouter;
  redEmailProvider?: EmailProvider | null;
  digestEmailProvider?: EmailProvider | null;
  fromEmail: string;
  fetchStage1?: () => Promise<{ signals: RiskSignal[]; errors: string[] }>;
  fetchStage2Raw?: () => Promise<UnstructuredFeedItem[]>;
  fetchFn?: typeof fetch;
  webhookDnsLookup?: WebhookDnsLookup;
  webhookTimeoutMs?: number;
}

function getActiveTier1FacilityIds(
  network: Pick<WorkspaceNetworkResponse, "facilities" | "lanes">,
): Set<string> {
  const lanesByFromFacility = new Map<string, { total: number; active: number }>();
  for (const lane of network.lanes) {
    const counts = lanesByFromFacility.get(lane.fromFacilityId) ?? {
      total: 0,
      active: 0,
    };
    counts.total += 1;
    if (lane.volumeSharePct > 0) {
      counts.active += 1;
    }
    lanesByFromFacility.set(lane.fromFacilityId, counts);
  }

  const activeTier1Ids = new Set<string>();
  for (const facility of network.facilities) {
    if (facility.isOwnFacility) continue;
    const laneCounts = lanesByFromFacility.get(facility.facilityId);
    // Include verified Tier-1 facilities in the current (possibly reconciled)
    // network unless they have mapped lanes that are all inactive (0% share).
    if (!laneCounts || laneCounts.active > 0) {
      activeTier1Ids.add(facility.facilityId);
    }
  }
  return activeTier1Ids;
}

/**
 * Coordinates Kulgo's "Pull Once, Match Many" ingestion pipeline and
 * 3-layer ArcadeDB / engine matching (Tier-1 Facilities, Tier-1 Lanes,
 * and strictly anonymized Tier-2+ partner regions).
 */
export class IntelligenceRunner {
  constructor(private readonly deps: IntelligenceRunnerDeps) {}

  private async collectPartnerRegions(
    orgId: string,
    buyerNetwork: WorkspaceNetworkResponse,
    visitedOrgIds: ReadonlySet<string>,
    depth: number,
    out: Array<{
      countryCode: string;
      regionCode: string | null;
      chokepoints: ChokepointCode[];
    }>,
  ): Promise<void> {
    if (depth >= MAX_TRAVERSAL_DEPTH) {
      return;
    }

    const partnerLinks =
      await this.deps.inviteRepo.listVerifiedPartnerLinksForOrg(orgId);
    if (partnerLinks.length === 0) {
      return;
    }

    const activeTier1Ids = getActiveTier1FacilityIds(buyerNetwork);
    if (activeTier1Ids.size === 0) {
      return;
    }

    for (const link of partnerLinks) {
      if (visitedOrgIds.has(link.partnerOrgId)) continue;
      if (!activeTier1Ids.has(link.targetFacilityId)) continue;

      const nextVisited = new Set(visitedOrgIds);
      nextVisited.add(link.partnerOrgId);

      const rawPartnerNetwork = await this.deps.workspaceRepo.getNetwork(
        link.partnerOrgId,
      );
      const partnerNetwork = scopePartnerNetworkForReconciliation(
        rawPartnerNetwork,
        link.fulfilledByFacilityId,
      );
      const partnerFacById = new Map(
        partnerNetwork.facilities.map((f) => [f.facilityId, f]),
      );

      for (const fac of partnerNetwork.facilities) {
        out.push({
          countryCode: fac.countryCode,
          regionCode: fac.regionCode,
          chokepoints: [],
        });
      }
      for (const lane of partnerNetwork.lanes) {
        if (lane.volumeSharePct <= 0) continue;
        const from = partnerFacById.get(lane.fromFacilityId);
        const to = partnerFacById.get(lane.toFacilityId);
        if (!from || !to) continue;
        const cps = inferLaneChokepoints(
          from.countryCode,
          to.countryCode,
          lane.transportMode,
        );
        if (cps.length > 0) {
          out.push({
            countryCode: from.countryCode,
            regionCode: null,
            chokepoints: cps,
          });
        }
      }

      await this.collectPartnerRegions(
        link.partnerOrgId,
        partnerNetwork,
        nextVisited,
        depth + 1,
        out,
      );
    }
  }

  /**
   * Computes all 3 layers of active RiskSignal matches for a single organization.
   * Layer 3 traverses verified partner networks strictly server-side (depth-4
   * cycle-safe with two-sided `fulfilledByFacilityId` facility-subgraph binding
   * aligned with `partner-resolver.ts`) and emits ONLY coarse anonymized
   * regional/chokepoint alerts (zero Tier-2+ identity).
   */
  async evaluateOrgAlertFeed(
    orgId: string,
    nowIso = new Date().toISOString(),
  ): Promise<OrgMatchedFeed> {
    const [signals, network] = await Promise.all([
      this.deps.riskSignalRepo.listActive(),
      this.deps.workspaceRepo.getNetwork(orgId),
    ]);

    const facilitiesById = new Map(
      network.facilities.map((f) => [f.facilityId, f]),
    );
    const facilityMatches = matchFacilityRiskSignals(
      network.facilities,
      signals,
      nowIso,
    );
    const laneMatches = matchLaneRiskSignals(
      network.lanes,
      facilitiesById,
      signals,
      nowIso,
    );

    // Layer 3: collect coarse country/region/chokepoint metadata from verified
    // partner networks strictly in memory — never expose partner IDs/names/coords.
    const partnerRegions: Array<{
      countryCode: string;
      regionCode: string | null;
      chokepoints: ChokepointCode[];
    }> = [];
    await this.collectPartnerRegions(
      orgId,
      network,
      new Set<string>([orgId]),
      0,
      partnerRegions,
    );

    const partnerRegionAlerts = matchPartnerRegionRiskSignals(
      partnerRegions,
      signals,
      nowIso,
    );

    return {
      signals,
      facilityMatches,
      laneMatches,
      partnerRegionAlerts,
    };
  }

  /**
   * Executes one full Pull-Once-Match-Many sweep guarded by a persisted
   * ArcadeDB sweep lease so multiple replicas or restarts do not run
   * concurrent duplicate sweeps:
   * 1. Acquire persisted sweep lease
   * 2. Stage 1 deterministic structured feeds
   * 3. Stage 2 pre-filtered unstructured feeds -> AI API Centre
   * 4. Canonical deduplicated upsert into RiskSignalRepository
   * 5. Resolve expired signals
   * 6. Match against organizations and dispatch anti-fatigue RED alerts
   */
  async runSweep(options: {
    nowIso?: string;
    orgIds?: readonly string[];
    leaseKey?: string;
    leaseOwnerId?: string;
    leaseTtlMs?: number;
    preventRerunAfterComplete?: boolean;
  } = {}): Promise<SweepRunResult> {
    const startedAt = options.nowIso ?? new Date().toISOString();
    const leaseKey = options.leaseKey ?? DEFAULT_SWEEP_LEASE_KEY;
    const ownerId = options.leaseOwnerId ?? randomUUID();
    const ttlMs = options.leaseTtlMs ?? DEFAULT_SWEEP_LEASE_TTL_MS;

    const executionAcquired = await this.deps.alertRepo.acquireSweepLease({
      leaseKey: DEFAULT_SWEEP_LEASE_KEY, ownerId, nowIso: startedAt, ttlMs,
    });
    let acquired = executionAcquired;
    if (executionAcquired && leaseKey !== DEFAULT_SWEEP_LEASE_KEY) {
      try {
        acquired = await this.deps.alertRepo.acquireSweepLease({
      leaseKey,
      ownerId,
      nowIso: startedAt,
      ttlMs,
      preventRerunAfterComplete: options.preventRerunAfterComplete,
        });
      } catch (err) {
        await this.deps.alertRepo.releaseSweepLease({ leaseKey: DEFAULT_SWEEP_LEASE_KEY, ownerId, status: "FAILED", completedAt: new Date().toISOString() });
        throw err;
      }
      if (!acquired) await this.deps.alertRepo.releaseSweepLease({ leaseKey: DEFAULT_SWEEP_LEASE_KEY, ownerId, status: "FAILED", completedAt: new Date().toISOString() });
    }
    if (!acquired) {
      return {
        startedAt,
        completedAt: startedAt,
        skipped: true,
        leaseKey,
        stage1Fetched: 0,
        stage2Classified: 0,
        upsertedNew: 0,
        upsertedMerged: 0,
        resolvedExpired: 0,
        dispatch: {
          emailsSent: 0,
          webhooksSent: 0,
          skippedDuplicate: 0,
          skippedUnverified: 0,
          skippedMuted: 0,
        },
        errors: [],
      };
    }

    const errors: string[] = [];
    try {
      const stage1 = this.deps.fetchStage1
        ? await this.deps.fetchStage1()
        : await fetchStage1Signals({ fetchFn: this.deps.fetchFn, nowIso: startedAt });
      errors.push(...stage1.errors);

      let stage2Signals: RiskSignal[] = [];
      if (this.deps.fetchStage2Raw) {
        const rawItems = await this.deps.fetchStage2Raw();
        const filtered = preFilterUnstructuredItems(rawItems);
        const classified = await classifyUnstructuredItems(
          filtered,
          this.deps.llmRouter,
          startedAt,
        );
        stage2Signals = classified.signals;
        errors.push(...classified.errors);
      }

      let upsertedNew = 0;
      let upsertedMerged = 0;
      const allIncoming = [...stage1.signals, ...stage2Signals];
      for (const sig of allIncoming) {
        const res = await this.deps.riskSignalRepo.upsertSignal(sig);
        if (res.created) upsertedNew++;
        else upsertedMerged++;
      }

      const resolvedExpired =
        await this.deps.riskSignalRepo.resolveExpired(startedAt);

      // Match & dispatch for target orgs
      const orgIds = options.orgIds ?? [];
      const bundles: OrgSignalMatchBundle[] = [];
      for (const orgId of orgIds) {
        const feed = await this.evaluateOrgAlertFeed(orgId, startedAt);
        for (const signal of feed.signals) {
          const facHits = feed.facilityMatches.filter(
            (m) => m.signalId === signal.signalId,
          );
          const laneHits = feed.laneMatches.filter(
            (m) => m.signalId === signal.signalId,
          );
          const partnerHits = feed.partnerRegionAlerts.filter(
            (a) => a.signalId === signal.signalId,
          );
          if (
            facHits.length > 0 ||
            laneHits.length > 0 ||
            partnerHits.length > 0
          ) {
            bundles.push({
              orgId,
              signal,
              facilityMatches: facHits,
              laneMatches: laneHits,
              partnerRegionAlerts: partnerHits,
            });
          }
        }
      }

      const dispatch = await dispatchInstantRedAlerts(bundles, {
        alertRepo: this.deps.alertRepo,
        redEmailProvider: this.deps.redEmailProvider,
        digestEmailProvider: this.deps.digestEmailProvider,
        fromEmail: this.deps.fromEmail,
        fetchFn: this.deps.fetchFn,
        webhookDnsLookup: this.deps.webhookDnsLookup,
        webhookTimeoutMs: this.deps.webhookTimeoutMs,
        nowIso: startedAt,
      });

      const completedAt = new Date().toISOString();
      await this.deps.alertRepo.releaseSweepLease({
        leaseKey,
        ownerId,
        status: "COMPLETED",
        completedAt,
        lastError: errors.length > 0 ? errors.join("; ").slice(0, 500) : null,
      });

      return {
        startedAt,
        completedAt,
        skipped: false,
        leaseKey,
        stage1Fetched: stage1.signals.length,
        stage2Classified: stage2Signals.length,
        upsertedNew,
        upsertedMerged,
        resolvedExpired,
        dispatch,
        errors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.alertRepo
        .releaseSweepLease({
          leaseKey,
          ownerId,
          status: "FAILED",
          completedAt: new Date().toISOString(),
          lastError: message.slice(0, 500),
        })
        .catch(() => undefined);
      throw err;
    } finally {
      if (leaseKey !== DEFAULT_SWEEP_LEASE_KEY) {
        await this.deps.alertRepo.releaseSweepLease({ leaseKey: DEFAULT_SWEEP_LEASE_KEY, ownerId, status: "COMPLETED", completedAt: new Date().toISOString() });
      }
    }
  }
}

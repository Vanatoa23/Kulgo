import {
  inferLaneChokepoints,
  matchFacilityRiskSignals,
  matchLaneRiskSignals,
  matchPartnerRegionRiskSignals,
  type AnonymizedPartnerRegionAlert,
  type FacilitySignalMatch,
  type LaneSignalMatch,
} from "@kulgo/engine";
import type { ChokepointCode, RiskSignal } from "@kulgo/shared";
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

export interface OrgMatchedFeed {
  signals: RiskSignal[];
  facilityMatches: FacilitySignalMatch[];
  laneMatches: LaneSignalMatch[];
  partnerRegionAlerts: AnonymizedPartnerRegionAlert[];
}

export interface SweepRunResult {
  startedAt: string;
  completedAt: string;
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

/**
 * Coordinates Kulgo's "Pull Once, Match Many" ingestion pipeline and
 * 3-layer ArcadeDB / engine matching (Tier-1 Facilities, Tier-1 Lanes,
 * and strictly anonymized Tier-2+ partner regions).
 */
export class IntelligenceRunner {
  private readonly articleVersions = new Map<string, string>();

  constructor(private readonly deps: IntelligenceRunnerDeps) {}

  /**
   * Computes all 3 layers of active RiskSignal matches for a single organization.
   * Layer 3 traverses verified partner networks strictly server-side and emits
   * ONLY coarse anonymized regional/chokepoint alerts (zero Tier-2+ identity).
   */
  async evaluateOrgAlertFeed(
    orgId: string,
    nowIso = new Date().toISOString(),
  ): Promise<OrgMatchedFeed> {
    const [signals, network, partnerLinks] = await Promise.all([
      this.deps.riskSignalRepo.listActive(),
      this.deps.workspaceRepo.getNetwork(orgId),
      this.deps.inviteRepo.listVerifiedPartnerLinksForOrg(orgId),
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
    const visitedPartnerOrgs = new Set<string>([orgId]);

    for (const link of partnerLinks) {
      if (visitedPartnerOrgs.has(link.partnerOrgId)) continue;
      visitedPartnerOrgs.add(link.partnerOrgId);

      const partnerNetwork = await this.deps.workspaceRepo.getNetwork(
        link.partnerOrgId,
      );
      const partnerFacById = new Map(
        partnerNetwork.facilities.map((f) => [f.facilityId, f]),
      );

      for (const fac of partnerNetwork.facilities) {
        partnerRegions.push({
          countryCode: fac.countryCode,
          regionCode: fac.regionCode,
          chokepoints: [],
        });
      }
      for (const lane of partnerNetwork.lanes) {
        const from = partnerFacById.get(lane.fromFacilityId);
        const to = partnerFacById.get(lane.toFacilityId);
        if (!from || !to) continue;
        const cps = inferLaneChokepoints(
          from.countryCode,
          to.countryCode,
          lane.transportMode,
        );
        if (cps.length > 0) {
          partnerRegions.push({
            countryCode: from.countryCode,
            regionCode: null,
            chokepoints: cps,
          });
        }
      }
    }

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
   * Executes one full Pull-Once-Match-Many sweep:
   * 1. Stage 1 deterministic structured feeds
   * 2. Stage 2 pre-filtered unstructured feeds -> AI API Centre
   * 3. Canonical deduplicated upsert into RiskSignalRepository
   * 4. Resolve expired signals
   * 5. Match against organizations and dispatch anti-fatigue RED alerts
   */
  async runSweep(options: {
    nowIso?: string;
    orgIds?: readonly string[];
  } = {}): Promise<SweepRunResult> {
    const startedAt = options.nowIso ?? new Date().toISOString();
    const errors: string[] = [];

    const stage1 = this.deps.fetchStage1
      ? await this.deps.fetchStage1()
      : await fetchStage1Signals({ fetchFn: this.deps.fetchFn, nowIso: startedAt });
    errors.push(...stage1.errors);

    let stage2Signals: RiskSignal[] = [];
    if (this.deps.fetchStage2Raw) {
      const [rawItems, activeSignals] = await Promise.all([
        this.deps.fetchStage2Raw(),
        this.deps.riskSignalRepo.listActive(),
      ]);
      const cutoffMs = Date.parse(startedAt) - 72 * 3_600_000;
      const recentSignals = activeSignals.filter((sig) => {
        const refIso = sig.lastSeenAt ?? sig.publishedAt;
        if (!refIso) return true;
        const refMs = Date.parse(refIso);
        return Number.isNaN(refMs) || refMs >= cutoffMs;
      });
      // Active signals contain derived descriptions, not the original article content.
      // Only a previously classified version can establish that an article is unchanged.
      const seenUrls = new Set<string>();
      const changedUrls = new Set<string>();
      const activeUrls = new Set(activeSignals.flatMap((sig) => sig.sourceUrls));
      for (const item of rawItems) {
        const version = JSON.stringify([item.title, item.summary, item.publishedAt]);
        const previous = this.articleVersions.get(item.sourceUrl);
        if (previous === version) seenUrls.add(item.sourceUrl);
        else if (previous !== undefined || activeUrls.has(item.sourceUrl)) changedUrls.add(item.sourceUrl);
      }
      const recentTitles = [...recentSignals, ...stage1.signals]
        .map((sig) => sig.title).filter(Boolean);
      const filtered = preFilterUnstructuredItems(
        rawItems,
        seenUrls,
        recentTitles,
        changedUrls,
      );
      const classified = await classifyUnstructuredItems(
        filtered,
        this.deps.llmRouter,
        startedAt,
      );
      // Do not cache failed or unconfigured classifications: they must be retried.
      if (classified.errors.length === 0 && classified.providersUsed.length > 0) {
        for (const item of filtered) {
          this.articleVersions.set(item.sourceUrl, JSON.stringify([item.title, item.summary, item.publishedAt]));
        }
      }
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

    return {
      startedAt,
      completedAt: new Date().toISOString(),
      stage1Fetched: stage1.signals.length,
      stage2Classified: stage2Signals.length,
      upsertedNew,
      upsertedMerged,
      resolvedExpired,
      dispatch,
      errors,
    };
  }
}


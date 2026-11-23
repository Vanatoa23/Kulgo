import {
  FacilitySchema,
  RiskSignalSchema,
  SupplyLaneSchema,
  WorkspaceNetworkResponseSchema,
  type WorkspaceNetworkResponse,
} from "@kulgo/shared";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { InMemoryRiskSignalRepository } from "../src/analytics/risk-signals.js";
import { InMemoryAuthRepository } from "../src/auth/repository.js";
import type { ArcadeDbClient } from "../src/db/client.js";
import {
  ArcadeDbAlertRepository,
  InMemoryAlertRepository,
} from "../src/intelligence/alert-repository.js";
import {
  createGeminiAdapter,
  createOpenAiCompatibleAdapter,
  LlmBudgetExceededError,
  LlmProviderHttpError,
  LlmRouter,
  type LlmProviderAdapter,
} from "../src/intelligence/llm-router.js";
import {
  dispatchInstantRedAlerts,
  InMemoryCaptureEmailProvider,
  type EmailProvider,
} from "../src/intelligence/notifications.js";
import { IntelligenceRunner } from "../src/intelligence/runner.js";
import { nextUtcSweepSlot } from "../src/intelligence/scheduler.js";
import {
  InMemoryInvitationRepository,
  type VerifiedPartnerLinkRecord,
} from "../src/invites/repository.js";
import { InMemoryWorkspaceRepository } from "../src/workspace/repository.js";

const uuid = (n: number) =>
  `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;

function makeFacility(
  n: number,
  orgId: string,
  countryCode: string,
  isOwnFacility: boolean,
  name = `Facility ${n}`,
) {
  return FacilitySchema.parse({
    facilityId: uuid(n),
    ownerOrgId: orgId,
    name,
    kind: "FACTORY",
    locationPrecision: "SITE_VERIFIED",
    countryCode,
    lat: 50 + (n % 10),
    lng: 10 + (n % 10),
    isOwnFacility,
  });
}

function makeLane(
  n: number,
  orgId: string,
  fromFacilityId: string,
  toFacilityId: string,
  volumeSharePct = 100,
) {
  return SupplyLaneSchema.parse({
    laneId: uuid(n),
    ownerOrgId: orgId,
    fromFacilityId,
    toFacilityId,
    materialCategory: "Electronics",
    transportMode: "SEA",
    volumeSharePct,
    annualSpendEur: 500_000,
    riskStatus: "GREEN",
  });
}

function makeConfirmedRedSignal(
  signalId: string,
  countryCodes: string[],
  title = "Confirmed Port Disruption",
) {
  return RiskSignalSchema.parse({
    signalId,
    kind: "PORT_CONGESTION",
    severity: "RED",
    title,
    description: "Severe confirmed operational disruption",
    regionCode: countryCodes[0] ?? null,
    affectedCountryCodes: countryCodes,
    affectedChokepoints: [],
    affectedSectors: [],
    polygonWkt: "POLYGON EMPTY",
    sourceUrls: ["https://gdacs.org/report/1"],
    publishedAt: "2026-11-21T06:00:00Z",
    lastSeenAt: "2026-11-21T06:00:00Z",
    expiresAt: "2026-11-28T06:00:00Z",
    resolvedAt: null,
    dedupeKey: `dedupe-${signalId}`,
    confidence: 0.95,
    verificationStatus: "CONFIRMED",
    lifecycle: "ACTIVE",
    active: true,
  });
}

describe("Issue #67.1 — LlmRouter header auth, cooldown circuit breaker & token accounting", () => {
  it("sends Gemini API key in x-goog-api-key header (never in URL), passes maxOutputTokens, and captures token usage", async () => {
    const captured: Array<{
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      captured.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ status: "ok" }) }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 140,
            candidatesTokenCount: 35,
            totalTokenCount: 175,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const secretKey = "AIza-super-secret-gemini-key-999";
    const router = new LlmRouter([
      createGeminiAdapter(secretKey, "gemini-2.5-flash-lite", mockFetch),
    ]);

    const res = await router.generateStructured(
      z.object({ status: z.string() }),
      { systemPrompt: "sys", userPrompt: "usr", maxOutputTokens: 512 },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).not.toContain("key=");
    expect(captured[0]!.url).not.toContain(secretKey);
    expect(captured[0]!.headers["x-goog-api-key"]).toBe(secretKey);
    expect(
      (captured[0]!.body.generationConfig as Record<string, unknown>)
        .maxOutputTokens,
    ).toBe(512);
    expect(res.usage).toEqual({
      promptTokens: 140,
      completionTokens: 35,
      totalTokens: 175,
    });
    expect(router.getDailyUsage()).toMatchObject({
      requests: 1,
      promptTokens: 140,
      completionTokens: 35,
      totalTokens: 175,
    });
  });

  it("passes max_completion_tokens and captures token usage on OpenAI-compatible adapters", async () => {
    let sentBody: Record<string, unknown> = {};
    const mockFetch: typeof fetch = async (_input, init) => {
      sentBody = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
          usage: {
            prompt_tokens: 210,
            completion_tokens: 45,
            total_tokens: 255,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const router = new LlmRouter([
      createOpenAiCompatibleAdapter({
        name: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: "groq-secret-key",
        model: "llama-3.3-70b-versatile",
        fetchFn: mockFetch,
      }),
    ]);

    const res = await router.generateStructured(
      z.object({ ok: z.boolean() }),
      { systemPrompt: "sys", userPrompt: "usr", maxOutputTokens: 1024 },
    );

    expect(sentBody.max_completion_tokens).toBe(1024);
    expect(res.usage).toEqual({
      promptTokens: 210,
      completionTokens: 45,
      totalTokens: 255,
    });
  });

  it("puts a rate-limited primary provider into 60s cooldown after consecutive 429/5xx failures and recovers after cooldown", async () => {
    let nowMs = Date.parse("2026-11-21T12:00:00Z");
    let primaryCalls = 0;
    let primaryHealthy = false;

    const primary: LlmProviderAdapter = {
      name: "gemini",
      model: "gemini-2.5-flash-lite",
      async completeJson() {
        primaryCalls++;
        if (!primaryHealthy) {
          throw new LlmProviderHttpError("gemini", 429);
        }
        return {
          text: JSON.stringify({ ok: true }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      },
    };
    const fallback: LlmProviderAdapter = {
      name: "groq",
      model: "llama-3.3-70b-versatile",
      async completeJson() {
        return {
          text: JSON.stringify({ ok: true }),
          usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
        };
      },
    };

    const router = new LlmRouter([primary, fallback], {
      cooldownMs: 60_000,
      failureThreshold: 2,
      nowFn: () => nowMs,
    });
    const schema = z.object({ ok: z.boolean() });

    // Failure 1 -> falls back to groq, not yet in cooldown
    const r1 = await router.generateStructured(schema, {
      systemPrompt: "s",
      userPrompt: "u1",
    });
    expect(r1.provider).toBe("groq");
    expect(primaryCalls).toBe(1);
    expect(router.isProviderInCooldown("gemini")).toBe(false);

    // Failure 2 -> hits failureThreshold (2), enters 60s cooldown
    const r2 = await router.generateStructured(schema, {
      systemPrompt: "s",
      userPrompt: "u2",
    });
    expect(r2.provider).toBe("groq");
    expect(primaryCalls).toBe(2);
    expect(router.isProviderInCooldown("gemini")).toBe(true);

    // Batch 3 (10s later): primary is skipped immediately without calling completeJson
    nowMs += 10_000;
    const r3 = await router.generateStructured(schema, {
      systemPrompt: "s",
      userPrompt: "u3",
    });
    expect(r3.provider).toBe("groq");
    expect(primaryCalls).toBe(2);
    expect(r3.attempts[0]).toEqual({
      provider: "gemini",
      skippedReason: "cooldown",
    });

    // Batch 4 (61s after cooldown start): primary is probed again and recovers
    nowMs += 51_000;
    primaryHealthy = true;
    expect(router.isProviderInCooldown("gemini")).toBe(false);
    const r4 = await router.generateStructured(schema, {
      systemPrompt: "s",
      userPrompt: "u4",
    });
    expect(r4.provider).toBe("gemini");
    expect(primaryCalls).toBe(3);
  });

  it("enforces configurable daily request and token ceilings and resets on next UTC day", async () => {
    let nowMs = Date.parse("2026-11-21T23:59:00Z");
    const adapter: LlmProviderAdapter = {
      name: "gemini",
      model: "gemini-2.5-flash-lite",
      async completeJson() {
        return {
          text: JSON.stringify({ ok: true }),
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
        };
      },
    };
    const schema = z.object({ ok: z.boolean() });

    const reqLimited = new LlmRouter([adapter], {
      maxDailyRequests: 1,
      nowFn: () => nowMs,
    });
    await reqLimited.generateStructured(schema, {
      systemPrompt: "s",
      userPrompt: "u1",
    });
    await expect(
      reqLimited.generateStructured(schema, {
        systemPrompt: "s",
        userPrompt: "u2",
      }),
    ).rejects.toBeInstanceOf(LlmBudgetExceededError);

    // Advance into next UTC day -> budget resets
    nowMs = Date.parse("2026-11-22T00:01:00Z");
    const afterMidnight = await reqLimited.generateStructured(schema, {
      systemPrompt: "s",
      userPrompt: "u3",
    });
    expect(afterMidnight.data.ok).toBe(true);

    // Token ceiling enforcement
    const tokenLimited = new LlmRouter([adapter], {
      maxDailyTokens: 250,
      nowFn: () => nowMs,
    });
    await tokenLimited.generateStructured(schema, {
      systemPrompt: "s",
      userPrompt: "u1",
    });
    await expect(
      tokenLimited.generateStructured(schema, {
        systemPrompt: "s",
        userPrompt: "u2",
      }),
    ).rejects.toBeInstanceOf(LlmBudgetExceededError);
  });
});

describe("Issue #67.2 — Atomic alert delivery claim / outbox", () => {
  it("prevents duplicate RED emails and webhooks when two sweeps overlap concurrently", async () => {
    const alertRepo = new InMemoryAlertRepository();
    const orgId = uuid(1);
    const signal = makeConfirmedRedSignal("sig-concurrent-red", ["EE"]);

    await alertRepo.upsertNotificationPreference({
      orgId,
      instantRedEmailEnabled: true,
      emailRecipients: ["ops@kulgo.eu"],
      webhookUrl: "https://hooks.example/kulgo",
    });

    let emailsSent = 0;
    const slowEmailProvider: EmailProvider = {
      name: "resend",
      async send() {
        await new Promise((resolve) => setTimeout(resolve, 25));
        emailsSent++;
      },
    };

    let webhooksSent = 0;
    const slowWebhookFetch: typeof fetch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      webhooksSent++;
      return new Response("ok", { status: 200 });
    };

    const bundle = [
      {
        orgId,
        signal,
        facilityMatches: [],
        laneMatches: [],
        partnerRegionAlerts: [],
      },
    ];
    const deps = {
      alertRepo,
      redEmailProvider: slowEmailProvider,
      fromEmail: "alerts@kulgo.eu",
      fetchFn: slowWebhookFetch,
      webhookDnsLookup: async () => [
        { address: "93.184.216.34", family: 4 as const },
      ],
    };

    const [run1, run2] = await Promise.all([
      dispatchInstantRedAlerts(bundle, deps),
      dispatchInstantRedAlerts(bundle, deps),
    ]);

    expect(emailsSent).toBe(1);
    expect(webhooksSent).toBe(1);
    expect(run1.emailsSent + run2.emailsSent).toBe(1);
    expect(run1.webhooksSent + run2.webhooksSent).toBe(1);
    expect(run1.skippedDuplicate + run2.skippedDuplicate).toBe(2);
  });

  it("does not re-send while a delivery is PENDING (mid-dispatch crash) and allows retry after explicit FAILED", async () => {
    const alertRepo = new InMemoryAlertRepository();
    const orgId = uuid(2);
    const signal = makeConfirmedRedSignal("sig-crash-pending", ["DE"]);

    await alertRepo.upsertNotificationPreference({
      orgId,
      instantRedEmailEnabled: true,
      emailRecipients: ["ops@kulgo.eu"],
    });

    // Simulate a worker that claimed PENDING and crashed before recording SENT/FAILED
    const firstClaim = await alertRepo.claimDelivery({
      orgId,
      signalId: signal.signalId,
      channel: "EMAIL_RED",
      provider: "resend",
      claimedAt: "2026-11-21T08:00:00Z",
    });
    expect(firstClaim).toBe(true);

    const emailProvider = new InMemoryCaptureEmailProvider();
    const afterCrash = await dispatchInstantRedAlerts(
      [
        {
          orgId,
          signal,
          facilityMatches: [],
          laneMatches: [],
          partnerRegionAlerts: [],
        },
      ],
      {
        alertRepo,
        redEmailProvider: emailProvider,
        fromEmail: "alerts@kulgo.eu",
      },
    );
    expect(afterCrash.emailsSent).toBe(0);
    expect(afterCrash.skippedDuplicate).toBe(1);
    expect(emailProvider.sent).toHaveLength(0);

    // If delivery was explicitly marked FAILED, a later sweep can re-claim and succeed
    await alertRepo.recordDelivery({
      orgId,
      signalId: signal.signalId,
      channel: "EMAIL_RED",
      status: "FAILED",
      provider: "resend",
      errorMessage: "Resend HTTP 503",
      deliveredAt: "2026-11-21T08:01:00Z",
    });

    const retryRun = await dispatchInstantRedAlerts(
      [
        {
          orgId,
          signal,
          facilityMatches: [],
          laneMatches: [],
          partnerRegionAlerts: [],
        },
      ],
      {
        alertRepo,
        redEmailProvider: emailProvider,
        fromEmail: "alerts@kulgo.eu",
      },
    );
    expect(retryRun.emailsSent).toBe(1);
    expect(emailProvider.sent).toHaveLength(1);
  });

  it("handles ArcadeDB unique-key conflict on claimDelivery by returning false without throwing", async () => {
    const mockDb: ArcadeDbClient = {
      async healthCheck() {
        return { connected: true, latencyMs: 1 };
      },
      async ensureDatabase() {},
      async query() {
        return [];
      },
      async command() {
        throw new Error(
          "ArcadeDB request error (500): com.arcadedb.exception.DuplicatedKeyException: Duplicate key",
        );
      },
    };
    const repo = new ArcadeDbAlertRepository(mockDb);
    const claimed = await repo.claimDelivery({
      orgId: uuid(3),
      signalId: "sig-race",
      channel: "EMAIL_RED",
      provider: "resend",
      claimedAt: "2026-11-21T08:00:00Z",
    });
    expect(claimed).toBe(false);
  });
});

describe("Issue #67.3 — Depth-4 cycle-safe Layer-3 partner alert matching & fulfilledByFacilityId scoping", () => {
  it("traverses up to depth 4, terminates cycles safely, and enforces zero Tier-2+ identity leakage", async () => {
    const authRepo = new InMemoryAuthRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const inviteRepo = new InMemoryInvitationRepository({
      authRepo,
      workspaceRepo,
    });
    const alertRepo = new InMemoryAlertRepository();

    const orgA = uuid(10);
    const orgB = uuid(11);
    const orgC = uuid(12);
    const orgD = uuid(13);
    const orgE = uuid(14); // depth 3 (4th hop: A->B->C->D->E) -> INCLUDED
    const orgF = uuid(15); // depth 4 (5th hop: E->F) -> EXCLUDED by MAX_TRAVERSAL_DEPTH=4

    const networks = new Map<string, WorkspaceNetworkResponse>([
      [
        orgA,
        WorkspaceNetworkResponseSchema.parse({
          facilities: [
            makeFacility(101, orgA, "EE", true, "OrgA Own"),
            makeFacility(102, orgA, "FI", false, "OrgA Tier1 -> B"),
          ],
          lanes: [makeLane(201, orgA, uuid(102), uuid(101))],
          products: [],
          inputs: [],
        }),
      ],
      [
        orgB,
        WorkspaceNetworkResponseSchema.parse({
          facilities: [
            makeFacility(111, orgB, "FI", true, "OrgB Own"),
            makeFacility(112, orgB, "SE", false, "OrgB Tier1 -> C"),
          ],
          lanes: [makeLane(211, orgB, uuid(112), uuid(111))],
          products: [],
          inputs: [],
        }),
      ],
      [
        orgC,
        WorkspaceNetworkResponseSchema.parse({
          facilities: [
            makeFacility(121, orgC, "SE", true, "OrgC Own"),
            makeFacility(122, orgC, "DE", false, "OrgC Tier1 -> D"),
            // Cycle back to Org A should terminate cleanly
            makeFacility(123, orgC, "EE", false, "OrgC Cycle -> A"),
          ],
          lanes: [
            makeLane(221, orgC, uuid(122), uuid(121)),
            makeLane(222, orgC, uuid(123), uuid(121)),
          ],
          products: [],
          inputs: [],
        }),
      ],
      [
        orgD,
        WorkspaceNetworkResponseSchema.parse({
          facilities: [
            makeFacility(131, orgD, "DE", true, "OrgD Own"),
            makeFacility(132, orgD, "PL", false, "OrgD Tier1 -> E"),
          ],
          lanes: [makeLane(231, orgD, uuid(132), uuid(131))],
          products: [],
          inputs: [],
        }),
      ],
      [
        orgE,
        WorkspaceNetworkResponseSchema.parse({
          facilities: [
            makeFacility(141, orgE, "JP", true, "SECRET-TIER4-PLANT-JP"),
            makeFacility(142, orgE, "KR", false, "OrgE Tier1 -> F"),
          ],
          lanes: [makeLane(241, orgE, uuid(142), uuid(141))],
          products: [],
          inputs: [],
        }),
      ],
      [
        orgF,
        WorkspaceNetworkResponseSchema.parse({
          facilities: [
            makeFacility(151, orgF, "AU", true, "SECRET-TIER5-PLANT-AU"),
          ],
          lanes: [],
          products: [],
          inputs: [],
        }),
      ],
    ]);

    const linksByOrg = new Map<string, VerifiedPartnerLinkRecord[]>([
      [
        orgA,
        [
          {
            inviteId: uuid(301),
            fromOrgId: orgA,
            targetFacilityId: uuid(102),
            partnerOrgId: orgB,
            linkedAt: "2026-11-21T00:00:00Z",
          },
        ],
      ],
      [
        orgB,
        [
          {
            inviteId: uuid(302),
            fromOrgId: orgB,
            targetFacilityId: uuid(112),
            partnerOrgId: orgC,
            linkedAt: "2026-11-21T00:00:00Z",
          },
        ],
      ],
      [
        orgC,
        [
          {
            inviteId: uuid(303),
            fromOrgId: orgC,
            targetFacilityId: uuid(122),
            partnerOrgId: orgD,
            linkedAt: "2026-11-21T00:00:00Z",
          },
          {
            inviteId: uuid(304),
            fromOrgId: orgC,
            targetFacilityId: uuid(123),
            partnerOrgId: orgA, // cycle back to root org
            linkedAt: "2026-11-21T00:00:00Z",
          },
        ],
      ],
      [
        orgD,
        [
          {
            inviteId: uuid(305),
            fromOrgId: orgD,
            targetFacilityId: uuid(132),
            partnerOrgId: orgE,
            linkedAt: "2026-11-21T00:00:00Z",
          },
        ],
      ],
      [
        orgE,
        [
          {
            inviteId: uuid(306),
            fromOrgId: orgE,
            targetFacilityId: uuid(142),
            partnerOrgId: orgF,
            linkedAt: "2026-11-21T00:00:00Z",
          },
        ],
      ],
    ]);

    vi.spyOn(workspaceRepo, "getNetwork").mockImplementation(async (orgId) => {
      return (
        networks.get(orgId) ??
        WorkspaceNetworkResponseSchema.parse({
          facilities: [],
          lanes: [],
          products: [],
          inputs: [],
        })
      );
    });
    vi.spyOn(inviteRepo, "listVerifiedPartnerLinksForOrg").mockImplementation(
      async (orgId) => linksByOrg.get(orgId) ?? [],
    );

    const riskSignalRepo = new InMemoryRiskSignalRepository([
      makeConfirmedRedSignal("sig-depth4-jp", ["JP"], "Japan Port Closure"),
      makeConfirmedRedSignal("sig-depth5-au", ["AU"], "Australia Port Closure"),
    ]);

    const runner = new IntelligenceRunner({
      authRepo,
      workspaceRepo,
      inviteRepo,
      riskSignalRepo,
      alertRepo,
      llmRouter: new LlmRouter([]),
      fromEmail: "alerts@kulgo.eu",
    });

    const feed = await runner.evaluateOrgAlertFeed(
      orgA,
      "2026-11-21T08:00:00Z",
    );

    const matchedIds = feed.partnerRegionAlerts.map((a) => a.signalId);
    expect(matchedIds).toContain("sig-depth4-jp");
    expect(matchedIds).not.toContain("sig-depth5-au");

    // Strict privacy contract check: zero Tier-2+ orgIds, facilityIds, or names
    const serialized = JSON.stringify(feed.partnerRegionAlerts);
    for (const forbidden of [
      orgB,
      orgC,
      orgD,
      orgE,
      orgF,
      uuid(141),
      "SECRET-TIER4-PLANT-JP",
      "SECRET-TIER5-PLANT-AU",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("scopes partner alert matching strictly to fulfilledByFacilityId subgraph and falls back conservatively when omitted", async () => {
    const authRepo = new InMemoryAuthRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const inviteRepo = new InMemoryInvitationRepository({
      authRepo,
      workspaceRepo,
    });
    const alertRepo = new InMemoryAlertRepository();

    const orgA = uuid(40);
    const orgB = uuid(41);

    const plant1Id = uuid(411);
    const plant2Id = uuid(412);
    const twSupplierId = uuid(413);
    const brSupplierId = uuid(414);

    const networkA = WorkspaceNetworkResponseSchema.parse({
      facilities: [
        makeFacility(401, orgA, "EE", true, "OrgA Own"),
        makeFacility(402, orgA, "DE", false, "OrgA Tier1 -> B"),
      ],
      lanes: [makeLane(450, orgA, uuid(402), uuid(401))],
      products: [],
      inputs: [],
    });
    const networkB = WorkspaceNetworkResponseSchema.parse({
      facilities: [
        makeFacility(411, orgB, "DE", true, "OrgB Plant 1"),
        makeFacility(412, orgB, "DE", true, "OrgB Plant 2"),
        makeFacility(413, orgB, "TW", false, "Tier2 TW Supplier"),
        makeFacility(414, orgB, "BR", false, "Tier2 BR Supplier"),
      ],
      lanes: [
        makeLane(451, orgB, twSupplierId, plant1Id),
        makeLane(452, orgB, brSupplierId, plant2Id),
      ],
      products: [],
      inputs: [],
    });

    vi.spyOn(workspaceRepo, "getNetwork").mockImplementation(async (orgId) =>
      orgId === orgA ? networkA : networkB,
    );

    let boundFacilityId: string | null = plant1Id;
    vi.spyOn(inviteRepo, "listVerifiedPartnerLinksForOrg").mockImplementation(
      async (orgId) =>
        orgId === orgA
          ? [
              {
                inviteId: uuid(490),
                fromOrgId: orgA,
                targetFacilityId: uuid(402),
                partnerOrgId: orgB,
                linkedAt: "2026-11-21T00:00:00Z",
                fulfilledByFacilityId: boundFacilityId,
              },
            ]
          : [],
    );

    const riskSignalRepo = new InMemoryRiskSignalRepository([
      makeConfirmedRedSignal("sig-tw", ["TW"], "Taiwan Disruption"),
      makeConfirmedRedSignal("sig-br", ["BR"], "Brazil Disruption"),
    ]);

    const runner = new IntelligenceRunner({
      authRepo,
      workspaceRepo,
      inviteRepo,
      riskSignalRepo,
      alertRepo,
      llmRouter: new LlmRouter([]),
      fromEmail: "alerts@kulgo.eu",
    });

    // Bound to Plant 1 -> matches TW only, excludes unrelated Plant 2 (BR)
    const scopedFeed = await runner.evaluateOrgAlertFeed(
      orgA,
      "2026-11-21T08:00:00Z",
    );
    expect(scopedFeed.partnerRegionAlerts.map((a) => a.signalId)).toEqual([
      "sig-tw",
    ]);

    // Unbound (conservative fallback) -> matches both TW and BR
    boundFacilityId = null;
    const fallbackFeed = await runner.evaluateOrgAlertFeed(
      orgA,
      "2026-11-21T08:00:00Z",
    );
    expect(fallbackFeed.partnerRegionAlerts.map((a) => a.signalId).sort()).toEqual(
      ["sig-br", "sig-tw"],
    );
  });
});

describe("Issue #67.4 — Persisted sweep lease prevents concurrent & duplicate replica sweeps", () => {
  it("prevents concurrent overlapping sweeps and skips duplicate scheduled slot runs after completion", async () => {
    const authRepo = new InMemoryAuthRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const inviteRepo = new InMemoryInvitationRepository({
      authRepo,
      workspaceRepo,
    });
    const riskSignalRepo = new InMemoryRiskSignalRepository([]);
    const alertRepo = new InMemoryAlertRepository();

    let stage1Calls = 0;
    const runner = new IntelligenceRunner({
      authRepo,
      workspaceRepo,
      inviteRepo,
      riskSignalRepo,
      alertRepo,
      llmRouter: new LlmRouter([]),
      fromEmail: "alerts@kulgo.eu",
      fetchStage1: async () => {
        stage1Calls++;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { signals: [], errors: [] };
      },
    });

    const slot = nextUtcSweepSlot(new Date("2026-11-21T05:30:00Z"));
    expect(slot.slotKey).toBe("scheduled:2026-11-21T06:00Z");

    // Two replicas fire concurrently for the same scheduled slot
    const [r1, r2] = await Promise.all([
      runner.runSweep({
        nowIso: "2026-11-21T06:00:00Z",
        leaseKey: slot.slotKey,
        leaseOwnerId: "replica-a",
        preventRerunAfterComplete: true,
      }),
      runner.runSweep({
        nowIso: "2026-11-21T06:00:00Z",
        leaseKey: slot.slotKey,
        leaseOwnerId: "replica-b",
        preventRerunAfterComplete: true,
      }),
    ]);

    expect(stage1Calls).toBe(1);
    expect([r1.skipped, r2.skipped].sort()).toEqual([false, true]);

    const lease = await alertRepo.getSweepLease(slot.slotKey);
    expect(lease?.status).toBe("COMPLETED");

    // Third replica / container restart firing seconds later for the same slot is skipped
    const r3 = await runner.runSweep({
      nowIso: "2026-11-21T06:00:10Z",
      leaseKey: slot.slotKey,
      leaseOwnerId: "replica-c",
      preventRerunAfterComplete: true,
    });
    expect(r3.skipped).toBe(true);
    expect(stage1Calls).toBe(1);
  });

  it("reclaims an expired RUNNING lease after a crashed worker and releases as FAILED on error", async () => {
    const authRepo = new InMemoryAuthRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const inviteRepo = new InMemoryInvitationRepository({
      authRepo,
      workspaceRepo,
    });
    const riskSignalRepo = new InMemoryRiskSignalRepository([]);
    const alertRepo = new InMemoryAlertRepository();

    // Seed a stale RUNNING lease from a crashed worker
    const acquiredByCrashed = await alertRepo.acquireSweepLease({
      leaseKey: "scheduled:2026-11-21T12:00Z",
      ownerId: "crashed-worker",
      nowIso: "2026-11-21T12:00:00Z",
      ttlMs: 60_000,
    });
    expect(acquiredByCrashed).toBe(true);

    // Before expiry -> blocked
    const beforeExpiry = await alertRepo.acquireSweepLease({
      leaseKey: "scheduled:2026-11-21T12:00Z",
      ownerId: "healthy-worker",
      nowIso: "2026-11-21T12:00:30Z",
      ttlMs: 60_000,
    });
    expect(beforeExpiry).toBe(false);

    // After expiry -> healthy runner reclaims, fails once, then another runner retries & succeeds
    let shouldFail = true;
    const runner = new IntelligenceRunner({
      authRepo,
      workspaceRepo,
      inviteRepo,
      riskSignalRepo,
      alertRepo,
      llmRouter: new LlmRouter([]),
      fromEmail: "alerts@kulgo.eu",
      fetchStage1: async () => {
        if (shouldFail) {
          throw new Error("Simulated transient Stage 1 crash");
        }
        return { signals: [], errors: [] };
      },
    });

    await expect(
      runner.runSweep({
        nowIso: "2026-11-21T12:02:00Z",
        leaseKey: "scheduled:2026-11-21T12:00Z",
        leaseOwnerId: "worker-2",
        preventRerunAfterComplete: true,
      }),
    ).rejects.toThrow("Simulated transient Stage 1 crash");

    const failedLease = await alertRepo.getSweepLease(
      "scheduled:2026-11-21T12:00Z",
    );
    expect(failedLease?.status).toBe("FAILED");
    expect(failedLease?.lastError).toContain("Simulated transient Stage 1 crash");

    shouldFail = false;
    const retryRes = await runner.runSweep({
      nowIso: "2026-11-21T12:02:10Z",
      leaseKey: "scheduled:2026-11-21T12:00Z",
      leaseOwnerId: "worker-3",
      preventRerunAfterComplete: true,
    });
    expect(retryRes.skipped).toBe(false);
    const completedLease = await alertRepo.getSweepLease(
      "scheduled:2026-11-21T12:00Z",
    );
    expect(completedLease?.status).toBe("COMPLETED");
  });
});

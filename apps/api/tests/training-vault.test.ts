import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  RiskSignalSchema,
  TRAINING_VAULT_SCHEMA_VERSION,
  type AnonymizedAlertFeedbackVaultRecord,
  type RawFeedVaultRecord,
} from "@kulgo/shared";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryRiskSignalRepository } from "../src/analytics/risk-signals.js";
import { createTestApp } from "../src/app.js";
import { InMemoryAuthRepository } from "../src/auth/repository.js";
import { InMemoryAlertRepository } from "../src/intelligence/alert-repository.js";
import { LlmRouter } from "../src/intelligence/llm-router.js";
import { IntelligenceRunner } from "../src/intelligence/runner.js";
import {
  LocalFsTrainingVaultSink,
  NoopTrainingVaultSink,
  S3TrainingVaultSink,
  buildTrainingVaultKey,
  createTrainingVaultSinkFromConfig,
  safeWriteVaultBatch,
  serializeRecordsToJsonlGzip,
  sha256Hex,
  type TrainingVaultSink,
} from "../src/intelligence/training-vault.js";
import { InMemoryInvitationRepository } from "../src/invites/repository.js";
import { InMemoryWorkspaceRepository } from "../src/workspace/repository.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kulgo-training-vault-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("Training Data Vault (Issue #69)", () => {
  it("builds partitioned .jsonl.gz keys for Plane A and Plane B", () => {
    const recordedAt = new Date("2026-04-09T12:00:00.000Z");
    expect(
      buildTrainingVaultKey({
        plane: "global_public",
        dataset: "raw_feeds",
        batchId: "2026-04-09T12",
        recordedAt,
      }),
    ).toBe(
      "training-vault/v1/global_public/raw_feeds/year=2026/month=04/day=09/2026-04-09T12.jsonl.gz",
    );

    expect(
      buildTrainingVaultKey({
        plane: "anonymized_outcomes",
        dataset: "anonymized_alert_feedback",
        batchId: "fb-123",
        recordedAt,
      }),
    ).toBe(
      "training-vault/v1/anonymized_outcomes/anonymized_alert_feedback/year=2026/month=04/day=09/fb-123.jsonl.gz",
    );
  });

  it("enforces copyright EXCERPT_ONLY invariant (rejects non-null fullText)", () => {
    const badRecord: RawFeedVaultRecord = {
      schemaVersion: TRAINING_VAULT_SCHEMA_VERSION,
      plane: "global_public",
      sweepId: "sweep-1",
      sourceId: "example.com",
      stage: "STAGE_2",
      url: "https://example.com/news/port-strike",
      publisherDomain: "example.com",
      fetchedAt: "2026-04-09T12:00:00.000Z",
      publishedAt: "2026-04-09T10:00:00.000Z",
      language: "en",
      contentSha256: sha256Hex("example"),
      contentPolicy: "EXCERPT_ONLY",
      licenseTag: "COPYRIGHTED_EXCERPT",
      title: "Port strike halts terminals",
      summary: "Container terminals paused operations.",
      fullText: "Full copyrighted article body should never be allowed",
      preFilterPassed: true,
      preFilterReason: "PASSED",
      matchedKeywords: ["port", "strike"],
    };

    expect(() =>
      serializeRecordsToJsonlGzip("raw_feeds", [badRecord]),
    ).toThrow(/fullText must be null when contentPolicy is EXCERPT_ONLY/i);
  });

  it("writes and decompresses .jsonl.gz batches via LocalFsTrainingVaultSink", async () => {
    const dir = await makeTempDir();
    const sink = new LocalFsTrainingVaultSink(dir);
    const recordedAt = new Date("2026-04-09T12:00:00.000Z");

    const record: AnonymizedAlertFeedbackVaultRecord = {
      schemaVersion: TRAINING_VAULT_SCHEMA_VERSION,
      plane: "anonymized_outcomes",
      labelProvenance: "HUMAN_VERIFIED",
      signalId: "sig-baltic-01",
      reasonCode: "FALSE_OR_OUTDATED_EVENT",
      eventCategory: "PORT_CONGESTION",
      severity: "RED",
      countryCode: "EE",
      timestampBucket: "2026-04-09",
    };

    const result = await sink.writeBatch(
      "anonymized_alert_feedback",
      [record],
      { batchId: "fb-test-1", recordedAt },
    );

    expect(result.recordCount).toBe(1);
    expect(result.bytesWritten).toBeGreaterThan(0);

    const compressed = await readFile(join(dir, result.key));
    const lines = gunzipSync(compressed).toString("utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(record);
  });

  it("uploads gzipped JSONL to EU S3-compatible bucket via S3TrainingVaultSink", async () => {
    const sentCommands: PutObjectCommand[] = [];
    const sink = new S3TrainingVaultSink({
      bucket: "kulgo-eu-vault",
      endpoint: "https://hel1.your-objectstorage.com",
      region: "eu-central-1",
      forcePathStyle: true,
      client: {
        async send(cmd: PutObjectCommand) {
          sentCommands.push(cmd);
          return {};
        },
      },
    });

    const result = await sink.writeBatch(
      "anonymized_alert_feedback",
      [
        {
          schemaVersion: TRAINING_VAULT_SCHEMA_VERSION,
          plane: "anonymized_outcomes",
          labelProvenance: "HUMAN_VERIFIED",
          signalId: "sig-s3-01",
          reasonCode: "HANDLED",
          eventCategory: "SANCTIONS",
          severity: "RED",
          countryCode: "LV",
          timestampBucket: "2026-04-09",
        },
      ],
      {
        batchId: "fb-s3",
        recordedAt: new Date("2026-04-09T12:00:00.000Z"),
      },
    );

    expect(sentCommands).toHaveLength(1);
    const input = sentCommands[0]!.input;
    expect(input.Bucket).toBe("kulgo-eu-vault");
    expect(input.Key).toBe(result.key);
    expect(input.ContentType).toBe("application/x-ndjson");
    expect(input.ContentEncoding).toBe("gzip");
    const decoded = gunzipSync(input.Body as Buffer).toString("utf8").trim();
    expect(JSON.parse(decoded).signalId).toBe("sig-s3-01");
  });

  it("selects S3, LocalFs, or Noop sink from config and never throws via safeWriteVaultBatch", async () => {
    expect(createTrainingVaultSinkFromConfig({}).kind).toBe("noop");
    expect(
      createTrainingVaultSinkFromConfig({ TRAINING_VAULT_DIR: "/tmp/kulgo" })
        .kind,
    ).toBe("local_fs");
    expect(
      createTrainingVaultSinkFromConfig({
        TRAINING_VAULT_S3_BUCKET: "kulgo-bucket",
      }).kind,
    ).toBe("s3");

    const failingSink: TrainingVaultSink = {
      kind: "s3",
      async writeBatch() {
        throw new Error("Simulated S3 outage");
      },
    };
    const capturedErrors: string[] = [];
    const res = await safeWriteVaultBatch(
      failingSink,
      "anonymized_alert_feedback",
      [
        {
          schemaVersion: TRAINING_VAULT_SCHEMA_VERSION,
          plane: "anonymized_outcomes",
          labelProvenance: "HUMAN_VERIFIED",
          signalId: "sig-1",
          reasonCode: "HANDLED",
          eventCategory: null,
          severity: null,
          countryCode: null,
          timestampBucket: "2026-04-09",
        },
      ],
      undefined,
      (err) => {
        capturedErrors.push(err instanceof Error ? err.message : String(err));
      },
    );
    expect(res).toBeNull();
    expect(capturedErrors).toEqual(["Simulated S3 outage"]);

    const noopRes = await new NoopTrainingVaultSink().writeBatch(
      "raw_feeds",
      [],
    );
    expect(noopRes.skipped).toBe(true);
  });

  it("archives Stage 1/2 raw_feeds (kept + dropped), llm_extractions, and signal_lifecycles during IntelligenceRunner.runSweep", async () => {
    const dir = await makeTempDir();
    const trainingVault = new LocalFsTrainingVaultSink(dir);
    const authRepo = new InMemoryAuthRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const inviteRepo = new InMemoryInvitationRepository({
      authRepo,
      workspaceRepo,
    });
    const riskSignalRepo = new InMemoryRiskSignalRepository();
    const alertRepo = new InMemoryAlertRepository();

    const llmRouter = new LlmRouter([
      {
        name: "mock-gemini",
        model: "gemini-2.5-flash-lite",
        async completeJson() {
          return {
            text: JSON.stringify({
              signals: [
                {
                  articleId: "art-1",
                  evidenceQuote: "Port of Tallinn dockworker strike halts berths",
                  kind: "LABOR_INDUSTRIAL",
                  severity: "RED",
                  title: "Port of Tallinn Dockworker Strike",
                  description: "Dockworker strike impacting container berths.",
                  affectedCountryCodes: ["EE"],
                  affectedChokepoints: ["BALTIC_SEA"],
                  affectedSectors: ["Logistics"],
                  lifecycle: "ACTIVE",
                  eventStartAt: null,
                  eventEndAt: null,
                  confidence: 0.88,
                },
              ],
            }),
            usage: {
              promptTokens: 120,
              completionTokens: 80,
              totalTokens: 200,
            },
          };
        },
      },
    ]);

    const runner = new IntelligenceRunner({
      authRepo,
      workspaceRepo,
      inviteRepo,
      riskSignalRepo,
      alertRepo,
      llmRouter,
      trainingVault,
      fromEmail: "alerts@kulgo.eu",
      fetchStage1: async () => ({
        signals: [
          RiskSignalSchema.parse({
            signalId: "sig-gdacs-01",
            kind: "CLIMATE",
            severity: "YELLOW",
            title: "Baltic Storm Advisory",
            description: "Official public storm warning across northern Baltic.",
            regionCode: "EE",
            affectedCountryCodes: ["EE"],
            affectedChokepoints: ["BALTIC_SEA"],
            polygonWkt: "POLYGON EMPTY",
            sourceUrls: ["https://www.gdacs.org/report.aspx?eventid=1"],
            publishedAt: "2026-04-09T08:00:00.000Z",
            lastSeenAt: "2026-04-09T12:00:00.000Z",
            verificationStatus: "CONFIRMED",
            lifecycle: "ACTIVE",
            active: true,
          }),
        ],
        errors: [],
      }),
      fetchStage2Raw: async () => [
        {
          articleId: "art-1",
          title: "Port of Tallinn dockworker strike halts berths",
          summary: "Port of Tallinn dockworker strike halts berths across Muuga.",
          sourceUrl: "https://news.err.ee/tallinn-port-strike",
          publishedAt: "2026-04-09T10:00:00.000Z",
        },
        {
          articleId: "art-2",
          title: "Local bakery opens new cafe in Tartu",
          summary: "Fresh sourdough bread now available downtown.",
          sourceUrl: "https://news.err.ee/tartu-bakery",
          publishedAt: "2026-04-09T09:00:00.000Z",
        },
      ],
    });

    const result = await runner.runSweep({
      nowIso: "2026-04-09T12:00:00.000Z",
      leaseKey: "2026-04-09T12",
    });
    expect(result.skipped).toBe(false);
    expect(result.stage1Fetched).toBe(1);
    expect(result.stage2Classified).toBe(1);

    const readDataset = async (dataset: string) => {
      const file = join(
        dir,
        `training-vault/v1/global_public/${dataset}/year=2026/month=04/day=09/2026-04-09T12.jsonl.gz`,
      );
      const text = gunzipSync(await readFile(file)).toString("utf8").trim();
      return text.split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    };

    // 1. raw_feeds: 1 Stage 1 (FULL_TEXT) + 2 Stage 2 (1 passed, 1 dropped, both EXCERPT_ONLY with fullText: null)
    const rawFeeds = await readDataset("raw_feeds");
    expect(rawFeeds).toHaveLength(3);
    const stage1Feed = rawFeeds.find((r) => r.stage === "STAGE_1")!;
    expect(stage1Feed.contentPolicy).toBe("FULL_TEXT");
    expect(stage1Feed.fullText).toContain("Official public storm warning");

    const passedStage2 = rawFeeds.find(
      (r) => r.url === "https://news.err.ee/tallinn-port-strike",
    )!;
    expect(passedStage2.preFilterPassed).toBe(true);
    expect(passedStage2.contentPolicy).toBe("EXCERPT_ONLY");
    expect(passedStage2.fullText).toBeNull();

    const droppedStage2 = rawFeeds.find(
      (r) => r.url === "https://news.err.ee/tartu-bakery",
    )!;
    expect(droppedStage2.preFilterPassed).toBe(false);
    expect(droppedStage2.preFilterReason).toBe("NO_DISRUPTION_KEYWORD");
    expect(droppedStage2.fullText).toBeNull();

    // 2. llm_extractions: 1 batch with LLM_SILVER provenance + token usage + aligned contentSha256 join key
    const extractions = await readDataset("llm_extractions");
    expect(extractions).toHaveLength(1);
    expect(extractions[0]!.labelProvenance).toBe("LLM_SILVER");
    expect(extractions[0]!.provider).toBe("mock-gemini");
    expect(extractions[0]!.promptTokens).toBe(120);
    expect(extractions[0]!.validationPassed).toBe(true);
    expect(extractions[0]!.articleContentSha256s).toEqual([
      passedStage2.contentSha256,
    ]);
    expect(String(extractions[0]!.rawOutput)).toContain(
      "Port of Tallinn Dockworker Strike",
    );

    // 3. signal_lifecycles: 2 upserted signals with aligned mergedArticleContentSha256s
    const lifecycles = await readDataset("signal_lifecycles");
    expect(lifecycles).toHaveLength(2);
    const stage1Lifecycle = lifecycles.find(
      (l) => l.signalId === "sig-gdacs-01",
    )!;
    expect(stage1Lifecycle.labelProvenance).toBe("RULE_VERIFIED");
    expect(stage1Lifecycle.mergedArticleContentSha256s).toEqual([
      stage1Feed.contentSha256,
    ]);
    const stage2Lifecycle = lifecycles.find((l) =>
      String(l.signalId).startsWith("sig-s2-"),
    )!;
    expect(stage2Lifecycle.labelProvenance).toBe("LLM_SILVER");
    expect(stage2Lifecycle.mergedArticleContentSha256s).toEqual([
      passedStage2.contentSha256,
    ]);
  });

  it("records ACTIVE -> RESOLVED transitions and observedDurationHours from resolveExpired()", async () => {
    const dir = await makeTempDir();
    const trainingVault = new LocalFsTrainingVaultSink(dir);
    const authRepo = new InMemoryAuthRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const inviteRepo = new InMemoryInvitationRepository({
      authRepo,
      workspaceRepo,
    });
    const expiringSignal = RiskSignalSchema.parse({
      signalId: "sig-expiring-01",
      kind: "PORT_CONGESTION",
      severity: "RED",
      title: "Temporary Port Closure",
      description: "Berths closed for 48 hours.",
      regionCode: "EE",
      affectedCountryCodes: ["EE"],
      affectedChokepoints: ["BALTIC_SEA"],
      polygonWkt: "POLYGON EMPTY",
      sourceUrls: ["https://www.gdacs.org/report.aspx?eventid=99"],
      publishedAt: "2026-04-07T12:00:00.000Z",
      lastSeenAt: "2026-04-07T12:00:00.000Z",
      expiresAt: "2026-04-09T11:00:00.000Z",
      verificationStatus: "CONFIRMED",
      lifecycle: "ACTIVE",
      active: true,
    });
    const riskSignalRepo = new InMemoryRiskSignalRepository([expiringSignal]);
    const alertRepo = new InMemoryAlertRepository();

    const runner = new IntelligenceRunner({
      authRepo,
      workspaceRepo,
      inviteRepo,
      riskSignalRepo,
      alertRepo,
      llmRouter: new LlmRouter([]),
      trainingVault,
      fromEmail: "alerts@kulgo.eu",
      fetchStage1: async () => ({ signals: [], errors: [] }),
    });

    const result = await runner.runSweep({
      nowIso: "2026-04-09T12:00:00.000Z",
      leaseKey: "2026-04-09T12",
    });
    expect(result.resolvedExpired).toBe(1);

    const file = join(
      dir,
      "training-vault/v1/global_public/signal_lifecycles/year=2026/month=04/day=09/2026-04-09T12.jsonl.gz",
    );
    const lines = gunzipSync(await readFile(file))
      .toString("utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.signalId).toBe("sig-expiring-01");
    expect(lines[0]!.previousStatus).toBe("ACTIVE");
    expect(lines[0]!.lifecycleStatus).toBe("RESOLVED");
    expect(lines[0]!.resolvedAt).toBe("2026-04-09T12:00:00.000Z");
    expect(lines[0]!.observedDurationHours).toBe(48);
  });

  it("preserves actual failing fallback provider, model, and malformed rawOutput in llm_extractions", async () => {
    const dir = await makeTempDir();
    const trainingVault = new LocalFsTrainingVaultSink(dir);
    const authRepo = new InMemoryAuthRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const inviteRepo = new InMemoryInvitationRepository({
      authRepo,
      workspaceRepo,
    });
    const riskSignalRepo = new InMemoryRiskSignalRepository([]);
    const alertRepo = new InMemoryAlertRepository();

    const llmRouter = new LlmRouter([
      {
        name: "gemini",
        model: "gemini-2.5-flash-lite",
        async completeJson() {
          throw new Error("Gemini HTTP 503");
        },
      },
      {
        name: "groq",
        model: "llama-3.3-70b-versatile",
        async completeJson() {
          return { text: "{broken-json-output" };
        },
      },
    ]);

    const runner = new IntelligenceRunner({
      authRepo,
      workspaceRepo,
      inviteRepo,
      riskSignalRepo,
      alertRepo,
      llmRouter,
      trainingVault,
      fromEmail: "alerts@kulgo.eu",
      fetchStage1: async () => ({ signals: [], errors: [] }),
      fetchStage2Raw: async () => [
        {
          articleId: "art-fail",
          title: "Port strike halts Baltic container terminal",
          summary: "Port strike halts Baltic container terminal operations.",
          sourceUrl: "https://news.err.ee/port-strike-fail",
          publishedAt: "2026-04-09T10:00:00.000Z",
        },
      ],
    });

    await runner.runSweep({
      nowIso: "2026-04-09T12:00:00.000Z",
      leaseKey: "2026-04-09T12",
    });

    const file = join(
      dir,
      "training-vault/v1/global_public/llm_extractions/year=2026/month=04/day=09/2026-04-09T12.jsonl.gz",
    );
    const [extraction] = gunzipSync(await readFile(file))
      .toString("utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(extraction!.validationPassed).toBe(false);
    expect(extraction!.provider).toBe("groq");
    expect(extraction!.model).toBe("llama-3.3-70b-versatile");
    expect(extraction!.rawOutput).toBe("{broken-json-output");
  });

  it("handles empty TRAINING_VAULT_S3_FORCE_PATH_STYLE and rejects half-configured S3 credentials", async () => {
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig({
      NODE_ENV: "test",
      TRAINING_VAULT_S3_FORCE_PATH_STYLE: "",
      TRAINING_VAULT_S3_REGION: "",
    });
    expect(cfg.TRAINING_VAULT_S3_FORCE_PATH_STYLE).toBe(true);
    expect(cfg.TRAINING_VAULT_S3_REGION).toBe("eu-central-1");

    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        TRAINING_VAULT_S3_BUCKET: "kulgo-eu-vault",
        TRAINING_VAULT_S3_ACCESS_KEY_ID: "only-key-id",
      }),
    ).toThrow(/TRAINING_VAULT_S3_ACCESS_KEY_ID/);
  });

  it("archives Plane B anonymized_alert_feedback (including resolved signals) and respects per-org allowAnonymizedTraining opt-out", async () => {
    const writtenBatches: Array<{ dataset: string; records: unknown[] }> = [];
    const captureSink: TrainingVaultSink = {
      kind: "local_fs",
      async writeBatch(dataset, records) {
        // Still run strict serialization to verify zero privacy violations
        const buf = serializeRecordsToJsonlGzip(dataset, records);
        writtenBatches.push({ dataset, records: [...records] });
        return {
          key: `mock/${dataset}.jsonl.gz`,
          recordCount: records.length,
          bytesWritten: buf.byteLength,
        };
      },
    };

    const app = createTestApp({}, { trainingVault: captureSink });

    const regRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationName: "Baltic Steel OÜ",
        email: "owner@baltic-steel.ee",
        password: "StrongPassword123!",
      }),
    });
    expect(regRes.status).toBe(201);
    const cookie = regRes.headers.get("set-cookie")!.split(";")[0]!;

    // Default allowAnonymizedTraining is true -> ack with reason writes anonymized Plane B record
    const ackRes1 = await app.request("/api/v1/alerts/sig-latvia-sanctions-01/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        status: "MUTED",
        reason: "FALSE_OR_OUTDATED_EVENT",
        note: "Confidential internal note mentioning Plant Tallinn #4",
      }),
    });
    expect(ackRes1.status).toBe(200);
    expect(writtenBatches).toHaveLength(1);
    expect(writtenBatches[0]!.dataset).toBe("anonymized_alert_feedback");
    const serialized = JSON.stringify(writtenBatches[0]!.records[0]);
    expect(serialized).toContain("FALSE_OR_OUTDATED_EVENT");
    expect(serialized).not.toContain("Baltic Steel");
    expect(serialized).not.toContain("owner@baltic-steel.ee");
    expect(serialized).not.toContain("Plant Tallinn");

    // Opt out of anonymized training via PATCH /api/v1/alerts/preferences
    const prefRes = await app.request("/api/v1/alerts/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ allowAnonymizedTraining: false }),
    });
    expect(prefRes.status).toBe(200);
    const prefBody = (await prefRes.json()) as { allowAnonymizedTraining: boolean };
    expect(prefBody.allowAnonymizedTraining).toBe(false);

    // Subsequent ack must NOT write anything to the Training Data Vault
    const ackRes2 = await app.request("/api/v1/alerts/sig-china-corridor-01/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        status: "ACKNOWLEDGED",
        reason: "HANDLED",
      }),
    });
    expect(ackRes2.status).toBe(200);
    expect(writtenBatches).toHaveLength(1);
  });
});

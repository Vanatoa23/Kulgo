import { describe, expect, it, vi } from "vitest";
import { ArcadeDbRiskSignalRepository, DEMO_RISK_SIGNALS } from "../src/analytics/risk-signals.js";
import type { ArcadeDbClient } from "../src/db/client.js";
import { InMemoryAlertRepository } from "../src/intelligence/alert-repository.js";
import { LlmRouter } from "../src/intelligence/llm-router.js";
import { InMemoryCaptureEmailProvider } from "../src/intelligence/notifications.js";
import { IntelligenceRunner } from "../src/intelligence/runner.js";
import { InMemoryAuthRepository } from "../src/auth/repository.js";
import { InMemoryInvitationRepository } from "../src/invites/repository.js";
import { InMemoryWorkspaceRepository } from "../src/workspace/repository.js";
import { seedEstoniaProductXDemo } from "../src/workspace/seed-demo.js";

// Exercise the SQL repository and its consumers with a small stateful database double.
function database() {
  const rows: Record<string, unknown>[] = [];
  const db: ArcadeDbClient = {
    async healthCheck() { return { connected: true, latencyMs: 0 }; },
    async ensureDatabase() {},
    async query<T>(_language: unknown, sql: string, params?: Record<string, unknown>): Promise<T[]> {
      let selected = rows;
      if (sql.includes("expiresAt IS NOT NULL")) {
        selected = rows.filter(r => r.active && typeof r.expiresAt === "string" && r.expiresAt <= String(params?.nowIso));
      } else if (sql.includes("WHERE active = true")) {
        selected = rows.filter(r => r.active);
      } else if (sql.includes("WHERE signalId")) {
        selected = rows.filter(r => r.signalId === params?.signalId || (params?.dedupeKey && r.dedupeKey === params.dedupeKey));
      }
      return selected.map(r => ({ ...r })) as T[];
    },
    async command<T>(_language: unknown, sql: string, params?: Record<string, unknown>): Promise<T[]> {
      if (sql.includes("CREATE VERTEX")) rows.push({ ...params });
      else if (sql.includes("expiresAt IS NOT NULL")) {
        for (const r of rows) if (r.active && typeof r.expiresAt === "string" && r.expiresAt <= String(params?.nowIso)) Object.assign(r, { active: false, lifecycle: "RESOLVED", resolvedAt: params?.nowIso });
      } else if (sql.includes("UPDATE RiskSignal")) {
        const row = rows.find(r => r.signalId === params?.signalId);
        if (row) Object.assign(row, params);
      }
      return [];
    },
  };
  return db;
}

describe("database risk signals", () => {
  it("returns no signals for an empty database and after the last signal expires", async () => {
    const repo = new ArcadeDbRiskSignalRepository(database());
    expect(await repo.listActive()).toEqual([]);
    const real = { ...DEMO_RISK_SIGNALS[0]!, signalId: "real-signal", expiresAt: "2026-01-01T00:00:00Z" };
    await repo.upsertSignal(real);
    expect((await repo.listActive()).map(s => s.signalId)).toEqual(["real-signal"]);
    expect(await repo.resolveExpired("2026-01-02T00:00:00Z")).toBe(1);
    expect(await repo.listActive()).toEqual([]);
  });

  it("persists demo signals only when explicitly seeded", async () => {
    const repo = new ArcadeDbRiskSignalRepository(database());
    expect(await repo.listActive()).toEqual([]);
    expect((await repo.ensureDemoSignals()).map(s => s.signalId)).toEqual(DEMO_RISK_SIGNALS.map(s => s.signalId));
    expect((await repo.listActive()).map(s => s.signalId)).toEqual(DEMO_RISK_SIGNALS.map(s => s.signalId));
    expect(await repo.ensureDemoSignals()).toHaveLength(2);
  });

  it("does not dispatch demo alerts on empty or fully expired production feeds", async () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const riskSignalRepo = new ArcadeDbRiskSignalRepository(database());
    const authRepo = new InMemoryAuthRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    await seedEstoniaProductXDemo(workspaceRepo, orgId);
    const inviteRepo = new InMemoryInvitationRepository({ authRepo, workspaceRepo });
    const alertRepo = new InMemoryAlertRepository();
    await alertRepo.upsertNotificationPreference({ orgId, instantRedEmailEnabled: true, emailRecipients: ["ops@example.com"], webhookUrl: "https://example.com/hook", webhookSecret: "a-long-secret-for-test-purposes" });
    const email = new InMemoryCaptureEmailProvider();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("ok"));
    const runner = new IntelligenceRunner({ authRepo, workspaceRepo, inviteRepo, riskSignalRepo, alertRepo, llmRouter: new LlmRouter([]), redEmailProvider: email, fromEmail: "alerts@example.com", fetchFn, fetchStage1: async () => ({ signals: [], errors: [] }) });
    const empty = await runner.runSweep({ orgIds: [orgId], nowIso: "2026-01-02T00:00:00Z" });
    expect(empty.dispatch.emailsSent).toBe(0);
    expect(empty.dispatch.webhooksSent).toBe(0);
    await riskSignalRepo.upsertSignal({ ...DEMO_RISK_SIGNALS[0]!, signalId: "real-signal", expiresAt: "2026-01-01T00:00:00Z" });
    const expired = await runner.runSweep({ orgIds: [orgId], nowIso: "2026-01-02T00:00:00Z" });
    expect(expired.resolvedExpired).toBe(1);
    expect(expired.dispatch.emailsSent).toBe(0);
    expect(expired.dispatch.webhooksSent).toBe(0);
    expect(email.sent).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

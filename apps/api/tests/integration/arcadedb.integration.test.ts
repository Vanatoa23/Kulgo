import { createInvitationFixture, invitationConcurrencyCases } from "../invitation-concurrency-cases.js";
import { ArcadeDbInvitationRepository } from "../../src/invites/repository.js";
import { randomUUID } from "node:crypto";
import { verifyConcurrentOwnerRemoval } from "../helpers/member-removal.js";
import { memberRemovalCases } from "../helpers/member-removal-cases.js";
import { ArcadeDbAuthRepository } from "../../src/auth/repository.js";
import {
  AcceptInviteResponseSchema,
  AnalyticsSummarySchema,
  AuthMeResponseSchema,
  BulkImportSummarySchema,
  CreateInviteResponseSchema,
  ExecutiveReportSchema,
  UpdateOrganizationProfileResponseSchema,
  WorkspaceExportJsonSchema,
  WorkspaceNetworkResponseSchema,
} from "@kulgo/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { HttpArcadeDbClient, type ArcadeDbClient, type QueryLanguage } from "../../src/db/client.js";
import { bootstrapSchema } from "../../src/db/schema.js";
import { ArcadeDbWorkspaceRepository } from "../../src/workspace/repository.js";

const ARCADEDB_URL = process.env.ARCADEDB_URL;
const describeWithArcadeDb = ARCADEDB_URL ? describe : describe.skip;

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = /kulgo_session=([^;]+)/.exec(header);
  if (!match?.[1]) {
    throw new Error("Expected kulgo_session cookie");
  }
  return `kulgo_session=${match[1]}`;
}

describeWithArcadeDb("Live ArcadeDB Integration Tests", () => {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    ARCADEDB_URL: ARCADEDB_URL ?? "http://127.0.0.1:2480",
    ARCADEDB_DATABASE: process.env.ARCADEDB_DATABASE ?? "kulgo_ci",
    ARCADEDB_USER: process.env.ARCADEDB_USER ?? "root",
    ARCADEDB_PASSWORD: process.env.ARCADEDB_PASSWORD ?? "ci-test-password",
  });

  const db = new HttpArcadeDbClient({
    url: config.ARCADEDB_URL,
    database: config.ARCADEDB_DATABASE,
    user: config.ARCADEDB_USER,
    password: config.ARCADEDB_PASSWORD,
  });

  const app = createApp({ config, db });
  const workspaceRepo = new ArcadeDbWorkspaceRepository(db);
  const runId = randomUUID().slice(0, 8);

  beforeAll(async () => {
    await bootstrapSchema(db);
  }, 30_000);

  describe("Atomic member removal", () => {
    memberRemovalCases(() => [new ArcadeDbAuthRepository(db), new ArcadeDbAuthRepository(db)]);

    it("rolls back deletion and session revocation if the audit write fails", async () => {
      const repo = new ArcadeDbAuthRepository(db);
      const { user: owner, organization } = await repo.createOrganizationAndOwner({
        email: `${randomUUID()}@example.ee`, passwordHash: "test-only",
        organizationName: "Removal rollback", countryCode: "EE", sector: "Electronics",
      });
      const member = await repo.createOrgMember({ orgId: organization.orgId,
        email: `${randomUUID()}@example.ee`, passwordHash: "test-only", role: "MEMBER" });
      const session = await repo.createSession({ userId: member.userId, orgId: organization.orgId,
        tokenHash: randomUUID(), expiresAt: "2099-01-01T00:00:00.000Z" });
      // A duplicate audit key forces an actual database failure after the deletes.
      const audit = await repo.recordAuditEvent({ orgId: organization.orgId, actorUserId: owner.userId,
        actorEmail: owner.email, action: "MEMBER_ADDED", summary: "Rollback fixture" });
      const failingRepo = new ArcadeDbAuthRepository({
        healthCheck: () => db.healthCheck(), ensureDatabase: () => db.ensureDatabase(),
        query: db.query.bind(db),
        command: (language, statement, params) => db.command(language, statement, { ...params, eventId: audit.eventId }),
      });
      await expect(failingRepo.deleteOrgMember(organization.orgId, member.userId, owner)).rejects.toThrow();
      expect(await repo.findUserById(member.userId)).toEqual(member);
      expect(await repo.findSessionByTokenHash(session.tokenHash)).not.toBeNull();
      expect(await repo.listAuditEvents(organization.orgId)).toEqual([audit]);
    });
  });

  it("preserves an owner and atomic session/audit effects across concurrent API instances", async () => {
    const otherDb = new HttpArcadeDbClient({
      url: config.ARCADEDB_URL, database: config.ARCADEDB_DATABASE,
      user: config.ARCADEDB_USER, password: config.ARCADEDB_PASSWORD,
    });
    await verifyConcurrentOwnerRemoval(app, createApp({ config, db: otherDb }));
  });

  // Separate repository instances ensure this exercises database concurrency,
  // rather than accidentally passing because of a per-instance JavaScript lock.
  invitationConcurrencyCases((race = false) => {
    let pendingReads = 0;
    let release!: () => void;
    const bothReadPending = new Promise<void>(resolve => { release = resolve; });
    const raceDb: ArcadeDbClient = {
      healthCheck: () => db.healthCheck(), ensureDatabase: () => db.ensureDatabase(),
      query: (language, statement, params) => db.query(language, statement, params),
      command: (language, statement, params) => db.command(language, statement, params),
      transaction: work => db.transaction(scoped => work({ ...scoped,
        query: async <T = Record<string, unknown>>(language: QueryLanguage, statement: string, params?: Record<string, unknown>) => {
          const result = await scoped.query<T>(language, statement, params);
          // Force both transactions to observe PENDING before either writes.
          // Retries pass straight through after the first pair has arrived.
          if (race && statement.includes("FROM Invitation") && pendingReads < 2) {
            if (++pendingReads === 2) release();
            await bothReadPending;
          }
          return result;
        },
      })),
    };
    const auth = new ArcadeDbAuthRepository(db);
    const workspace = new ArcadeDbWorkspaceRepository(db);
    const deps = { authRepo: auth, workspaceRepo: workspace };
    return { auth, workspace,
      invites: new ArcadeDbInvitationRepository(raceDb, deps),
      competingInvites: new ArcadeDbInvitationRepository(raceDb, deps) };
  });

  it("rolls back invitation, edge, and facility refinement when a later directory update fails", async () => {
    const auth = new ArcadeDbAuthRepository(db);
    const workspace = new ArcadeDbWorkspaceRepository(db);
    const deps = { authRepo: auth, workspaceRepo: workspace };
    const invites = new ArcadeDbInvitationRepository(db, deps);
    const f = await createInvitationFixture({ auth, workspace, invites });
    const invite = await f.create();
    const failingDb: ArcadeDbClient = {
      healthCheck: () => db.healthCheck(), ensureDatabase: () => db.ensureDatabase(),
      query: (language, statement, params) => db.query(language, statement, params),
      command: (language, statement, params) => db.command(language, statement, params),
      transaction: work => db.transaction(scoped => work({ ...scoped,
        command: async (language, statement, params) => {
          if (statement.startsWith("UPDATE Organization SET")) throw new Error("injected directory failure");
          return scoped.command(language, statement, params);
        },
      })),
    };
    const failingInvites = new ArcadeDbInvitationRepository(failingDb, deps);
    await expect(failingInvites.acceptInvite(invite.inviteToken, f.supplier1, {
      openToNewBuyers: true,
      refinedSite: { kind: "FACTORY", lat: 60, lng: 25, countryCode: "FI" },
    })).rejects.toThrow("injected directory failure");
    expect((await invites.listInvitesByOrg(f.buyer))[0]!.status).toBe("PENDING");
    expect(await invites.listVerifiedPartnerLinksForOrg(f.buyer)).toHaveLength(0);
    const facility = await workspace.getFacilityById(f.buyer, f.facility.facilityId);
    expect(facility!.isPartnerVerified).toBe(false);
    expect(facility!.lat).toBe(59);
    expect((await auth.findOrganizationById(f.supplier1))!.openToNewBuyers).toBe(false);
    // Failed transactions must not leave a reservation or unique-index entry.
    await invites.acceptInvite(invite.inviteToken, f.supplier1, {});
    expect(await invites.listVerifiedPartnerLinksForOrg(f.buyer)).toHaveLength(1);
  });

  it("enforces one partner edge per buyer facility even for a direct database write", async () => {
    const auth = new ArcadeDbAuthRepository(db);
    const workspace = new ArcadeDbWorkspaceRepository(db);
    const invites = new ArcadeDbInvitationRepository(db, { authRepo: auth, workspaceRepo: workspace });
    const f = await createInvitationFixture({ auth, workspace, invites });
    const invite = await f.create();
    await invites.acceptInvite(invite.inviteToken, f.supplier1, {});
    await expect(db.command("sql", `CREATE EDGE VERIFIED_PARTNER_LINK
      FROM (SELECT FROM Facility WHERE facilityId = :facilityId AND ownerOrgId = :buyer)
      TO (SELECT FROM Organization WHERE orgId = :supplier)
      SET inviteId = :inviteId, linkedAt = :linkedAt`, {
      facilityId: f.facility.facilityId, buyer: f.buyer, supplier: f.supplier2,
      inviteId: randomUUID(), linkedAt: new Date().toISOString(),
    })).rejects.toThrow(/DuplicatedKeyException|duplicat/i);
    expect(await invites.listVerifiedPartnerLinksForOrg(f.buyer)).toHaveLength(1);
  });

  it("verifies live /api/v1/health, auth register/login/session, and org ESG profile update against ArcadeDB", async () => {
    const healthRes = await app.request("/api/v1/health");
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as {
      status: string;
      database: { connected: boolean };
    };
    expect(health.status).toBe("ok");
    expect(health.database.connected).toBe(true);

    const email = `auth-${runId}@kulgo-ci.ee`;
    const password = "LiveArcadeDbPassword2026!";

    const regRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        organizationName: `Tallinn Live Auth ${runId}`,
        countryCode: "EE",
        sector: "Electronics",
      }),
    });
    expect(regRes.status).toBe(201);
    const regCookie = extractCookie(regRes);
    const regBody = AuthMeResponseSchema.parse(await regRes.json());
    expect(regBody.organization.scope1Tco2e).toBeNull();

    // Update Org ESG & Directory Profile
    const patchRes = await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: regCookie,
      },
      body: JSON.stringify({
        scope1Tco2e: 245.5,
        scope2Tco2e: 112.25,
        esgBadges: ["ISO 14001", "RE100"],
        openToNewBuyers: true,
        capabilities: ["Precision Assembly", "Low-Carbon PCB"],
      }),
    });
    expect(patchRes.status).toBe(200);
    const patched = UpdateOrganizationProfileResponseSchema.parse(
      await patchRes.json(),
    );
    expect(patched.organization.scope1Tco2e).toBe(245.5);
    expect(patched.organization.scope2Tco2e).toBe(112.25);
    expect(patched.organization.esgBadges).toEqual(["ISO 14001", "RE100"]);
    expect(patched.organization.openToNewBuyers).toBe(true);
    expect(patched.organization.capabilities).toEqual([
      "Precision Assembly",
      "Low-Carbon PCB",
    ]);

    // Logout, login again, and verify persistence from ArcadeDB
    const logoutRes = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { Cookie: regCookie },
    });
    expect(logoutRes.status).toBe(200);

    const meAfterLogout = await app.request("/api/v1/auth/me", {
      headers: { Cookie: regCookie },
    });
    expect(meAfterLogout.status).toBe(401);

    const loginRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(loginRes.status).toBe(200);
    const loginCookie = extractCookie(loginRes);

    const meRes = await app.request("/api/v1/auth/me", {
      headers: { Cookie: loginCookie },
    });
    expect(meRes.status).toBe(200);
    const me = AuthMeResponseSchema.parse(await meRes.json());
    expect(me.organization.scope1Tco2e).toBe(245.5);
    expect(me.organization.scope2Tco2e).toBe(112.25);
    expect(me.organization.esgBadges).toEqual(["ISO 14001", "RE100"]);
    expect(me.organization.openToNewBuyers).toBe(true);
  });

  it("verifies Workspace CRUD, geospatial WKT Facility persistence, bulk import/export, and CSRD report on ArcadeDB", async () => {
    const regRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `ws-${runId}@kulgo-ci.ee`,
        password: "LiveArcadeDbPassword2026!",
        organizationName: `Baltic Workspace ${runId}`,
        countryCode: "EE",
        sector: "Manufacturing",
      }),
    });
    expect(regRes.status).toBe(201);
    const cookie = extractCookie(regRes);
    const { organization } = AuthMeResponseSchema.parse(await regRes.json());

    // Create facility and verify geospatial WKT POINT(lng lat) persistence in ArcadeDB
    const facRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Tallinn Geospatial Hub",
        kind: "HQ",
        locationPrecision: "SITE_VERIFIED",
        countryCode: "EE",
        lat: 59.437,
        lng: 24.7536,
        isOwnFacility: true,
        estimatedScope12Tco2e: 95,
      }),
    });
    expect(facRes.status).toBe(201);
    const { facility } = (await facRes.json()) as {
      facility: { facilityId: string };
    };

    const wkt = await workspaceRepo.getFacilityWkt(
      organization.orgId,
      facility.facilityId,
    );
    expect(wkt).toBe("POINT (24.7536 59.437)");

    // Bulk CSV import adding a supplier facility and lane referencing the existing HQ
    const csvPayload = [
      "recordType,refKey,name,kind,countryCode,lat,lng,isOwnFacility,fromFacility,toFacility,materialCategory,transportMode,volumeSharePct,annualVolume,volumeUnit,riskStatus",
      "FACILITY,fin-sup,Helsinki Alloy Foundry,FACTORY,FI,60.1699,24.9384,false,,,,,,,,",
      "LANE,,,,,,,,fin-sup,Tallinn Geospatial Hub,Aluminum,SEA,100,300,TONNES,GREEN",
    ].join("\n");

    const importRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv", Cookie: cookie },
      body: csvPayload,
    });
    expect(importRes.status).toBe(200);
    const importSummary = BulkImportSummarySchema.parse(await importRes.json());
    expect(importSummary.createdFacilities).toBe(1);
    expect(importSummary.createdLanes).toBe(1);
    expect(importSummary.errors).toHaveLength(0);

    // Export JSON and verify persisted entities
    const exportJsonRes = await app.request(
      "/api/v1/workspace/export?format=json",
      { headers: { Cookie: cookie } },
    );
    expect(exportJsonRes.status).toBe(200);
    const exported = WorkspaceExportJsonSchema.parse(
      await exportJsonRes.json(),
    );
    expect(exported.facilities).toHaveLength(2);
    expect(exported.lanes).toHaveLength(1);

    // CSRD Executive Report
    const reportRes = await app.request("/api/v1/analytics/report", {
      headers: { Cookie: cookie },
    });
    expect(reportRes.status).toBe(200);
    const report = ExecutiveReportSchema.parse(await reportRes.json());
    expect(report.organization.orgId).toBe(organization.orgId);
    expect(report.verifiedPartnerCoverage.totalTier1Suppliers).toBe(1);
    expect(report.verifiedPartnerCoverage.verifiedTier1Suppliers).toBe(0);
  });

  it("verifies VERIFIED_PARTNER_LINK & Org A -> Org B -> Org C hidden Tier-2 anonymized analytics & privacy boundary on real ArcadeDB", async () => {
    const register = async (
      prefix: string,
      orgName: string,
      countryCode: string,
    ) => {
      const res = await app.request("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `${prefix}-${runId}@kulgo-ci.test`,
          password: "LiveArcadeDbPassword2026!",
          organizationName: `${orgName} ${runId}`,
          countryCode,
          sector: "Manufacturing",
        }),
      });
      expect(res.status).toBe(201);
      const body = AuthMeResponseSchema.parse(await res.json());
      return { cookie: extractCookie(res), orgId: body.organization.orgId };
    };

    const orgA = await register("orga", "Estonia Live Buyer AS", "EE");
    const orgB = await register("orgb", "Nordic Live Tier1 Oy", "FI");
    const orgC = await register("orgc", "Secret Sanctioned Alloys LLC", "RU");

    const createFac = async (
      cookie: string,
      payload: Record<string, unknown>,
    ): Promise<string> => {
      const res = await app.request("/api/v1/workspace/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(201);
      const { facility } = (await res.json()) as {
        facility: { facilityId: string };
      };
      return facility.facilityId;
    };

    // Org A creates HQ + Tier-1 placeholder for Org B + active lane
    const aHqId = await createFac(orgA.cookie, {
      name: "Tallinn Live HQ",
      kind: "HQ",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "EE",
      lat: 59.437,
      lng: 24.7536,
      isOwnFacility: true,
      estimatedScope12Tco2e: 110,
    });
    const aTier1Id = await createFac(orgA.cookie, {
      name: "Nordic Live Tier1",
      kind: "HQ",
      locationPrecision: "HQ_ESTIMATED",
      countryCode: "FI",
      lat: 60.1699,
      lng: 24.9384,
      isOwnFacility: false,
      estimatedScope12Tco2e: 140,
    });

    const aLaneRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        fromFacilityId: aTier1Id,
        toFacilityId: aHqId,
        materialCategory: "Specialty Alloys",
        transportMode: "SEA",
        volumeSharePct: 100,
        annualVolume: 500,
        volumeUnit: "TONNES",
        riskStatus: "GREEN",
      }),
    });
    expect(aLaneRes.status).toBe(201);

    // Org B maps its own private upstream network with sanctioned Tier-2 Org C (RU)
    const bOwnId = await createFac(orgB.cookie, {
      name: "Tampere Private Smelter",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "FI",
      lat: 61.4978,
      lng: 23.761,
      isOwnFacility: true,
      estimatedScope12Tco2e: 210,
    });
    const bSecretTier2Id = await createFac(orgB.cookie, {
      name: "Secret Sanctioned Alloys LLC",
      kind: "EXTRACTION",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "RU",
      lat: 55.7558,
      lng: 37.6173,
      isOwnFacility: false,
      estimatedScope12Tco2e: 720,
    });

    const bLaneRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
      body: JSON.stringify({
        fromFacilityId: bSecretTier2Id,
        toFacilityId: bOwnId,
        materialCategory: "Raw Nickel Ore",
        transportMode: "RAIL",
        volumeSharePct: 100,
        annualVolume: 400,
        volumeUnit: "TONNES",
        riskStatus: "RED",
        riskReason: "Sanctioned upstream mine",
      }),
    });
    expect(bLaneRes.status).toBe(201);

    // Org A invites Org B; Org B accepts -> creates VERIFIED_PARTNER_LINK edge in ArcadeDB
    const invRes = await app.request("/api/v1/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        targetFacilityId: aTier1Id,
        inviteeEmail: `orgb-${runId}@kulgo-ci.test`,
      }),
    });
    expect(invRes.status).toBe(201);
    const createdInvite = CreateInviteResponseSchema.parse(await invRes.json());

    const acceptRes = await app.request(
      `/api/v1/invites/${createdInvite.inviteToken}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: orgB.cookie },
        body: JSON.stringify({
          openToNewBuyers: true,
          capabilities: ["Specialty Alloys"],
          refinedSite: {
            kind: "FACTORY",
            lat: 61.4978,
            lng: 23.761,
            countryCode: "FI",
          },
        }),
      },
    );
    expect(acceptRes.status).toBe(200);
    const accepted = AcceptInviteResponseSchema.parse(await acceptRes.json());
    expect(accepted.invitation.status).toBe("ACCEPTED");

    // Org A reads network, analytics summary, CSRD report, and exports on real ArcadeDB
    const [netRes, summaryRes, reportRes, exportJsonRes, exportCsvRes] =
      await Promise.all([
        app.request("/api/v1/workspace/network", {
          headers: { Cookie: orgA.cookie },
        }),
        app.request("/api/v1/analytics/summary", {
          headers: { Cookie: orgA.cookie },
        }),
        app.request("/api/v1/analytics/report", {
          headers: { Cookie: orgA.cookie },
        }),
        app.request("/api/v1/workspace/export?format=json", {
          headers: { Cookie: orgA.cookie },
        }),
        app.request("/api/v1/workspace/export?format=csv", {
          headers: { Cookie: orgA.cookie },
        }),
      ]);

    expect(netRes.status).toBe(200);
    expect(summaryRes.status).toBe(200);
    expect(reportRes.status).toBe(200);
    expect(exportJsonRes.status).toBe(200);
    expect(exportCsvRes.status).toBe(200);

    const network = WorkspaceNetworkResponseSchema.parse(await netRes.json());
    const summary = AnalyticsSummarySchema.parse(await summaryRes.json());
    const report = ExecutiveReportSchema.parse(await reportRes.json());
    const exportJson = WorkspaceExportJsonSchema.parse(
      await exportJsonRes.json(),
    );
    const exportCsv = await exportCsvRes.text();

    // Verify partner link & anonymized Tier-2 detection worked on real ArcadeDB
    const verifiedTier1 = network.facilities.find(
      (f) => f.facilityId === aTier1Id,
    );
    expect(verifiedTier1?.isPartnerVerified).toBe(true);
    expect(verifiedTier1?.locationPrecision).toBe("SITE_VERIFIED");

    const sanctionAlert = summary.alerts.find(
      (a) => a.category === "SECONDARY_SANCTION",
    );
    expect(sanctionAlert).toBeDefined();
    expect(sanctionAlert?.confidence).toBe("NETWORK_VERIFIED");
    expect(sanctionAlert?.affectedTier1FacilityIds).toEqual([aTier1Id]);
    expect(summary.verifiedCoveragePct).toBe(100);
    expect(report.verifiedPartnerCoverage.verifiedTier1Suppliers).toBe(1);
    expect(report.csrdDisclosures.scope3Methodology).toBe("PRIMARY_VERIFIED");

    // Verify ZERO Tier-2+ secrets appear in any Org A response
    const combinedPayloads = JSON.stringify({
      network,
      summary,
      report,
      exportJson,
      exportCsv,
    });
    const forbidden = [
      orgC.orgId,
      bSecretTier2Id,
      bOwnId,
      "Secret Sanctioned Alloys",
      "Tampere Private Smelter",
      "55.7558",
      "37.6173",
      "Raw Nickel Ore",
    ];
    for (const secret of forbidden) {
      expect(combinedPayloads).not.toContain(secret);
    }
  });

  it("verifies Org Team Members CRUD, RBAC enforcement, and session revocation on live ArcadeDB", async () => {
    const regRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `team-owner-${runId}@kulgo-ci.ee`,
        password: "LiveArcadeDbPassword2026!",
        organizationName: `Team Live Org ${runId}`,
        countryCode: "EE",
        sector: "Electronics",
      }),
    });
    expect(regRes.status).toBe(201);
    const ownerCookie = extractCookie(regRes);
    const { user: owner } = AuthMeResponseSchema.parse(await regRes.json());

    // Cannot remove the last OWNER
    const lastOwnerRes = await app.request(
      `/api/v1/auth/members/${owner.userId}`,
      {
        method: "DELETE",
        headers: { Cookie: ownerCookie },
      },
    );
    expect(lastOwnerRes.status).toBe(400);

    // OWNER adds a MEMBER
    const memberEmail = `team-member-${runId}@kulgo-ci.ee`;
    const addRes = await app.request("/api/v1/auth/members", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        email: memberEmail,
        password: "LiveMemberPassword2026!",
        role: "MEMBER",
      }),
    });
    expect(addRes.status).toBe(201);
    const { member } = (await addRes.json()) as {
      member: { userId: string; role: string };
    };
    expect(member.role).toBe("MEMBER");

    // MEMBER logs in -> forbidden from PATCH /auth/organization (403)
    const loginRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: memberEmail,
        password: "LiveMemberPassword2026!",
      }),
    });
    expect(loginRes.status).toBe(200);
    const memberCookie = extractCookie(loginRes);

    const forbiddenOrgPatch = await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: memberCookie },
      body: JSON.stringify({ scope1Tco2e: 123 }),
    });
    expect(forbiddenOrgPatch.status).toBe(403);

    // MEMBER is forbidden from reading Audit Log (403)
    const forbiddenAuditRes = await app.request("/api/v1/auth/audit-log", {
      headers: { Cookie: memberCookie },
    });
    expect(forbiddenAuditRes.status).toBe(403);

    // OWNER deletes MEMBER -> MEMBER session immediately revoked (401)
    const delRes = await app.request(`/api/v1/auth/members/${member.userId}`, {
      method: "DELETE",
      headers: { Cookie: ownerCookie },
    });
    expect(delRes.status).toBe(200);

    const meAfterDelete = await app.request("/api/v1/auth/me", {
      headers: { Cookie: memberCookie },
    });
    expect(meAfterDelete.status).toBe(401);

    // OWNER queries persisted AuditEvent vertices from ArcadeDB (newest-first, ?limit=)
    const auditRes = await app.request("/api/v1/auth/audit-log?limit=10", {
      headers: { Cookie: ownerCookie },
    });
    expect(auditRes.status).toBe(200);
    const auditBody = (await auditRes.json()) as {
      events: Array<{ orgId: string; action: string; actorEmail: string }>;
    };
    expect(auditBody.events.length).toBeGreaterThanOrEqual(2);
    expect(auditBody.events[0]!.action).toBe("MEMBER_REMOVED");
    expect(auditBody.events.some((e) => e.action === "MEMBER_ADDED")).toBe(true);
    expect(auditBody.events.every((e) => e.orgId === owner.orgId)).toBe(true);
    expect(JSON.stringify(auditBody)).not.toContain("LiveMemberPassword2026!");
  });

  it("verifies live ArcadeDB persistence for /api/v1/alerts preferences, acks, and RiskSignal feed", async () => {
    const email = `alerts-live-${runId}@kulgo-ci.ee`;
    const regRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "LiveAlertsPassword2026!",
        organizationName: `Alerts Live Org ${runId}`,
        countryCode: "EE",
        sector: "Electronics",
      }),
    });
    expect(regRes.status).toBe(201);
    const cookie = extractCookie(regRes);

    const prefRes = await app.request("/api/v1/alerts/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        instantRedEmailEnabled: true,
        dailyAmberDigestEnabled: true,
        emailRecipients: ["ops@kulgo-ci.ee"],
      }),
    });
    expect(prefRes.status).toBe(200);

    const ackRes = await app.request(
      "/api/v1/alerts/sig-latvia-sanctions-01/ack",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ status: "ACKNOWLEDGED", note: "Live DB test" }),
      },
    );
    expect(ackRes.status).toBe(200);

    const feedRes = await app.request("/api/v1/alerts/feed", {
      headers: { Cookie: cookie },
    });
    expect(feedRes.status).toBe(200);
    const feed = (await feedRes.json()) as {
      acknowledgements: Array<{ signalId: string; status: string }>;
    };
    expect(
      feed.acknowledgements.some(
        (a) =>
          a.signalId === "sig-latvia-sanctions-01" &&
          a.status === "ACKNOWLEDGED",
      ),
    ).toBe(true);
  });

  it("persists Contract & ContractLine vertices and returns financialRisk on /api/v1/analytics/summary against live ArcadeDB", async () => {
    const email = `fin-contracts-${runId}@kulgo-ci.ee`;
    const regRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "LiveArcadeDbPassword2026!",
        organizationName: `FinContracts Org ${runId}`,
        countryCode: "EE",
        sector: "Electronics",
      }),
    });
    expect(regRes.status).toBe(201);
    const cookie = extractCookie(regRes);

    const seedRes = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(seedRes.status).toBe(201);
    const seeded = WorkspaceNetworkResponseSchema.parse(await seedRes.json());
    const firstLane = seeded.lanes[0]!;

    const contractRes = await app.request("/api/v1/workspace/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        supplierFacilityId: firstLane.fromFacilityId,
        title: "Live ArcadeDB Framework",
        contractType: "FRAMEWORK",
        startDate: "2026-01-01",
        endDate: "2027-06-30",
        lines: [
          {
            laneId: firstLane.laneId,
            cadence: "PER_YEAR",
            committedVolume: 500,
            unit: "TONNES",
            committedSpend: 250_000,
            currency: "EUR",
          },
        ],
      }),
    });
    expect(contractRes.status).toBe(201);

    const summaryRes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: cookie },
    });
    expect(summaryRes.status).toBe(200);
    const summary = AnalyticsSummarySchema.parse(await summaryRes.json());
    expect(summary.financialRisk).toBeDefined();
    expect(summary.financialRisk?.totalActiveSpendEur).toBeGreaterThan(0);
  });
});



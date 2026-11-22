import {
  AnalyticsSummarySchema,
  AuthMeResponseSchema,
  BulkImportSummarySchema,
  DirectoryAlternativesResponseSchema,
  ExecutiveReportSchema,
  UpdateOrganizationProfileResponseSchema,
  WorkspaceExportJsonSchema,
  WorkspaceNetworkResponseSchema,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../../src/app.js";

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = /kulgo_session=([^;]+)/.exec(header);
  if (!match?.[1]) {
    throw new Error("Expected kulgo_session cookie");
  }
  return `kulgo_session=${match[1]}`;
}

async function registerOrg(
  app: ReturnType<typeof createTestApp>,
  params: {
    email: string;
    organizationName: string;
    countryCode?: string;
    sector?: string;
  },
): Promise<{ cookie: string; orgId: string }> {
  const res = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: params.email,
      password: "M4MilestonePassword2026!",
      organizationName: params.organizationName,
      countryCode: params.countryCode ?? "EE",
      sector: params.sector ?? "Manufacturing",
    }),
  });
  expect(res.status).toBe(201);
  const body = AuthMeResponseSchema.parse(await res.json());
  return { cookie: extractCookie(res), orgId: body.organization.orgId };
}

describe("Milestone 4 E2E — Org ESG Settings, Bulk CSV/JSON Import/Export & CSRD Report", () => {
  it("updates org ESG & directory profile via PATCH /api/v1/auth/organization and reflects in analytics & directory", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, {
      email: "esg-a@estonia-mfg.ee",
      organizationName: "Estonia Green Mfg AS",
      countryCode: "EE",
      sector: "Electronics",
    });
    const orgB = await registerOrg(app, {
      email: "buyer-b@nordic-buyer.fi",
      organizationName: "Nordic Buyer Oy",
      countryCode: "FI",
    });

    // Rejects unknown fields via strict Zod schema
    const badPatch = await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        orgId: orgB.orgId,
        scope1Tco2e: 100,
      }),
    });
    expect(badPatch.status).toBe(400);

    // Valid partial update of Scope 1/2, ESG badges, directory opt-in, capabilities
    const patchRes = await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        scope1Tco2e: 310.5,
        scope2Tco2e: 145.25,
        esgBadges: ["ISO 14001", "EcoVadis Gold", "ISO 14001"],
        openToNewBuyers: true,
        capabilities: ["Cleanroom Electronics", "Nordic PCBA"],
      }),
    });
    expect(patchRes.status).toBe(200);
    const patched = UpdateOrganizationProfileResponseSchema.parse(
      await patchRes.json(),
    );
    expect(patched.organization.scope1Tco2e).toBe(310.5);
    expect(patched.organization.scope2Tco2e).toBe(145.25);
    expect(patched.organization.esgBadges).toEqual([
      "ISO 14001",
      "EcoVadis Gold",
    ]);
    expect(patched.organization.openToNewBuyers).toBe(true);
    expect(patched.organization.capabilities).toEqual([
      "Cleanroom Electronics",
      "Nordic PCBA",
    ]);

    // Analytics summary reflects updated Scope 1 & Scope 2 totals
    const summaryRes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: orgA.cookie },
    });
    expect(summaryRes.status).toBe(200);
    const summary = AnalyticsSummarySchema.parse(await summaryRes.json());
    expect(summary.esg.scope1Tco2e).toBe(310.5);
    expect(summary.esg.scope2Tco2e).toBe(145.25);

    // Org B discovers Org A in the Alternative Supplier Directory with its ESG badges
    const dirRes = await app.request(
      "/api/v1/directory/alternatives?countryCode=EE&capability=PCBA",
      { headers: { Cookie: orgB.cookie } },
    );
    expect(dirRes.status).toBe(200);
    const dir = DirectoryAlternativesResponseSchema.parse(await dirRes.json());
    const found = dir.candidates.find((c) => c.orgId === orgA.orgId);
    expect(found).toBeDefined();
    expect(found?.esgBadges).toEqual(["ISO 14001", "EcoVadis Gold"]);
  });

  it("supports bulk JSON & CSV import with row-level error reporting and round-trip CSV/JSON export", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, {
      email: "bulk@tallinn-ops.ee",
      organizationName: "Tallinn Bulk Ops AS",
    });

    // 1. JSON bulk import with one invalid row + two valid facilities + one valid lane + one broken lane
    const jsonImportRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        facilities: [
          {
            refKey: "hq-1",
            name: "Tallinn Assembly HQ",
            kind: "HQ",
            countryCode: "EE",
            lat: 59.437,
            lng: 24.7536,
            isOwnFacility: true,
          },
          {
            refKey: "sup-1",
            name: "Stockholm Precision Steel",
            kind: "FACTORY",
            countryCode: "SE",
            lat: 59.3293,
            lng: 18.0686,
            isOwnFacility: false,
          },
          {
            // Invalid countryCode -> recorded in errors without blocking valid rows
            name: "Broken Facility",
            countryCode: "INVALID",
            lat: 50,
            lng: 10,
          },
        ],
        lanes: [
          {
            fromFacilityRef: "sup-1",
            toFacilityRef: "hq-1",
            materialCategory: "Stainless Steel",
            transportMode: "SEA",
            volumeSharePct: 100,
            annualVolume: 250,
            volumeUnit: "TONNES",
            annualSpendEur: 420000,
          },
          {
            fromFacilityRef: "does-not-exist",
            toFacilityRef: "hq-1",
            materialCategory: "Ghost Material",
          },
        ],
      }),
    });
    expect(jsonImportRes.status).toBe(200);
    const jsonSummary = BulkImportSummarySchema.parse(
      await jsonImportRes.json(),
    );
    expect(jsonSummary.createdFacilities).toBe(2);
    expect(jsonSummary.createdLanes).toBe(1);
    expect(jsonSummary.errors).toHaveLength(2);

    // 2. Export CSV & JSON
    const exportJsonRes = await app.request(
      "/api/v1/workspace/export?format=json",
      { headers: { Cookie: orgA.cookie } },
    );
    expect(exportJsonRes.status).toBe(200);
    expect(exportJsonRes.headers.get("content-disposition")).toContain(".json");
    const exportedJson = WorkspaceExportJsonSchema.parse(
      await exportJsonRes.json(),
    );
    expect(exportedJson.facilities).toHaveLength(2);
    expect(exportedJson.lanes).toHaveLength(1);

    const exportCsvRes = await app.request(
      "/api/v1/workspace/export?format=csv",
      { headers: { Cookie: orgA.cookie } },
    );
    expect(exportCsvRes.status).toBe(200);
    expect(exportCsvRes.headers.get("content-type")).toContain("text/csv");
    const exportedCsv = await exportCsvRes.text();
    expect(exportedCsv).toContain("Tallinn Assembly HQ");
    expect(exportedCsv).toContain("Stainless Steel");

    // Invalid export format rejected with 400
    const badExportRes = await app.request(
      "/api/v1/workspace/export?format=xml",
      { headers: { Cookie: orgA.cookie } },
    );
    expect(badExportRes.status).toBe(400);

    // 3. Round-trip import exported CSV into a fresh Org B
    const orgB = await registerOrg(app, {
      email: "roundtrip@baltic-clone.ee",
      organizationName: "Baltic Clone OU",
    });
    const csvImportRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv", Cookie: orgB.cookie },
      body: exportedCsv,
    });
    expect(csvImportRes.status).toBe(200);
    const csvSummary = BulkImportSummarySchema.parse(await csvImportRes.json());
    expect(csvSummary.createdFacilities).toBe(2);
    expect(csvSummary.createdLanes).toBe(1);
    expect(csvSummary.errors).toHaveLength(0);

    const orgBNetRes = await app.request("/api/v1/workspace/network", {
      headers: { Cookie: orgB.cookie },
    });
    const orgBNet = WorkspaceNetworkResponseSchema.parse(
      await orgBNetRes.json(),
    );
    expect(orgBNet.facilities).toHaveLength(2);
    expect(orgBNet.lanes).toHaveLength(1);
  });

  it("restores JSON network references and imported lane financial fields", async () => {
    const app = createTestApp();
    const source = await registerOrg(app, { email: "restore-source@example.com", organizationName: "Restore source" });
    const target = await registerOrg(app, { email: "restore-target@example.com", organizationName: "Restore target" });
    await app.request("/api/v1/workspace/seed-demo", { method: "POST", headers: { Cookie: source.cookie } });
    const exported = WorkspaceExportJsonSchema.parse(await (await app.request("/api/v1/workspace/export?format=json", { headers: { Cookie: source.cookie } })).json());
    const imported = await app.request("/api/v1/workspace/import", { method: "POST", headers: { "Content-Type": "application/json", Cookie: target.cookie }, body: JSON.stringify(exported) });
    expect(imported.status).toBe(200);
    const summary = BulkImportSummarySchema.parse(await imported.json());
    expect(summary.errors).toEqual([]);
    const restored = WorkspaceNetworkResponseSchema.parse(await (await app.request("/api/v1/workspace/network", { headers: { Cookie: target.cookie } })).json());
    expect(restored.products).toHaveLength(exported.products.length);
    expect(restored.inputs).toHaveLength(exported.inputs.length);
    expect(restored.lanes).toHaveLength(exported.lanes.length);
    for (const lane of restored.lanes) {
      expect(restored.facilities.some(f => f.facilityId === lane.fromFacilityId && f.ownerOrgId === target.orgId)).toBe(true);
      expect(restored.facilities.some(f => f.facilityId === lane.toFacilityId && f.ownerOrgId === target.orgId)).toBe(true);
      if (lane.inputId) expect(restored.inputs.some(i => i.inputId === lane.inputId && i.ownerOrgId === target.orgId)).toBe(true);
    }
    for (const input of restored.inputs) {
      if (input.productId) expect(restored.products.some(p => p.productId === input.productId && p.ownerOrgId === target.orgId)).toBe(true);
    }
    expect(restored.inputs.filter(i => i.productId).length).toBe(exported.inputs.filter(i => i.productId).length);
    expect(restored.lanes.filter(l => l.inputId).length).toBe(exported.lanes.filter(l => l.inputId).length);
  });

  it("persists accepted JSON and CSV financial lane fields", async () => {
    const app = createTestApp();
    const org = await registerOrg(app, { email: "financial-import@example.com", organizationName: "Financial import" });
    const facilities = [{ refKey: "a", name: "A", countryCode: "EE", lat: 1, lng: 1 }, { refKey: "b", name: "B", countryCode: "EE", lat: 2, lng: 2 }];
    const lane = { fromFacilityRef: "a", toFacilityRef: "b", materialCategory: "Steel", safetyStockDays: 99, defectRatePct: 12, carryingCostPct: 45, unitLandedCostEur: 4, ordinaryFreightCostPerUnitEur: 2, customAnnualDisruptionProb: 0.2, customTtrDays: 6, productEmissionFactorTco2ePerUnit: 0.5, economicAttributionRatio: 0.4, pcfVerified: true };
    const res = await app.request("/api/v1/workspace/import", { method: "POST", headers: { "Content-Type": "application/json", Cookie: org.cookie }, body: JSON.stringify({ facilities, lanes: [lane] }) });
    expect(BulkImportSummarySchema.parse(await res.json()).errors).toEqual([]);
    const network = WorkspaceNetworkResponseSchema.parse(await (await app.request("/api/v1/workspace/network", { headers: { Cookie: org.cookie } })).json());
    expect(network.lanes[0]).toMatchObject({ safetyStockDays: 99, defectRatePct: 12, carryingCostPct: 45, unitLandedCostEur: 4, ordinaryFreightCostPerUnitEur: 2, customAnnualDisruptionProb: 0.2, customTtrDays: 6, productEmissionFactorTco2ePerUnit: 0.5, economicAttributionRatio: 0.4, pcfVerified: true });
    const csv = await (await app.request("/api/v1/workspace/export?format=csv", { headers: { Cookie: org.cookie } })).text();
    const target = await registerOrg(app, { email: "financial-target@example.com", organizationName: "Financial target" });
    const csvRes = await app.request("/api/v1/workspace/import", { method: "POST", headers: { "Content-Type": "text/csv", Cookie: target.cookie }, body: csv });
    expect(BulkImportSummarySchema.parse(await csvRes.json()).errors).toEqual([]);
    const restored = WorkspaceNetworkResponseSchema.parse(await (await app.request("/api/v1/workspace/network", { headers: { Cookie: target.cookie } })).json());
    expect(restored.lanes[0]).toMatchObject({ safetyStockDays: 99, defectRatePct: 12, carryingCostPct: 45, unitLandedCostEur: 4, ordinaryFreightCostPerUnitEur: 2, customAnnualDisruptionProb: 0.2, customTtrDays: 6, productEmissionFactorTco2ePerUnit: 0.5, economicAttributionRatio: 0.4, pcfVerified: true });
  });

  it("restores empty exports and distinct facilities sharing a name and type", async () => {
    const app = createTestApp();
    const source = await registerOrg(app, { email: "duplicates-source@example.com", organizationName: "Duplicate source" });
    const target = await registerOrg(app, { email: "duplicates-target@example.com", organizationName: "Duplicate target" });
    const exportNetwork = async () => WorkspaceExportJsonSchema.parse(await (await app.request("/api/v1/workspace/export?format=json", { headers: { Cookie: source.cookie } })).json());
    const importNetwork = async (data: unknown) => app.request("/api/v1/workspace/import", { method: "POST", headers: { "Content-Type": "application/json", Cookie: target.cookie }, body: JSON.stringify(data) });
    const empty = await importNetwork(await exportNetwork());
    expect(empty.status).toBe(200);
    expect(BulkImportSummarySchema.parse(await empty.json()).errors).toEqual([]);
    const create = async (lat: number) => (await (await app.request("/api/v1/workspace/facilities", { method: "POST", headers: { "Content-Type": "application/json", Cookie: source.cookie }, body: JSON.stringify({ name: "Same", kind: "FACTORY", countryCode: "EE", lat, lng: 1 }) })).json() as { facility: { facilityId: string } }).facility;
    const first = await create(1);
    const second = await create(2);
    await app.request("/api/v1/workspace/lanes", { method: "POST", headers: { "Content-Type": "application/json", Cookie: source.cookie }, body: JSON.stringify({ fromFacilityId: first.facilityId, toFacilityId: second.facilityId, materialCategory: "Steel" }) });
    await app.request("/api/v1/workspace/facilities", { method: "POST", headers: { "Content-Type": "application/json", Cookie: target.cookie }, body: JSON.stringify({ name: "Same", kind: "FACTORY", countryCode: "EE", lat: 3, lng: 1 }) });
    const response = await importNetwork(await exportNetwork());
    expect(BulkImportSummarySchema.parse(await response.json()).errors).toEqual([]);
    const restored = WorkspaceNetworkResponseSchema.parse(await (await app.request("/api/v1/workspace/network", { headers: { Cookie: target.cookie } })).json());
    expect(restored.facilities).toHaveLength(3);
    expect(restored.facilities.find(f => f.facilityId === restored.lanes[0]?.fromFacilityId)?.lat).toBe(1);
    expect(restored.facilities.find(f => f.facilityId === restored.lanes[0]?.toFacilityId)?.lat).toBe(2);
    const ambiguous = await importNetwork({ facilities: [{ name: "Same", kind: "FACTORY", countryCode: "EE", lat: 4, lng: 1 }], lanes: [{ fromFacilityRef: "Same", toFacilityRef: "Same", materialCategory: "Steel" }] });
    const ambiguousSummary = BulkImportSummarySchema.parse(await ambiguous.json());
    expect(ambiguousSummary.createdFacilities).toBe(0);
    expect(ambiguousSummary.errors).toEqual(expect.arrayContaining([expect.objectContaining({ entity: "FACILITY", message: expect.stringContaining("Multiple facilities") }), expect.objectContaining({ entity: "LANE", message: expect.stringContaining("ambiguous") })]));
    const attack = await importNetwork({ lanes: [{ fromFacilityId: first.facilityId, toFacilityId: second.facilityId, materialCategory: "Steel" }] });
    expect(BulkImportSummarySchema.parse(await attack.json()).createdLanes).toBe(0);
  });

  it("retries a partial JSON restore without duplicating the graph", async () => {
    const app = createTestApp();
    const source = await registerOrg(app, { email: "retry-source@example.com", organizationName: "Retry source" });
    const target = await registerOrg(app, { email: "retry-target@example.com", organizationName: "Retry target" });
    await app.request("/api/v1/workspace/seed-demo", { method: "POST", headers: { Cookie: source.cookie } });
    const exported = WorkspaceExportJsonSchema.parse(await (await app.request("/api/v1/workspace/export?format=json", { headers: { Cookie: source.cookie } })).json());
    const broken = structuredClone(exported);
    broken.lanes[0]!.fromFacilityId = "00000000-0000-4000-8000-000000000000";
    const run = async (data: unknown) => BulkImportSummarySchema.parse(await (await app.request("/api/v1/workspace/import", { method: "POST", headers: { "Content-Type": "application/json", Cookie: target.cookie }, body: JSON.stringify(data) })).json());
    expect((await run(broken)).errors).toHaveLength(1);
    expect((await run(exported)).errors).toEqual([]);
    const restored = WorkspaceNetworkResponseSchema.parse(await (await app.request("/api/v1/workspace/network", { headers: { Cookie: target.cookie } })).json());
    expect(restored.products).toHaveLength(exported.products.length);
    expect(restored.inputs).toHaveLength(exported.inputs.length);
    expect(restored.facilities).toHaveLength(exported.facilities.length);
    expect(restored.lanes).toHaveLength(exported.lanes.length);
    expect(restored.lanes.filter(l => l.inputId)).toHaveLength(exported.lanes.filter(l => l.inputId).length);
    for (const lane of restored.lanes) {
      if (lane.inputId) expect(restored.inputs.some(input => input.inputId === lane.inputId)).toBe(true);
    }
    for (const input of restored.inputs) {
      if (input.productId) expect(restored.products.some(product => product.productId === input.productId)).toBe(true);
    }
  });

  it("generates a strict CSRD Executive Risk & ESG Report via GET /api/v1/analytics/report", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, {
      email: "csrd@estonia-exec.ee",
      organizationName: "Estonia CSRD Exec AS",
    });

    // Seed demo network & set Scope 1/2
    const seedRes = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: orgA.cookie },
    });
    expect(seedRes.status).toBe(201);

    await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        scope1Tco2e: 200,
        scope2Tco2e: 80,
        esgBadges: ["CSRD Ready"],
      }),
    });

    const reportRes = await app.request("/api/v1/analytics/report", {
      headers: { Cookie: orgA.cookie },
    });
    expect(reportRes.status).toBe(200);
    const report = ExecutiveReportSchema.parse(await reportRes.json());

    expect(report.reportVersion).toBe("1.0");
    expect(report.organization.orgId).toBe(orgA.orgId);
    expect(report.organization.scope1Tco2e).toBe(200);
    expect(report.organization.scope2Tco2e).toBe(80);
    expect(report.csrdDisclosures.scope1Status).toBe("REPORTED");
    expect(report.csrdDisclosures.scope2Status).toBe("REPORTED");
    expect(report.csrdDisclosures.totalReportedTco2e).toBeGreaterThan(280);
    expect(report.verifiedPartnerCoverage.totalTier1Suppliers).toBeGreaterThan(
      0,
    );
    expect(report.topRecommendedActions.length).toBeGreaterThan(0);
  });

  it("neutralizes CSV formula injection, enforces MAX_CSV_ROWS, rejects invalid booleans, and round-trips duplicate facility names losslessly", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, {
      email: "csv-sec@tallinn-ops.ee",
      organizationName: "Tallinn CSV Hardening AS",
    });

    // 1. Neutralizes formula-injection cells on CSV export while preserving negative numeric coordinates
    const hqRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        name: "=CMD('calc')",
        kind: "HQ",
        countryCode: "EE",
        lat: 59.437,
        lng: -24.7536,
        isOwnFacility: true,
        sector: "+SUM(A1:A2)",
      }),
    });
    expect(hqRes.status).toBe(201);
    const { facility: facHq } = (await hqRes.json()) as {
      facility: { facilityId: string };
    };

    // Two distinct facilities with the exact same name
    const dup1Res = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        name: "Shared Plant Name",
        kind: "FACTORY",
        countryCode: "FI",
        lat: 60.17,
        lng: 24.94,
      }),
    });
    const { facility: dup1 } = (await dup1Res.json()) as {
      facility: { facilityId: string };
    };
    const dup2Res = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        name: "Shared Plant Name",
        kind: "WAREHOUSE",
        countryCode: "SE",
        lat: 59.33,
        lng: 18.07,
      }),
    });
    const { facility: dup2 } = (await dup2Res.json()) as {
      facility: { facilityId: string };
    };

    await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: orgA.cookie },
      body: JSON.stringify({
        fromFacilityId: dup2.facilityId,
        toFacilityId: facHq.facilityId,
        materialCategory: "Copper",
        transportMode: "SEA",
        volumeSharePct: 100,
      }),
    });
    expect(dup1.facilityId).not.toBe(dup2.facilityId);

    const exportCsvRes = await app.request(
      "/api/v1/workspace/export?format=csv",
      { headers: { Cookie: orgA.cookie } },
    );
    expect(exportCsvRes.status).toBe(200);
    const exportedCsv = await exportCsvRes.text();
    // Dangerous formulas are prefixed with single-quote guard, negative coordinate is preserved unquoted
    expect(exportedCsv).toContain("'=CMD('calc')");
    expect(exportedCsv).toContain("'+SUM(A1:A2)");
    expect(exportedCsv).toContain(",-24.7536,");
    expect(exportedCsv).toContain("fromFacilityId,toFacilityId");

    // Round-trip into Org B preserves exact link to dup2 (SE WAREHOUSE), not dup1 (FI FACTORY)
    const orgB = await registerOrg(app, {
      email: "csv-roundtrip-b@tallinn-ops.ee",
      organizationName: "Roundtrip B AS",
    });
    const roundTripRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv", Cookie: orgB.cookie },
      body: exportedCsv,
    });
    expect(roundTripRes.status).toBe(200);
    const rtSummary = BulkImportSummarySchema.parse(await roundTripRes.json());
    expect(rtSummary.createdFacilities).toBe(3);
    expect(rtSummary.createdLanes).toBe(1);
    expect(rtSummary.errors).toHaveLength(0);

    const orgBNet = WorkspaceNetworkResponseSchema.parse(
      await (
        await app.request("/api/v1/workspace/network", {
          headers: { Cookie: orgB.cookie },
        })
      ).json(),
    );
    const importedLane = orgBNet.lanes[0]!;
    const sourceFac = orgBNet.facilities.find(
      (f) => f.facilityId === importedLane.fromFacilityId,
    );
    expect(sourceFac?.countryCode).toBe("SE");
    expect(sourceFac?.kind).toBe("WAREHOUSE");

    // 2. Re-importing same CSV into Org B deduplicates existing facilities instead of duplicating them
    const reImportRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv", Cookie: orgB.cookie },
      body: exportedCsv,
    });
    expect(reImportRes.status).toBe(200);
    const reSummary = BulkImportSummarySchema.parse(await reImportRes.json());
    expect(reSummary.createdFacilities).toBe(0);

    // 3. Invalid boolean strings in isOwnFacility produce a row-level error instead of coercing to false
    const badBoolCsv = [
      "recordType,name,countryCode,lat,lng,isOwnFacility",
      "FACILITY,Invalid Bool Plant,EE,59.437,24.7536,maybe",
    ].join("\n");
    const badBoolRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv", Cookie: orgB.cookie },
      body: badBoolCsv,
    });
    expect(badBoolRes.status).toBe(200);
    const badBoolSummary = BulkImportSummarySchema.parse(
      await badBoolRes.json(),
    );
    expect(badBoolSummary.createdFacilities).toBe(0);
    expect(badBoolSummary.errors).toHaveLength(1);
    expect(badBoolSummary.errors[0]?.field).toBe("isOwnFacility");

    // 4. Exceeding MAX_CSV_ROWS (1505) returns 400 validation error
    const tooManyRowsCsv = [
      "recordType,name,countryCode,lat,lng",
      ...Array.from(
        { length: 1506 },
        (_, i) => `FACILITY,Plant ${i},EE,59.437,24.7536`,
      ),
    ].join("\n");
    const tooManyRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv", Cookie: orgB.cookie },
      body: tooManyRowsCsv,
    });
    expect(tooManyRes.status).toBe(400);
  });
});

import { estimateLaneCo2eTonnes, haversineDistanceKm } from "@kulgo/engine";
import { WorkspaceNetworkResponseSchema } from "@kulgo/shared";
import { describe, expect, it, vi } from "vitest";
import { createApp, createTestApp } from "../src/app.js";
import { InMemoryAuthRepository } from "../src/auth/repository.js";
import { loadConfig } from "../src/config.js";
import type { ArcadeDbClient } from "../src/db/client.js";
import {
  ArcadeDbWorkspaceRepository,
  InMemoryWorkspaceRepository,
} from "../src/workspace/repository.js";

function extractCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = /kulgo_session=([^;]+)/.exec(header);
  if (!match?.[1]) {
    throw new Error("Missing kulgo_session cookie");
  }
  return `kulgo_session=${match[1]}`;
}

async function registerAndGetCookie(
  app: ReturnType<typeof createTestApp>,
  email: string,
  organizationName: string,
): Promise<{ cookie: string; orgId: string }> {
  const res = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "WorkspaceTestPassword123!",
      organizationName,
      countryCode: "EE",
      sector: "Electronics",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { organization: { orgId: string } };
  return { cookie: extractCookie(res), orgId: body.organization.orgId };
}

describe("Workspace CRUD API & Demo Seeder (/api/v1/workspace)", () => {
  it("supports full CRUD for Products, SupplyInputs, Facilities (including HQ_ESTIMATED -> SITE_VERIFIED & WKT), and SupplyLanes", async () => {
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const authRepo = new InMemoryAuthRepository();
    const mockDb: ArcadeDbClient = {
      async healthCheck() {
        return { connected: true, latencyMs: 1 };
      },
      async ensureDatabase() {},
      async query() {
        return [];
      },
      async command() {
        return [];
      },
    };
    const app = createApp({
      config: loadConfig({ NODE_ENV: "test" }),
      db: mockDb,
      authRepo,
      workspaceRepo,
    });

    const { cookie, orgId } = await registerAndGetCookie(
      app,
      "crud@kulgo.ee",
      "Tallinn Assemblies",
    );

    // 1. Products CRUD
    const createProductRes = await app.request("/api/v1/workspace/products", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Controller Unit V1",
        sku: "CU-01",
        description: "Industrial controller",
      }),
    });
    expect(createProductRes.status).toBe(201);
    const { product } = (await createProductRes.json()) as {
      product: { productId: string; ownerOrgId: string; name: string };
    };
    expect(product.ownerOrgId).toBe(orgId);

    const updateProductRes = await app.request(
      `/api/v1/workspace/products/${product.productId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: "Controller Unit V2" }),
      },
    );
    expect(updateProductRes.status).toBe(200);
    expect(
      ((await updateProductRes.json()) as { product: { name: string } }).product
        .name,
    ).toBe("Controller Unit V2");

    // 2. SupplyInputs CRUD
    const createInputRes = await app.request("/api/v1/workspace/inputs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        productId: product.productId,
        name: "Material A",
        category: "Aluminum Housing",
        unit: "TONNES",
      }),
    });
    expect(createInputRes.status).toBe(201);
    const { input } = (await createInputRes.json()) as {
      input: { inputId: string; productId: string };
    };
    expect(input.productId).toBe(product.productId);

    // 3. Facilities CRUD + HQ_ESTIMATED -> SITE_VERIFIED + WKT POINT(lng lat)
    const createHqRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Tallinn Assembly",
        kind: "HQ",
        locationPrecision: "SITE_VERIFIED",
        countryCode: "ee",
        lat: 59.437,
        lng: 24.7536,
        isOwnFacility: true,
      }),
    });
    expect(createHqRes.status).toBe(201);
    const { facility: tallinnHq } = (await createHqRes.json()) as {
      facility: { facilityId: string; countryCode: string };
    };
    expect(tallinnHq.countryCode).toBe("EE");
    expect(
      await workspaceRepo.getFacilityWkt(orgId, tallinnHq.facilityId),
    ).toBe("POINT (24.7536 59.437)");

    const createSupplierRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Hamburg Supplier HQ",
        kind: "HQ",
        locationPrecision: "HQ_ESTIMATED",
        countryCode: "DE",
        lat: 53.5511,
        lng: 9.9937,
      }),
    });
    expect(createSupplierRes.status).toBe(201);
    const { facility: supplier } = (await createSupplierRes.json()) as {
      facility: { facilityId: string; locationPrecision: string };
    };
    expect(supplier.locationPrecision).toBe("HQ_ESTIMATED");

    // 4. SupplyLanes CRUD: self-loop rejection & automatic engine distance/CO2e
    const selfLoopRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        fromFacilityId: tallinnHq.facilityId,
        toFacilityId: tallinnHq.facilityId,
        materialCategory: "Aluminum Housing",
        transportMode: "ROAD",
      }),
    });
    expect(selfLoopRes.status).toBe(400);

    const createLaneRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        fromFacilityId: supplier.facilityId,
        toFacilityId: tallinnHq.facilityId,
        inputId: input.inputId,
        materialCategory: "Aluminum Housing",
        transportMode: "ROAD",
        volumeSharePct: 100,
        annualVolume: 100,
        volumeUnit: "TONNES",
        annualSpendEur: 250000,
        contractEndDate: "2027-06-30",
        riskStatus: "GREEN",
      }),
    });
    expect(createLaneRes.status).toBe(201);
    const { lane } = (await createLaneRes.json()) as {
      lane: {
        laneId: string;
        distanceKm: number;
        estimatedLaneCo2e: number;
      };
    };

    const expectedDist = haversineDistanceKm(53.5511, 9.9937, 59.437, 24.7536);
    const expectedCo2 = estimateLaneCo2eTonnes({
      distanceKm: expectedDist,
      annualTonnes: 100,
      transportMode: "ROAD",
    });
    expect(lane.distanceKm).toBe(expectedDist);
    expect(lane.estimatedLaneCo2e).toBe(expectedCo2);

    // Refine supplier from HQ_ESTIMATED -> SITE_VERIFIED with new coordinates (Munich factory)
    const refineRes = await app.request(
      `/api/v1/workspace/facilities/${supplier.facilityId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          kind: "FACTORY",
          locationPrecision: "SITE_VERIFIED",
          lat: 48.1351,
          lng: 11.582,
        }),
      },
    );
    expect(refineRes.status).toBe(200);
    const { facility: refined } = (await refineRes.json()) as {
      facility: { kind: string; locationPrecision: string; lat: number; lng: number };
    };
    expect(refined.kind).toBe("FACTORY");
    expect(refined.locationPrecision).toBe("SITE_VERIFIED");
    expect(
      await workspaceRepo.getFacilityWkt(orgId, supplier.facilityId),
    ).toBe("POINT (11.582 48.1351)");

    // Connected lane distance & CO2e should recalculate automatically
    const lanesAfterRefineRes = await app.request("/api/v1/workspace/lanes", {
      headers: { Cookie: cookie },
    });
    const { lanes: lanesAfterRefine } = (await lanesAfterRefineRes.json()) as {
      lanes: Array<{ laneId: string; distanceKm: number; estimatedLaneCo2e: number }>;
    };
    const updatedDist = haversineDistanceKm(48.1351, 11.582, 59.437, 24.7536);
    expect(lanesAfterRefine[0]?.distanceKm).toBe(updatedDist);
    expect(lanesAfterRefine[0]?.estimatedLaneCo2e).toBe(
      estimateLaneCo2eTonnes({
        distanceKm: updatedDist,
        annualTonnes: 100,
        transportMode: "ROAD",
      }),
    );

    // Deleting a facility cascades deletion of connected lanes
    const deleteSupplierRes = await app.request(
      `/api/v1/workspace/facilities/${supplier.facilityId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookie },
      },
    );
    expect(deleteSupplierRes.status).toBe(200);

    const lanesAfterDeleteRes = await app.request("/api/v1/workspace/lanes", {
      headers: { Cookie: cookie },
    });
    const { lanes: remainingLanes } = (await lanesAfterDeleteRes.json()) as {
      lanes: unknown[];
    };
    expect(remainingLanes).toHaveLength(0);

    // Delete input & product
    const deleteInputRes = await app.request(
      `/api/v1/workspace/inputs/${input.inputId}`,
      { method: "DELETE", headers: { Cookie: cookie } },
    );
    expect(deleteInputRes.status).toBe(200);

    const deleteProductRes = await app.request(
      `/api/v1/workspace/products/${product.productId}`,
      { method: "DELETE", headers: { Cookie: cookie } },
    );
    expect(deleteProductRes.status).toBe(200);
  });

  it("seeds the Estonia Product X demo idempotently and supports network filtering by productId and inputId", async () => {
    const app = createTestApp();
    const { cookie } = await registerAndGetCookie(
      app,
      "demo@tallinn-mfg.ee",
      "Estonia Precision OU",
    );

    const seedRes1 = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(seedRes1.status).toBe(201);
    const network1 = WorkspaceNetworkResponseSchema.parse(await seedRes1.json());

    // Product X
    expect(network1.products).toHaveLength(1);
    expect(network1.products[0]?.name).toBe("Product X");

    // Materials A-F
    const inputNames = network1.inputs.map((i) => i.name).sort();
    expect(inputNames).toEqual([
      "Material A",
      "Material B",
      "Material C",
      "Material D",
      "Material E",
      "Material F",
    ]);

    // Tallinn HQ + EE/LV/FI/DE/CN suppliers with mix of SITE_VERIFIED and HQ_ESTIMATED
    const ownHq = network1.facilities.find((f) => f.isOwnFacility);
    expect(ownHq).toBeDefined();
    expect(ownHq?.countryCode).toBe("EE");
    expect(ownHq?.locationPrecision).toBe("SITE_VERIFIED");

    const countries = new Set(network1.facilities.map((f) => f.countryCode));
    expect(countries).toEqual(new Set(["EE", "LV", "FI", "DE", "CN"]));
    expect(
      network1.facilities.some((f) => f.locationPrecision === "HQ_ESTIMATED"),
    ).toBe(true);
    expect(
      network1.facilities.some((f) => f.locationPrecision === "SITE_VERIFIED"),
    ).toBe(true);

    // Yellow China corridor risk & Red Latvian sanctions risk
    const cnFacility = network1.facilities.find((f) => f.countryCode === "CN");
    const lvFacility = network1.facilities.find((f) => f.countryCode === "LV");
    const cnLane = network1.lanes.find(
      (l) => l.fromFacilityId === cnFacility?.facilityId,
    );
    const lvLane = network1.lanes.find(
      (l) => l.fromFacilityId === lvFacility?.facilityId,
    );
    expect(cnLane?.riskStatus).toBe("YELLOW");
    expect(cnLane?.riskReason).toBeTruthy();
    expect(lvLane?.riskStatus).toBe("RED");
    expect(lvLane?.riskReason?.toLowerCase()).toContain("sanction");

    // Idempotent second click does not duplicate entities
    const seedRes2 = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(seedRes2.status).toBe(201);
    const network2 = WorkspaceNetworkResponseSchema.parse(await seedRes2.json());
    expect(network2.products).toHaveLength(network1.products.length);
    expect(network2.inputs).toHaveLength(network1.inputs.length);
    expect(network2.facilities).toHaveLength(network1.facilities.length);
    expect(network2.lanes).toHaveLength(network1.lanes.length);

    // Network filtering by inputId (Material C is dual-sourced: FI + DE -> Tallinn HQ)
    const materialC = network1.inputs.find((i) => i.name === "Material C");
    expect(materialC).toBeDefined();
    const filteredRes = await app.request(
      `/api/v1/workspace/network?inputId=${materialC!.inputId}`,
      { headers: { Cookie: cookie } },
    );
    expect(filteredRes.status).toBe(200);
    const filtered = WorkspaceNetworkResponseSchema.parse(
      await filteredRes.json(),
    );
    expect(filtered.inputs).toHaveLength(1);
    expect(filtered.lanes).toHaveLength(2);
    expect(filtered.facilities).toHaveLength(4); // FI, DE, Tallinn HQ, Tartu Warehouse

    // Verify 30/70 multi-warehouse allocation split & downstream clients in demo
    const splitLanes = network1.lanes.filter(
      (l) => l.direction === "UPSTREAM" && l.allocationSplitPct != null,
    );
    expect(splitLanes.map((l) => l.allocationSplitPct).sort()).toEqual([30, 70]);
    const clientFacilities = network1.facilities.filter(
      (f) => f.relationshipRole === "CLIENT",
    );
    expect(clientFacilities.length).toBeGreaterThanOrEqual(2);
    const downstreamLanes = network1.lanes.filter(
      (l) => l.direction === "DOWNSTREAM",
    );
    expect(downstreamLanes.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves isOwnFacility when filtering network by a productId or inputId with zero lanes", async () => {
    const app = createTestApp();
    const { cookie } = await registerAndGetCookie(
      app,
      "filter-own@tallinn-mfg.ee",
      "Estonia Filter Own OU",
    );

    await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: cookie },
    });

    const emptyProdRes = await app.request("/api/v1/workspace/products", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Empty Lane Product" }),
    });
    expect(emptyProdRes.status).toBe(201);
    const { product: emptyProduct } = (await emptyProdRes.json()) as {
      product: { productId: string };
    };

    const filteredRes = await app.request(
      `/api/v1/workspace/network?productId=${emptyProduct.productId}`,
      { headers: { Cookie: cookie } },
    );
    expect(filteredRes.status).toBe(200);
    const filtered = WorkspaceNetworkResponseSchema.parse(
      await filteredRes.json(),
    );
    expect(filtered.lanes).toHaveLength(0);
    expect(filtered.facilities.some((f) => f.isOwnFacility)).toBe(true);
    expect(filtered.facilities.every((f) => f.isOwnFacility)).toBe(true);
  });

  it("ArcadeDbWorkspaceRepository.updateLane preserves existing lane edge if insert fails and deleteFacility revokes pending invites & removes partner links", async () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const facFromOld = "22222222-2222-4222-8222-222222222221";
    const facFromNew = "22222222-2222-4222-8222-222222222222";
    const facTo = "22222222-2222-4222-8222-222222222223";
    const laneId = "33333333-3333-4333-8333-333333333331";

    const commands: Array<{ statement: string; params: Record<string, unknown> }> = [];
    const mockDb: ArcadeDbClient = {
      async healthCheck() {
        return { connected: true, latencyMs: 1 };
      },
      async ensureDatabase() {},
      async query(_lang, statement, params = {}) {
        if (statement.includes("FROM SUPPLIES_LANE") && statement.includes("@rid")) {
          return [{ rid: "#10:0" }] as never;
        }
        if (statement.includes("FROM SUPPLIES_LANE")) {
          return [
            {
              laneId,
              ownerOrgId: orgId,
              fromFacilityId: facFromOld,
              toFacilityId: facTo,
              inputId: null,
              materialCategory: "Alloys",
              transportMode: "ROAD",
              volumeSharePct: 100,
              annualVolume: 100,
              volumeUnit: "TONNES",
              annualSpendEur: null,
              contractEndDate: null,
              contractTerms: null,
              leadTimeDays: null,
              distanceKm: 100,
              estimatedLaneCo2e: 9.6,
              riskStatus: "GREEN",
              riskReason: null,
            },
          ] as never;
        }
        if (statement.includes("FROM Facility")) {
          const fid = params.facilityId as string;
          return [
            {
              facilityId: fid,
              ownerOrgId: orgId,
              name: "Fac",
              kind: "FACTORY",
              locationPrecision: "SITE_VERIFIED",
              countryCode: "EE",
              regionCode: null,
              lat: 59.437,
              lng: 24.7536,
              isOwnFacility: fid === facTo,
              isPartnerVerified: false,
              sector: null,
              esgBadges: [],
              estimatedScope12Tco2e: null,
            },
          ] as never;
        }
        return [];
      },
      async command(_lang, statement, params = {}) {
        commands.push({ statement, params });
        if (statement.includes("CREATE EDGE SUPPLIES_LANE")) {
          throw new Error("Simulated transient ArcadeDB write failure");
        }
        return [];
      },
    };

    const { ArcadeDbWorkspaceRepository } = await import(
      "../src/workspace/repository.js"
    );
    const repo = new ArcadeDbWorkspaceRepository(mockDb);

    await expect(
      repo.updateLane(orgId, laneId, { fromFacilityId: facFromNew }),
    ).rejects.toThrow("Simulated transient ArcadeDB write failure");

    // Must never have deleted the old edge, and must have restored its laneId!
    expect(commands.some((c) => c.statement.includes("DELETE EDGE"))).toBe(false);
    const restoreCmd = commands[commands.length - 1];
    expect(restoreCmd?.statement).toContain("UPDATE SUPPLIES_LANE SET laneId = :laneId");
    expect(restoreCmd?.params.laneId).toBe(laneId);

    // deleteFacility must revoke pending invitations and remove VERIFIED_PARTNER_LINK edges
    commands.length = 0;
    const deleted = await repo.deleteFacility(orgId, facFromOld);
    expect(deleted).toBe(true);
    expect(
      commands.some(
        (c) =>
          c.statement.includes("UPDATE Invitation SET status = 'REVOKED'") &&
          c.params.facilityId === facFromOld,
      ),
    ).toBe(true);
    expect(
      commands.some(
        (c) =>
          c.statement.includes("DELETE EDGE VERIFIED_PARTNER_LINK") &&
          c.params.facilityId === facFromOld,
      ),
    ).toBe(true);
  });

  it("rejects empty orgId directly on WorkspaceRepository", async () => {
    const repo = new InMemoryWorkspaceRepository();
    await expect(repo.listProducts("")).rejects.toThrow();
    await expect(repo.listFacilities("   ")).rejects.toThrow();
  });

  it("prevents orphaned or duplicate Base Agreements on invalid dates and retries (#47)", async () => {
    const app = createTestApp();
    const { cookie } = await registerAndGetCookie(
      app,
      "contracts-47@tallinn-mfg.ee",
      "Estonia Contracts 47 OU",
    );

    const seedRes = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(seedRes.status).toBe(201);
    const network = WorkspaceNetworkResponseSchema.parse(await seedRes.json());
    const legacyLane = network.lanes.find(
      (l) => l.direction === "UPSTREAM" && (l.annualVolume ?? 0) > 0,
    );
    expect(legacyLane).toBeDefined();

    // 1. Invalid empty startDate must reject cleanly and leave ZERO contracts written
    const badRes = await app.request("/api/v1/workspace/contracts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        supplierFacilityId: legacyLane!.fromFacilityId,
        title: "Spot Top-Up",
        contractType: "SPOT_PO",
        pricingModel: "FIXED",
        expiryBehavior: "AUTO_ARCHIVE",
        confidence: "CONTRACTED",
        startDate: "",
        endDate: "2027-06-01",
        preserveLegacyBaseForLaneId: legacyLane!.laneId,
        lines: [
          {
            laneId: legacyLane!.laneId,
            inputId: legacyLane!.inputId,
            cadence: "TOTAL_OVER_TERM",
            committedVolume: 20,
            unit: legacyLane!.volumeUnit,
            committedSpend: 50000,
            currency: "EUR",
          },
        ],
      }),
    });
    expect(badRes.status).toBe(400);

    const afterBadList = await app.request("/api/v1/workspace/contracts", {
      headers: { Cookie: cookie },
    });
    const afterBadBody = (await afterBadList.json()) as {
      contracts: unknown[];
      contractLines: unknown[];
    };
    expect(afterBadBody.contracts).toHaveLength(0);
    expect(afterBadBody.contractLines).toHaveLength(0);

    // 2. Valid retry creates exactly ONE Base Agreement + ONE Spot Top-Up
    const validPayload = {
      supplierFacilityId: legacyLane!.fromFacilityId,
      title: "Spot Top-Up",
      contractType: "SPOT_PO",
      pricingModel: "FIXED",
      expiryBehavior: "AUTO_ARCHIVE",
      confidence: "CONTRACTED",
      startDate: "2026-06-01",
      endDate: "2026-12-31",
      preserveLegacyBaseForLaneId: legacyLane!.laneId,
      lines: [
        {
          laneId: legacyLane!.laneId,
          inputId: legacyLane!.inputId,
          cadence: "TOTAL_OVER_TERM",
          committedVolume: 20,
          unit: legacyLane!.volumeUnit,
          committedSpend: 50000,
          currency: "EUR",
        },
      ],
    };

    const okRes = await app.request("/api/v1/workspace/contracts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify(validPayload),
    });
    expect(okRes.status).toBe(201);

    // 3. A second request with preserveLegacyBaseForLaneId must NOT duplicate Base Agreement
    const retryRes = await app.request("/api/v1/workspace/contracts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ ...validPayload, title: "Spot Top-Up #2" }),
    });
    expect(retryRes.status).toBe(201);

    const finalList = await app.request("/api/v1/workspace/contracts", {
      headers: { Cookie: cookie },
    });
    const finalBody = (await finalList.json()) as {
      contracts: Array<{ title: string; contractType: string }>;
      contractLines: unknown[];
    };
    const baseAgreements = finalBody.contracts.filter(
      (c) => c.title === "Base Agreement",
    );
    expect(baseAgreements).toHaveLength(1);
    expect(finalBody.contracts).toHaveLength(3); // 1 Base + 2 Spot Top-Ups

    // 4. Invalid supplierFacilityId must reject with 400 BEFORE creating any Base Agreement
    const otherLegacyLane = network.lanes.find(
      (l) =>
        l.direction === "UPSTREAM" &&
        l.laneId !== legacyLane!.laneId &&
        (l.annualVolume ?? 0) > 0,
    );
    expect(otherLegacyLane).toBeDefined();
    const badSupplierRes = await app.request("/api/v1/workspace/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        ...validPayload,
        supplierFacilityId: "00000000-0000-4000-8000-000000000099",
        preserveLegacyBaseForLaneId: otherLegacyLane!.laneId,
        lines: [
          {
            laneId: otherLegacyLane!.laneId,
            inputId: otherLegacyLane!.inputId,
            cadence: "TOTAL_OVER_TERM",
            committedVolume: 10,
            unit: otherLegacyLane!.volumeUnit,
            committedSpend: 10000,
            currency: "EUR",
          },
        ],
      }),
    });
    expect(badSupplierRes.status).toBe(400);

    // 5. Replaying a committed request with the same idempotencyKey deduplicates cleanly
    const idemKey = "idem-lost-response-retry-001";
    const firstIdem = await app.request("/api/v1/workspace/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        ...validPayload,
        title: "Idempotent Spot PO",
        idempotencyKey: idemKey,
      }),
    });
    expect(firstIdem.status).toBe(201);
    const firstIdemBody = (await firstIdem.json()) as {
      contract: { contractId: string };
    };

    const replayIdem = await app.request("/api/v1/workspace/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        ...validPayload,
        title: "Idempotent Spot PO",
        idempotencyKey: idemKey,
      }),
    });
    expect(replayIdem.status).toBe(200);
    const replayIdemBody = (await replayIdem.json()) as {
      contract: { contractId: string };
    };
    expect(replayIdemBody.contract.contractId).toBe(
      firstIdemBody.contract.contractId,
    );

    const afterIdemList = await app.request("/api/v1/workspace/contracts", {
      headers: { Cookie: cookie },
    });
    const afterIdemBody = (await afterIdemList.json()) as {
      contracts: Array<{ title: string }>;
    };
    expect(
      afterIdemBody.contracts.filter((c) => c.title === "Idempotent Spot PO"),
    ).toHaveLength(1);
    expect(
      afterIdemBody.contracts.filter((c) => c.title === "Base Agreement"),
    ).toHaveLength(1);
  });

  it("applies allocation splits atomically with unit normalization (1 TONNE + 1000 KG -> 1.2 TONNES + 800 KG) and updates contract lines", async () => {
    const app = createTestApp();
    const { cookie } = await registerAndGetCookie(
      app,
      "splits-atomic@tallinn-mfg.ee",
      "Estonia Splits OU",
    );

    const createFac = async (body: Record<string, unknown>) => {
      const res = await app.request("/api/v1/workspace/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { facility: { facilityId: string } }).facility;
    };

    const supplier = await createFac({
      name: "Supplier Alpha",
      kind: "FACTORY",
      countryCode: "EE",
      lat: 58.38,
      lng: 26.72,
      relationshipRole: "SUPPLIER",
    });
    const whA = await createFac({
      name: "Tallinn WH",
      kind: "WAREHOUSE",
      countryCode: "EE",
      lat: 59.43,
      lng: 24.75,
      relationshipRole: "OWN",
    });
    const whB = await createFac({
      name: "Tartu WH",
      kind: "WAREHOUSE",
      countryCode: "EE",
      lat: 58.37,
      lng: 26.74,
      relationshipRole: "OWN",
    });

    const createLaneReq = async (body: Record<string, unknown>) => {
      const res = await app.request("/api/v1/workspace/lanes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { lane: { laneId: string } }).lane;
    };

    const laneTonnes = await createLaneReq({
      fromFacilityId: supplier.facilityId,
      toFacilityId: whA.facilityId,
      materialCategory: "Copper",
      transportMode: "ROAD",
      volumeSharePct: 50,
      allocationSplitPct: 50,
      annualVolume: 1,
      volumeUnit: "TONNES",
      annualSpendEur: 5000,
    });
    const laneKg = await createLaneReq({
      fromFacilityId: supplier.facilityId,
      toFacilityId: whB.facilityId,
      materialCategory: "Copper",
      transportMode: "ROAD",
      volumeSharePct: 50,
      allocationSplitPct: 50,
      annualVolume: 1000,
      volumeUnit: "KG",
      annualSpendEur: 5000,
    });

    // Rejects non-100% split atomically
    const badSplit = await app.request("/api/v1/workspace/lanes/allocation-splits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        splits: [
          { laneId: laneTonnes.laneId, allocationSplitPct: 60 },
          { laneId: laneKg.laneId, allocationSplitPct: 30 },
        ],
      }),
    });
    expect(badSplit.status).toBe(400);

    // 60/40 split on 1 TONNE + 1000 KG (= 2000 KG) -> 1.2 TONNES + 800 KG
    const okSplit = await app.request("/api/v1/workspace/lanes/allocation-splits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        splits: [
          { laneId: laneTonnes.laneId, allocationSplitPct: 60 },
          { laneId: laneKg.laneId, allocationSplitPct: 40 },
        ],
      }),
    });
    expect(okSplit.status).toBe(200);
    const splitBody = (await okSplit.json()) as {
      lanes: Array<{
        laneId: string;
        allocationSplitPct: number;
        annualVolume: number;
        annualSpendEur: number;
      }>;
    };
    const updatedTonnes = splitBody.lanes.find((l) => l.laneId === laneTonnes.laneId)!;
    const updatedKg = splitBody.lanes.find((l) => l.laneId === laneKg.laneId)!;
    expect(updatedTonnes.allocationSplitPct).toBe(60);
    expect(updatedTonnes.annualVolume).toBeCloseTo(1.2, 4);
    expect(updatedTonnes.annualSpendEur).toBe(6000);
    expect(updatedKg.allocationSplitPct).toBe(40);
    expect(updatedKg.annualVolume).toBeCloseTo(800, 4);
    expect(updatedKg.annualSpendEur).toBe(4000);
  });

  it("preserves relationshipRole, direction, and allocationSplitPct across CSV export/import round-trips", async () => {
    const app = createTestApp();
    const { cookie: sourceCookie } = await registerAndGetCookie(
      app,
      "csv-src@tallinn-mfg.ee",
      "CSV Source OU",
    );
    const seedRes = await app.request("/api/v1/workspace/seed-demo", {
      method: "POST",
      headers: { Cookie: sourceCookie },
    });
    expect(seedRes.status).toBe(201);

    const exportRes = await app.request("/api/v1/workspace/export?format=csv", {
      headers: { Cookie: sourceCookie },
    });
    expect(exportRes.status).toBe(200);
    const csvText = await exportRes.text();
    expect(csvText).toContain("relationshipRole");
    expect(csvText).toContain("direction");
    expect(csvText).toContain("allocationSplitPct");

    const { cookie: destCookie } = await registerAndGetCookie(
      app,
      "csv-dst@tallinn-mfg.ee",
      "CSV Dest OU",
    );
    const importRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv", Cookie: destCookie },
      body: csvText,
    });
    expect(importRes.status).toBe(200);

    const netRes = await app.request("/api/v1/workspace/network", {
      headers: { Cookie: destCookie },
    });
    const restored = WorkspaceNetworkResponseSchema.parse(await netRes.json());
    expect(
      restored.facilities.filter((f) => f.relationshipRole === "CLIENT").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      restored.lanes.filter((l) => l.direction === "DOWNSTREAM").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      restored.lanes
        .filter((l) => l.direction === "UPSTREAM" && l.allocationSplitPct != null)
        .map((l) => l.allocationSplitPct)
        .sort(),
    ).toEqual([30, 70]);
  });

  it("ArcadeDbWorkspaceRepository SELECT queries project relationshipRole, direction, and allocationSplitPct", async () => {
    const seenSql: string[] = [];
    const mockDb: ArcadeDbClient = {
      healthCheck: vi.fn(async () => ({ connected: true, latencyMs: 1 })),
      ensureDatabase: vi.fn(async () => undefined),
      query: vi.fn(async (_lang: string, sql: string) => {
        seenSql.push(sql);
        return [];
      }),
      command: vi.fn(async () => []),
    };
    const repo = new ArcadeDbWorkspaceRepository(mockDb);
    const orgId = "11111111-1111-4111-8111-111111111111";
    const id = "22222222-2222-4222-8222-222222222222";
    await repo.listFacilities(orgId);
    await repo.updateFacility(orgId, id, { name: "Probe" });
    await repo.listLanes(orgId);
    await repo.updateLane(orgId, id, { leadTimeDays: 5 });

    const facilityQueries = seenSql.filter((s) => s.includes("FROM Facility"));
    const laneQueries = seenSql.filter((s) => s.includes("FROM SUPPLIES_LANE"));
    expect(facilityQueries).toHaveLength(2);
    for (const q of facilityQueries) {
      expect(q).toContain("relationshipRole");
    }
    expect(laneQueries).toHaveLength(2);
    for (const q of laneQueries) {
      expect(q).toContain("direction");
      expect(q).toContain("allocationSplitPct");
    }
  });

  it("excludes DOWNSTREAM client delivery volumes from sourcing risk even when linked to the same inputId", async () => {
    const app = createTestApp();
    const { cookie } = await registerAndGetCookie(
      app,
      "downstream-risk@tallinn-mfg.ee",
      "Downstream Risk OU",
    );

    // Create product + input with annualDemandQty = 100 TONNES
    const prodRes = await app.request("/api/v1/workspace/products", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Widget",
        sku: "WDG-1",
        annualRevenueEur: 1_000_000,
        grossMarginPct: 40,
      }),
    });
    const { product } = (await prodRes.json()) as {
      product: { productId: string };
    };

    const inputRes = await app.request("/api/v1/workspace/inputs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        productId: product.productId,
        name: "Steel Coil",
        category: "STEEL",
        unit: "TONNES",
        totalAnnualDemand: 100,
        materialCriticality: 1,
      }),
    });
    expect(inputRes.status).toBe(201);
    const { input } = (await inputRes.json()) as {
      input: { inputId: string };
    };

    const mkFac = async (
      name: string,
      isOwnFacility: boolean,
      relationshipRole: "OWN" | "SUPPLIER" | "CLIENT",
      lat: number,
      lng: number,
    ) => {
      const res = await app.request("/api/v1/workspace/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          name,
          kind: relationshipRole === "CLIENT" ? "WAREHOUSE" : "FACTORY",
          isOwnFacility,
          relationshipRole,
          tier: relationshipRole === "SUPPLIER" ? 1 : 0,
          countryCode: "EE",
          lat,
          lng,
          locationPrecision: "SITE_VERIFIED",
        }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { facility: { facilityId: string } }).facility;
    };

    const ownFac = await mkFac("Own Plant", true, "OWN", 59.437, 24.7536);
    const supFac = await mkFac("Upstream Supplier", false, "SUPPLIER", 58.378, 26.729);
    const clientFac = await mkFac("Downstream Client", false, "CLIENT", 60.1699, 24.9384);

    // Upstream lane covers only 40 TONNES out of 100 TONNES demand (60 TONNES uncontracted)
    const upLaneRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        fromFacilityId: supFac.facilityId,
        toFacilityId: ownFac.facilityId,
        direction: "UPSTREAM",
        inputId: input.inputId,
        materialCategory: "STEEL",
        transportMode: "ROAD",
        annualVolume: 40,
        volumeUnit: "TONNES",
        annualSpendEur: 40_000,
        leadTimeDays: 10,
      }),
    });
    expect(upLaneRes.status).toBe(201);

    const beforeRes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: cookie },
    });
    expect(beforeRes.status).toBe(200);
    const before = (await beforeRes.json()) as {
      financialRisk: {
        baseEur: number | null;
        totalActiveSpendEur: number;
        materials: Array<{
          inputId: string;
          mappedActiveVolume: number | null;
          uncontractedDemand: number | null;
        }>;
      };
    };

    // Add a DOWNSTREAM client delivery lane of 60 TONNES linked to the SAME inputId
    const dsLaneRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        fromFacilityId: ownFac.facilityId,
        toFacilityId: clientFac.facilityId,
        direction: "DOWNSTREAM",
        inputId: input.inputId,
        materialCategory: "STEEL",
        transportMode: "ROAD",
        annualVolume: 60,
        volumeUnit: "TONNES",
        annualSpendEur: 60_000,
        leadTimeDays: 5,
      }),
    });
    expect(dsLaneRes.status).toBe(201);

    const afterRes = await app.request("/api/v1/analytics/summary", {
      headers: { Cookie: cookie },
    });
    expect(afterRes.status).toBe(200);
    const after = (await afterRes.json()) as {
      financialRisk: {
        baseEur: number | null;
        totalActiveSpendEur: number;
        materials: Array<{
          inputId: string;
          mappedActiveVolume: number | null;
          uncontractedDemand: number | null;
        }>;
      };
    };

    const beforeMat = before.financialRisk.materials.find(
      (m) => m.inputId === input.inputId,
    );
    const afterMat = after.financialRisk.materials.find(
      (m) => m.inputId === input.inputId,
    );
    expect(beforeMat?.mappedActiveVolume).toBeCloseTo(40, 4);
    expect(afterMat?.mappedActiveVolume).toBeCloseTo(40, 4);
    expect(beforeMat?.uncontractedDemand).toBeCloseTo(60, 4);
    expect(afterMat?.uncontractedDemand).toBeCloseTo(60, 4);
    expect(after.financialRisk.totalActiveSpendEur).toBeCloseTo(
      before.financialRisk.totalActiveSpendEur,
      2,
    );
    expect(after.financialRisk.baseEur).toBe(before.financialRisk.baseEur);
  });
});

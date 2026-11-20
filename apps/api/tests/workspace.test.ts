import { estimateLaneCo2eTonnes, haversineDistanceKm } from "@kulgo/engine";
import { WorkspaceNetworkResponseSchema } from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createApp, createTestApp } from "../src/app.js";
import { InMemoryAuthRepository } from "../src/auth/repository.js";
import { loadConfig } from "../src/config.js";
import type { ArcadeDbClient } from "../src/db/client.js";
import { InMemoryWorkspaceRepository } from "../src/workspace/repository.js";

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
    expect(filtered.facilities).toHaveLength(3); // FI, DE, Tallinn HQ
  });

  it("rejects empty orgId directly on WorkspaceRepository", async () => {
    const repo = new InMemoryWorkspaceRepository();
    await expect(repo.listProducts("")).rejects.toThrow();
    await expect(repo.listFacilities("   ")).rejects.toThrow();
  });
});

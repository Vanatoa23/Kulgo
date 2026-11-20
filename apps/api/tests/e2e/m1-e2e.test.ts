import {
  AuthMeResponseSchema,
  FacilitySchema,
  HealthResponseSchema,
  ProductSchema,
  SupplyInputSchema,
  SupplyLaneSchema,
  WorkspaceNetworkResponseSchema,
  type Facility,
  type Organization,
  type Product,
  type SupplyInput,
  type SupplyLane,
  type User,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../../src/app.js";

type TestApp = ReturnType<typeof createTestApp>;

/**
 * Opaque-box HTTP client with a browser-faithful cookie jar.
 * Captures `Set-Cookie` headers from responses and attaches `Cookie` headers
 * on subsequent requests, mirroring `fetch(..., { credentials: "include" })`.
 */
class CookieJarClient {
  private readonly cookies = new Map<string, string>();
  private lastSetCookies: string[] = [];

  constructor(private readonly app: TestApp) {}

  getLastSetCookies(): readonly string[] {
    return this.lastSetCookies;
  }

  getCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  getCookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  private extractSetCookies(res: Response): string[] {
    const headers = res.headers as Headers & {
      getSetCookie?: () => string[];
    };
    if (typeof headers.getSetCookie === "function") {
      const list = headers.getSetCookie();
      if (list.length > 0) return list;
    }
    const single = res.headers.get("set-cookie");
    return single ? [single] : [];
  }

  private captureCookies(res: Response): void {
    const setCookies = this.extractSetCookies(res);
    this.lastSetCookies = setCookies;
    for (const rawCookie of setCookies) {
      const segments = rawCookie.split(";").map((part) => part.trim());
      const pair = segments[0];
      if (!pair) continue;
      const eqIndex = pair.indexOf("=");
      if (eqIndex <= 0) continue;
      const name = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      const lowerAttrs = segments.slice(1).map((s) => s.toLowerCase());
      const isExpired =
        value === "" ||
        lowerAttrs.some(
          (attr) =>
            attr === "max-age=0" ||
            attr.startsWith("max-age=-") ||
            attr.startsWith("expires=thu, 01 jan 1970"),
        );
      if (isExpired) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  async rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader && !headers.has("cookie")) {
      headers.set("cookie", cookieHeader);
    }
    const res = await this.app.request(path, { ...init, headers });
    this.captureCookies(res);
    return res;
  }

  async get(path: string): Promise<Response> {
    return this.rawRequest(path, { method: "GET" });
  }

  async post(path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    let serialized: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      serialized = JSON.stringify(body);
    }
    return this.rawRequest(path, {
      method: "POST",
      headers,
      body: serialized,
    });
  }

  async patch(path: string, body: unknown): Promise<Response> {
    return this.rawRequest(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async delete(path: string): Promise<Response> {
    return this.rawRequest(path, { method: "DELETE" });
  }
}

interface AuthSessionContext {
  client: CookieJarClient;
  user: User;
  organization: Organization;
  email: string;
  password: string;
  setCookies: readonly string[];
}

let uniqueCounter = 0;
function nextEmail(prefix = "ops"): string {
  uniqueCounter += 1;
  return `${prefix}.${uniqueCounter}@kulgo-e2e.example`;
}

async function registerOrg(
  app: TestApp,
  overrides: Partial<{
    email: string;
    password: string;
    organizationName: string;
    countryCode: string;
    sector: string;
  }> = {},
): Promise<AuthSessionContext> {
  const client = new CookieJarClient(app);
  const email = overrides.email ?? nextEmail();
  const password = overrides.password ?? "KulgoSecurePass!2026";
  const payload = {
    email,
    password,
    organizationName: overrides.organizationName ?? "Baltic Precision OÜ",
    countryCode: overrides.countryCode ?? "EE",
    sector: overrides.sector ?? "Electronics Manufacturing",
  };
  const res = await client.post("/api/v1/auth/register", payload);
  expect(res.status).toBe(201);
  const raw = (await res.json()) as unknown;
  assertNoPasswordLeak(raw, password);
  const parsed = AuthMeResponseSchema.parse(raw);
  return {
    client,
    user: parsed.user,
    organization: parsed.organization,
    email,
    password,
    setCookies: client.getLastSetCookies(),
  };
}

function assertNoPasswordLeak(payload: unknown, plaintextPassword?: string): void {
  const serialized = JSON.stringify(payload);
  expect(serialized.toLowerCase()).not.toContain("passwordhash");
  expect(serialized.toLowerCase()).not.toContain("password_hash");
  if (plaintextPassword) {
    expect(serialized).not.toContain(plaintextPassword);
  }
}

function assertWktIfPresent(
  rawFacility: Record<string, unknown>,
  expectedLng: number,
  expectedLat: number,
): void {
  if (typeof rawFacility.locationWkt === "string") {
    expect(rawFacility.locationWkt).toBe(`POINT (${expectedLng} ${expectedLat})`);
  }
}

async function createProductHelper(
  client: CookieJarClient,
  input: { name: string; sku?: string; description?: string },
): Promise<Product> {
  const res = await client.post("/api/v1/workspace/products", input);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { product: unknown };
  return ProductSchema.parse(body.product);
}

async function createInputHelper(
  client: CookieJarClient,
  input: {
    productId?: string | null;
    name: string;
    category: string;
    unit?: "UNITS" | "TONNES" | "KG" | "LITERS" | "EUR_VALUE";
  },
): Promise<SupplyInput> {
  const res = await client.post("/api/v1/workspace/inputs", input);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { input: unknown };
  return SupplyInputSchema.parse(body.input);
}

async function createFacilityHelper(
  client: CookieJarClient,
  input: {
    name: string;
    kind?: "HQ" | "FACTORY" | "WAREHOUSE" | "PORT" | "HUB" | "EXTRACTION" | "CUSTOMER";
    locationPrecision?: "HQ_ESTIMATED" | "SITE_VERIFIED";
    countryCode: string;
    regionCode?: string;
    lat: number;
    lng: number;
    isOwnFacility?: boolean;
    sector?: string;
    esgBadges?: string[];
    estimatedScope12Tco2e?: number;
  },
): Promise<{ facility: Facility; raw: Record<string, unknown> }> {
  const res = await client.post("/api/v1/workspace/facilities", input);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { facility: Record<string, unknown> };
  assertWktIfPresent(body.facility, input.lng, input.lat);
  return {
    facility: FacilitySchema.parse(body.facility),
    raw: body.facility,
  };
}

async function createLaneHelper(
  client: CookieJarClient,
  input: {
    fromFacilityId: string;
    toFacilityId: string;
    inputId?: string | null;
    materialCategory: string;
    transportMode?: "SEA" | "AIR" | "RAIL" | "ROAD" | "MULTIMODAL";
    volumeSharePct?: number;
    annualVolume?: number;
    volumeUnit?: "UNITS" | "TONNES" | "KG" | "LITERS" | "EUR_VALUE";
    annualSpendEur?: number;
    contractEndDate?: string;
    contractTerms?: string;
    leadTimeDays?: number;
    distanceKm?: number;
    estimatedLaneCo2e?: number;
    riskStatus?: "GREEN" | "YELLOW" | "RED";
    riskReason?: string;
  },
): Promise<SupplyLane> {
  const res = await client.post("/api/v1/workspace/lanes", input);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { lane: unknown };
  return SupplyLaneSchema.parse(body.lane);
}

// ============================================================================
// TIER 1 — FEATURE COVERAGE
// ============================================================================
describe("Tier 1 — M1 Feature Coverage", () => {
  it("GET /api/v1/health returns 200 ok with valid HealthResponseSchema", async () => {
    const app = createTestApp();
    const client = new CookieJarClient(app);

    const res = await client.get("/api/v1/health");
    expect(res.status).toBe(200);

    const health = HealthResponseSchema.parse(await res.json());
    expect(health.status).toBe("ok");
    expect(health.service).toBe("kulgo-api");
    expect(health.database.engine).toBe("arcadedb");
    expect(health.database.connected).toBe(true);
  });

  it("Auth lifecycle: register, HttpOnly cookie attributes, /auth/me, logout, and login without passwordHash leak", async () => {
    const app = createTestApp();
    const { client, user, organization, email, password, setCookies } =
      await registerOrg(app, {
        organizationName: "Tallinn Components OÜ",
        countryCode: "EE",
        sector: "Industrial Electronics",
      });

    expect(user.email).toBe(email);
    expect(user.orgId).toBe(organization.orgId);
    expect(organization.name).toBe("Tallinn Components OÜ");
    expect(organization.countryCode).toBe("EE");

    // Verify HttpOnly session cookie attributes
    const sessionCookieHeader = setCookies.find((c) =>
      c.toLowerCase().startsWith("kulgo_session="),
    );
    expect(sessionCookieHeader).toBeDefined();
    expect(sessionCookieHeader?.toLowerCase()).toContain("httponly");
    expect(sessionCookieHeader?.toLowerCase()).toContain("samesite=lax");
    expect(sessionCookieHeader?.toLowerCase()).toContain("path=/");
    expect(client.getCookie("kulgo_session")).toBeTruthy();

    // GET /api/v1/auth/me with session cookie
    const meRes = await client.get("/api/v1/auth/me");
    expect(meRes.status).toBe(200);
    const meRaw = (await meRes.json()) as unknown;
    assertNoPasswordLeak(meRaw, password);
    const me = AuthMeResponseSchema.parse(meRaw);
    expect(me.user.userId).toBe(user.userId);
    expect(me.organization.orgId).toBe(organization.orgId);

    // POST /api/v1/auth/logout clears cookie and revokes session
    const logoutRes = await client.post("/api/v1/auth/logout");
    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });
    expect(client.getCookie("kulgo_session")).toBeUndefined();

    const meAfterLogout = await client.get("/api/v1/auth/me");
    expect(meAfterLogout.status).toBe(401);

    // POST /api/v1/auth/login re-authenticates with Argon2id
    const loginRes = await client.post("/api/v1/auth/login", {
      email,
      password,
    });
    expect(loginRes.status).toBe(200);
    const loginRaw = (await loginRes.json()) as unknown;
    assertNoPasswordLeak(loginRaw, password);
    const loggedIn = AuthMeResponseSchema.parse(loginRaw);
    expect(loggedIn.user.userId).toBe(user.userId);
    expect(client.getCookie("kulgo_session")).toBeTruthy();

    const meAfterLogin = await client.get("/api/v1/auth/me");
    expect(meAfterLogin.status).toBe(200);
  });

  it("Products CRUD: create, list, update, and delete", async () => {
    const app = createTestApp();
    const { client, organization } = await registerOrg(app);

    const created = await createProductHelper(client, {
      name: "Product X — Smart Inverter",
      sku: "PX-INV-001",
      description: "Flagship grid-tied inverter assembled in Tallinn",
    });
    expect(created.ownerOrgId).toBe(organization.orgId);
    expect(created.sku).toBe("PX-INV-001");

    // List
    const listRes = await client.get("/api/v1/workspace/products");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { products: unknown[] };
    const products = listBody.products.map((p) => ProductSchema.parse(p));
    expect(products.some((p) => p.productId === created.productId)).toBe(true);

    // Update
    const patchRes = await client.patch(
      `/api/v1/workspace/products/${created.productId}`,
      {
        name: "Product X — Gen 2 Inverter",
        sku: "PX-INV-002",
        description: "Updated BOM revision",
      },
    );
    expect(patchRes.status).toBe(200);
    const updated = ProductSchema.parse(
      ((await patchRes.json()) as { product: unknown }).product,
    );
    expect(updated.name).toBe("Product X — Gen 2 Inverter");
    expect(updated.sku).toBe("PX-INV-002");

    // Delete
    const deleteRes = await client.delete(
      `/api/v1/workspace/products/${created.productId}`,
    );
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ ok: true });

    // Confirm removed
    const afterDeleteRes = await client.get("/api/v1/workspace/products");
    const afterDelete = (await afterDeleteRes.json()) as { products: Product[] };
    expect(afterDelete.products.some((p) => p.productId === created.productId)).toBe(
      false,
    );

    // Deleting non-existent returns 404
    const deleteAgainRes = await client.delete(
      `/api/v1/workspace/products/${created.productId}`,
    );
    expect(deleteAgainRes.status).toBe(404);
  });

  it("SupplyInputs CRUD (Materials A–F): create, list, update, and delete", async () => {
    const app = createTestApp();
    const { client, organization } = await registerOrg(app);

    const product = await createProductHelper(client, { name: "Product X" });
    const created = await createInputHelper(client, {
      productId: product.productId,
      name: "Material A — Silicon Carbide Wafers",
      category: "Semiconductors",
      unit: "UNITS",
    });
    expect(created.ownerOrgId).toBe(organization.orgId);
    expect(created.productId).toBe(product.productId);
    expect(created.unit).toBe("UNITS");

    // List
    const listRes = await client.get("/api/v1/workspace/inputs");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { inputs: unknown[] };
    const inputs = listBody.inputs.map((i) => SupplyInputSchema.parse(i));
    expect(inputs.some((i) => i.inputId === created.inputId)).toBe(true);

    // Update
    const patchRes = await client.patch(
      `/api/v1/workspace/inputs/${created.inputId}`,
      {
        name: "Material A — SiC Power Modules",
        category: "Power Semiconductors",
        unit: "KG",
      },
    );
    expect(patchRes.status).toBe(200);
    const updated = SupplyInputSchema.parse(
      ((await patchRes.json()) as { input: unknown }).input,
    );
    expect(updated.name).toBe("Material A — SiC Power Modules");
    expect(updated.unit).toBe("KG");

    // Delete
    const deleteRes = await client.delete(
      `/api/v1/workspace/inputs/${created.inputId}`,
    );
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ ok: true });

    const deleteAgainRes = await client.delete(
      `/api/v1/workspace/inputs/${created.inputId}`,
    );
    expect(deleteAgainRes.status).toBe(404);
  });

  it("Facilities CRUD + HQ_ESTIMATED -> SITE_VERIFIED refinement + WKT POINT (lng lat)", async () => {
    const app = createTestApp();
    const { client, organization } = await registerOrg(app);

    const { facility: created } = await createFacilityHelper(client, {
      name: "Riga Metalworks (HQ)",
      kind: "HQ",
      locationPrecision: "HQ_ESTIMATED",
      countryCode: "lv",
      regionCode: "LV-RIX",
      lat: 56.9496,
      lng: 24.1052,
      isOwnFacility: false,
      sector: "Metallurgy",
      esgBadges: ["ISO-14001"],
      estimatedScope12Tco2e: 410,
    });
    expect(created.ownerOrgId).toBe(organization.orgId);
    expect(created.countryCode).toBe("LV");
    expect(created.locationPrecision).toBe("HQ_ESTIMATED");

    // List
    const listRes = await client.get("/api/v1/workspace/facilities");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { facilities: unknown[] };
    const facilities = listBody.facilities.map((f) => FacilitySchema.parse(f));
    expect(facilities.some((f) => f.facilityId === created.facilityId)).toBe(true);

    // Refine HQ_ESTIMATED -> SITE_VERIFIED with exact plant coordinates
    const refinedLat = 56.5047;
    const refinedLng = 21.0108;
    const patchRes = await client.patch(
      `/api/v1/workspace/facilities/${created.facilityId}`,
      {
        name: "Liepāja Casting Plant",
        kind: "FACTORY",
        locationPrecision: "SITE_VERIFIED",
        lat: refinedLat,
        lng: refinedLng,
      },
    );
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as {
      facility: Record<string, unknown>;
    };
    assertWktIfPresent(patchBody.facility, refinedLng, refinedLat);
    const refined = FacilitySchema.parse(patchBody.facility);
    expect(refined.locationPrecision).toBe("SITE_VERIFIED");
    expect(refined.kind).toBe("FACTORY");
    expect(refined.lat).toBeCloseTo(refinedLat, 5);
    expect(refined.lng).toBeCloseTo(refinedLng, 5);

    // Delete
    const deleteRes = await client.delete(
      `/api/v1/workspace/facilities/${created.facilityId}`,
    );
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ ok: true });
  });

  it("SupplyLanes CRUD: volume splits, EUR spend, contract end dates, risk status, distance & CO2e", async () => {
    const app = createTestApp();
    const { client, organization } = await registerOrg(app);

    const product = await createProductHelper(client, { name: "Product X" });
    const input = await createInputHelper(client, {
      productId: product.productId,
      name: "Material B — Copper Busbars",
      category: "Metals",
      unit: "TONNES",
    });
    const { facility: supplier } = await createFacilityHelper(client, {
      name: "Helsinki Copper Works",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "FI",
      lat: 60.1699,
      lng: 24.9384,
    });
    const { facility: hq } = await createFacilityHelper(client, {
      name: "Tallinn Assembly HQ",
      kind: "HQ",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "EE",
      lat: 59.437,
      lng: 24.7536,
      isOwnFacility: true,
    });

    const created = await createLaneHelper(client, {
      fromFacilityId: supplier.facilityId,
      toFacilityId: hq.facilityId,
      inputId: input.inputId,
      materialCategory: "Metals",
      transportMode: "SEA",
      volumeSharePct: 65,
      annualVolume: 320,
      volumeUnit: "TONNES",
      annualSpendEur: 285000,
      contractEndDate: "2027-06-30",
      contractTerms: "FOB Helsinki, Net 30",
      leadTimeDays: 4,
      riskStatus: "GREEN",
      riskReason: "Verified Nordic maritime corridor",
    });

    expect(created.ownerOrgId).toBe(organization.orgId);
    expect(created.volumeSharePct).toBe(65);
    expect(created.annualSpendEur).toBe(285000);
    expect(created.contractEndDate).toBe("2027-06-30");
    expect(created.riskStatus).toBe("GREEN");
    if (created.distanceKm !== null) {
      expect(created.distanceKm).toBeGreaterThan(50);
      expect(created.distanceKm).toBeLessThan(200);
    }
    if (created.estimatedLaneCo2e !== null) {
      expect(created.estimatedLaneCo2e).toBeGreaterThanOrEqual(0);
    }

    // List
    const listRes = await client.get("/api/v1/workspace/lanes");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { lanes: unknown[] };
    const lanes = listBody.lanes.map((l) => SupplyLaneSchema.parse(l));
    expect(lanes.some((l) => l.laneId === created.laneId)).toBe(true);

    // Update risk & commercial terms
    const patchRes = await client.patch(
      `/api/v1/workspace/lanes/${created.laneId}`,
      {
        volumeSharePct: 45,
        annualSpendEur: 195000,
        contractEndDate: "2028-03-31",
        riskStatus: "YELLOW",
        riskReason: "Winter ice-class vessel surcharges",
      },
    );
    expect(patchRes.status).toBe(200);
    const updated = SupplyLaneSchema.parse(
      ((await patchRes.json()) as { lane: unknown }).lane,
    );
    expect(updated.volumeSharePct).toBe(45);
    expect(updated.annualSpendEur).toBe(195000);
    expect(updated.contractEndDate).toBe("2028-03-31");
    expect(updated.riskStatus).toBe("YELLOW");

    // Delete
    const deleteRes = await client.delete(
      `/api/v1/workspace/lanes/${created.laneId}`,
    );
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ ok: true });
  });

  it("Network fetch & 1-click Estonia 'Product X' demo seed", async () => {
    const app = createTestApp();
    const { client, organization } = await registerOrg(app, {
      organizationName: "Estonia Power Systems OÜ",
      countryCode: "EE",
    });

    // Empty network initially
    const emptyRes = await client.get("/api/v1/workspace/network");
    expect(emptyRes.status).toBe(200);
    const emptyNet = WorkspaceNetworkResponseSchema.parse(await emptyRes.json());
    expect(emptyNet.products).toHaveLength(0);
    expect(emptyNet.inputs).toHaveLength(0);
    expect(emptyNet.facilities).toHaveLength(0);
    expect(emptyNet.lanes).toHaveLength(0);

    // Trigger 1-click Estonia "Product X" demo seed
    const seedRes = await client.post("/api/v1/workspace/seed-demo");
    expect(seedRes.status).toBe(201);
    const seeded = WorkspaceNetworkResponseSchema.parse(await seedRes.json());

    // Verify Product X & Materials A-F
    expect(seeded.products.length).toBeGreaterThanOrEqual(1);
    expect(
      seeded.products.some((p) => p.name.toLowerCase().includes("product x")),
    ).toBe(true);
    expect(seeded.inputs.length).toBeGreaterThanOrEqual(6);

    // Verify Tallinn HQ & suppliers across EE, LV, FI, DE, CN
    const ownHq = seeded.facilities.find(
      (f) => f.countryCode === "EE" && f.isOwnFacility,
    );
    expect(ownHq).toBeDefined();

    const countries = new Set(seeded.facilities.map((f) => f.countryCode));
    for (const expectedCountry of ["EE", "LV", "FI", "DE", "CN"]) {
      expect(countries.has(expectedCountry)).toBe(true);
    }

    // Verify Yellow China corridor risk & Red Latvian sanctions risk
    const facilityById = new Map(
      seeded.facilities.map((f) => [f.facilityId, f]),
    );
    const yellowChinaLane = seeded.lanes.find((l) => {
      const from = facilityById.get(l.fromFacilityId);
      return from?.countryCode === "CN" && l.riskStatus === "YELLOW";
    });
    expect(yellowChinaLane).toBeDefined();

    const redLatviaLane = seeded.lanes.find((l) => {
      const from = facilityById.get(l.fromFacilityId);
      return from?.countryCode === "LV" && l.riskStatus === "RED";
    });
    expect(redLatviaLane).toBeDefined();

    // Every entity belongs to the authenticated organization
    for (const p of seeded.products) expect(p.ownerOrgId).toBe(organization.orgId);
    for (const i of seeded.inputs) expect(i.ownerOrgId).toBe(organization.orgId);
    for (const f of seeded.facilities) {
      expect(f.ownerOrgId).toBe(organization.orgId);
    }
    for (const l of seeded.lanes) expect(l.ownerOrgId).toBe(organization.orgId);

    // GET /workspace/network reflects the seeded data
    const networkRes = await client.get("/api/v1/workspace/network");
    expect(networkRes.status).toBe(200);
    const network = WorkspaceNetworkResponseSchema.parse(await networkRes.json());
    expect(network.products.length).toBe(seeded.products.length);
    expect(network.inputs.length).toBe(seeded.inputs.length);
    expect(network.facilities.length).toBe(seeded.facilities.length);
    expect(network.lanes.length).toBe(seeded.lanes.length);
  });
});

// ============================================================================
// TIER 2 — BOUNDARY & CORNER CASES
// ============================================================================
describe("Tier 2 — Boundary & Corner Cases", () => {
  it("rejects invalid emails, short passwords (<10 chars), duplicate emails (409), and invalid credentials (401)", async () => {
    const app = createTestApp();
    const client = new CookieJarClient(app);

    // Invalid email
    const badEmailRes = await client.post("/api/v1/auth/register", {
      email: "not-an-email",
      password: "ValidPassword123!",
      organizationName: "Bad Email OÜ",
    });
    expect(badEmailRes.status).toBe(400);

    // Password shorter than 10 characters (9 chars)
    const shortPassRes = await client.post("/api/v1/auth/register", {
      email: nextEmail("short"),
      password: "123456789",
      organizationName: "Short Pass OÜ",
    });
    expect(shortPassRes.status).toBe(400);

    // Valid registration
    const email = nextEmail("dup");
    const password = "StrongPassword123!";
    const firstReg = await client.post("/api/v1/auth/register", {
      email,
      password,
      organizationName: "Original Org OÜ",
    });
    expect(firstReg.status).toBe(201);

    // Duplicate email -> 409
    const dupClient = new CookieJarClient(app);
    const dupReg = await dupClient.post("/api/v1/auth/register", {
      email,
      password: "AnotherStrongPassword123!",
      organizationName: "Duplicate Org OÜ",
    });
    expect(dupReg.status).toBe(409);

    // Wrong password -> 401
    const wrongPassRes = await dupClient.post("/api/v1/auth/login", {
      email,
      password: "WrongPassword123!",
    });
    expect(wrongPassRes.status).toBe(401);

    // Unknown email -> 401
    const unknownUserRes = await dupClient.post("/api/v1/auth/login", {
      email: "does-not-exist@kulgo-e2e.example",
      password,
    });
    expect(unknownUserRes.status).toBe(401);
  });

  it("returns 401 on all workspace routes when unauthenticated or with an invalid cookie", async () => {
    const app = createTestApp();
    const anon = new CookieJarClient(app);
    const fakeId = "00000000-0000-4000-8000-000000000001";

    const endpoints: Array<{
      method: "GET" | "POST" | "PATCH" | "DELETE";
      path: string;
      body?: unknown;
    }> = [
      { method: "GET", path: "/api/v1/auth/me" },
      { method: "GET", path: "/api/v1/workspace/network" },
      { method: "GET", path: "/api/v1/workspace/products" },
      { method: "POST", path: "/api/v1/workspace/products", body: { name: "X" } },
      {
        method: "PATCH",
        path: `/api/v1/workspace/products/${fakeId}`,
        body: { name: "Y" },
      },
      { method: "DELETE", path: `/api/v1/workspace/products/${fakeId}` },
      { method: "GET", path: "/api/v1/workspace/inputs" },
      {
        method: "POST",
        path: "/api/v1/workspace/inputs",
        body: { name: "Mat A", category: "Metals" },
      },
      {
        method: "PATCH",
        path: `/api/v1/workspace/inputs/${fakeId}`,
        body: { name: "Mat B" },
      },
      { method: "DELETE", path: `/api/v1/workspace/inputs/${fakeId}` },
      { method: "GET", path: "/api/v1/workspace/facilities" },
      {
        method: "POST",
        path: "/api/v1/workspace/facilities",
        body: { name: "HQ", countryCode: "EE", lat: 59.4, lng: 24.7 },
      },
      {
        method: "PATCH",
        path: `/api/v1/workspace/facilities/${fakeId}`,
        body: { name: "HQ2" },
      },
      { method: "DELETE", path: `/api/v1/workspace/facilities/${fakeId}` },
      { method: "GET", path: "/api/v1/workspace/lanes" },
      {
        method: "POST",
        path: "/api/v1/workspace/lanes",
        body: {
          fromFacilityId: fakeId,
          toFacilityId: "00000000-0000-4000-8000-000000000002",
          materialCategory: "Metals",
        },
      },
      {
        method: "PATCH",
        path: `/api/v1/workspace/lanes/${fakeId}`,
        body: { riskStatus: "RED" },
      },
      { method: "DELETE", path: `/api/v1/workspace/lanes/${fakeId}` },
      { method: "POST", path: "/api/v1/workspace/seed-demo" },
    ];

    for (const ep of endpoints) {
      const res = await anon.rawRequest(ep.path, {
        method: ep.method,
        headers: ep.body ? { "content-type": "application/json" } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      expect(res.status, `Expected 401 for ${ep.method} ${ep.path}`).toBe(401);
    }

    // Also reject forged cookie token
    const forgedRes = await anon.rawRequest("/api/v1/workspace/network", {
      method: "GET",
      headers: { cookie: "kulgo_session=forged-nonexistent-session-token" },
    });
    expect(forgedRes.status).toBe(401);
  });

  it("rejects out-of-bounds lat/lng coordinates on facility create and update", async () => {
    const app = createTestApp();
    const { client } = await registerOrg(app);

    const invalidCoords = [
      { lat: 91, lng: 24.75 },
      { lat: -90.01, lng: 24.75 },
      { lat: 59.43, lng: -181 },
      { lat: 59.43, lng: 180.5 },
    ];

    for (const coords of invalidCoords) {
      const res = await client.post("/api/v1/workspace/facilities", {
        name: "Invalid Coord Site",
        countryCode: "EE",
        lat: coords.lat,
        lng: coords.lng,
      });
      expect(res.status).toBe(400);
    }

    const { facility } = await createFacilityHelper(client, {
      name: "Valid Tallinn Site",
      countryCode: "EE",
      lat: 59.437,
      lng: 24.7536,
    });

    const badPatch = await client.patch(
      `/api/v1/workspace/facilities/${facility.facilityId}`,
      { lat: 95, lng: -185 },
    );
    expect(badPatch.status).toBe(400);
  });

  it("rejects volumeSharePct outside [0, 100], self-loop lanes, and invalid contractEndDate", async () => {
    const app = createTestApp();
    const { client } = await registerOrg(app);

    const { facility: facA } = await createFacilityHelper(client, {
      name: "Supplier A",
      countryCode: "FI",
      lat: 60.17,
      lng: 24.94,
    });
    const { facility: facB } = await createFacilityHelper(client, {
      name: "Tallinn HQ",
      countryCode: "EE",
      lat: 59.43,
      lng: 24.75,
      isOwnFacility: true,
    });

    // volumeSharePct < 0 and > 100
    for (const badShare of [-0.1, -50, 100.1, 250]) {
      const res = await client.post("/api/v1/workspace/lanes", {
        fromFacilityId: facA.facilityId,
        toFacilityId: facB.facilityId,
        materialCategory: "Electronics",
        volumeSharePct: badShare,
      });
      expect(res.status).toBe(400);
    }

    // Self-loop on POST
    const selfLoopPost = await client.post("/api/v1/workspace/lanes", {
      fromFacilityId: facA.facilityId,
      toFacilityId: facA.facilityId,
      materialCategory: "Electronics",
      volumeSharePct: 50,
    });
    expect(selfLoopPost.status).toBe(400);

    // Invalid contractEndDate formats
    for (const badDate of ["not-a-date", "2026-13-45", "30-06-2027", "2027/06/30"]) {
      const res = await client.post("/api/v1/workspace/lanes", {
        fromFacilityId: facA.facilityId,
        toFacilityId: facB.facilityId,
        materialCategory: "Electronics",
        contractEndDate: badDate,
      });
      expect(res.status).toBe(400);
    }

    // Self-loop via PATCH
    const validLane = await createLaneHelper(client, {
      fromFacilityId: facA.facilityId,
      toFacilityId: facB.facilityId,
      materialCategory: "Electronics",
      volumeSharePct: 50,
    });
    const selfLoopPatch = await client.patch(
      `/api/v1/workspace/lanes/${validLane.laneId}`,
      { toFacilityId: facA.facilityId },
    );
    expect(selfLoopPatch.status).toBe(400);
  });

  it("deleting a facility cascades connected lanes cleanly without affecting unrelated lanes", async () => {
    const app = createTestApp();
    const { client } = await registerOrg(app);

    const { facility: f1 } = await createFacilityHelper(client, {
      name: "Supplier 1",
      countryCode: "DE",
      lat: 53.55,
      lng: 9.99,
    });
    const { facility: f2 } = await createFacilityHelper(client, {
      name: "Transit Hub",
      countryCode: "LV",
      lat: 56.95,
      lng: 24.11,
    });
    const { facility: f3 } = await createFacilityHelper(client, {
      name: "Tallinn HQ",
      countryCode: "EE",
      lat: 59.44,
      lng: 24.75,
      isOwnFacility: true,
    });

    const lane12 = await createLaneHelper(client, {
      fromFacilityId: f1.facilityId,
      toFacilityId: f2.facilityId,
      materialCategory: "Polymers",
    });
    const lane23 = await createLaneHelper(client, {
      fromFacilityId: f2.facilityId,
      toFacilityId: f3.facilityId,
      materialCategory: "Polymers",
    });
    const directLane13 = await createLaneHelper(client, {
      fromFacilityId: f1.facilityId,
      toFacilityId: f3.facilityId,
      materialCategory: "Polymers",
    });

    const deleteRes = await client.delete(
      `/api/v1/workspace/facilities/${f2.facilityId}`,
    );
    expect(deleteRes.status).toBe(200);

    const netRes = await client.get("/api/v1/workspace/network");
    const net = WorkspaceNetworkResponseSchema.parse(await netRes.json());

    expect(net.facilities.map((f) => f.facilityId)).not.toContain(f2.facilityId);
    const remainingLaneIds = net.lanes.map((l) => l.laneId);
    expect(remainingLaneIds).not.toContain(lane12.laneId);
    expect(remainingLaneIds).not.toContain(lane23.laneId);
    expect(remainingLaneIds).toContain(directLane13.laneId);
  });

  it("handles malformed JSON with 400 and stores SQL/injection strings safely as literal data", async () => {
    const app = createTestApp();
    const { client } = await registerOrg(app);

    // Malformed JSON
    const malformedRes = await client.rawRequest("/api/v1/workspace/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ invalid json payload",
    });
    expect(malformedRes.status).toBe(400);

    // SQL / script injection strings stored literally without corruption
    const sqlPayload = "'; DROP VERTEX Facility; SELECT * FROM User; --";
    const xssPayload = "<script>alert('kulgo')</script>";

    const product = await createProductHelper(client, {
      name: sqlPayload,
      description: xssPayload,
    });
    expect(product.name).toBe(sqlPayload);
    expect(product.description).toBe(xssPayload);

    const { facility } = await createFacilityHelper(client, {
      name: sqlPayload,
      countryCode: "EE",
      lat: 59.437,
      lng: 24.7536,
      sector: xssPayload,
    });
    expect(facility.name).toBe(sqlPayload);
    expect(facility.sector).toBe(xssPayload);

    // Workspace remains healthy and intact
    const netRes = await client.get("/api/v1/workspace/network");
    expect(netRes.status).toBe(200);
    const net = WorkspaceNetworkResponseSchema.parse(await netRes.json());
    expect(net.products).toHaveLength(1);
    expect(net.facilities).toHaveLength(1);
  });
});

// ============================================================================
// TIER 3 — CROSS-FEATURE COMBINATIONS & MULTI-TENANT PRIVACY
// ============================================================================
describe("Tier 3 — Cross-Feature Combinations & Multi-Tenant Privacy", () => {
  it("strictly isolates two organizations across GET, PATCH, and DELETE", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, {
      organizationName: "Org Alpha EE",
      countryCode: "EE",
    });
    const orgB = await registerOrg(app, {
      organizationName: "Org Beta DE",
      countryCode: "DE",
    });

    // Org A creates a complete slice of data
    const prodA = await createProductHelper(orgA.client, { name: "Alpha Product" });
    const inputA = await createInputHelper(orgA.client, {
      productId: prodA.productId,
      name: "Alpha Material",
      category: "Alloys",
    });
    const { facility: facA1 } = await createFacilityHelper(orgA.client, {
      name: "Alpha Supplier",
      countryCode: "FI",
      lat: 60.17,
      lng: 24.94,
    });
    const { facility: facA2 } = await createFacilityHelper(orgA.client, {
      name: "Alpha HQ",
      countryCode: "EE",
      lat: 59.44,
      lng: 24.75,
      isOwnFacility: true,
    });
    const laneA = await createLaneHelper(orgA.client, {
      fromFacilityId: facA1.facilityId,
      toFacilityId: facA2.facilityId,
      inputId: inputA.inputId,
      materialCategory: "Alloys",
    });

    // Org B sees zero of Org A's entities
    const netBRes = await orgB.client.get("/api/v1/workspace/network");
    expect(netBRes.status).toBe(200);
    const netB = WorkspaceNetworkResponseSchema.parse(await netBRes.json());
    expect(netB.products).toHaveLength(0);
    expect(netB.inputs).toHaveLength(0);
    expect(netB.facilities).toHaveLength(0);
    expect(netB.lanes).toHaveLength(0);

    // Org B cannot PATCH or DELETE any of Org A's entities -> 404
    expect(
      (
        await orgB.client.patch(`/api/v1/workspace/products/${prodA.productId}`, {
          name: "Hijacked",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await orgB.client.delete(`/api/v1/workspace/products/${prodA.productId}`)
      ).status,
    ).toBe(404);

    expect(
      (
        await orgB.client.patch(`/api/v1/workspace/inputs/${inputA.inputId}`, {
          name: "Hijacked",
        })
      ).status,
    ).toBe(404);
    expect(
      (await orgB.client.delete(`/api/v1/workspace/inputs/${inputA.inputId}`))
        .status,
    ).toBe(404);

    expect(
      (
        await orgB.client.patch(
          `/api/v1/workspace/facilities/${facA1.facilityId}`,
          { name: "Hijacked" },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await orgB.client.delete(
          `/api/v1/workspace/facilities/${facA1.facilityId}`,
        )
      ).status,
    ).toBe(404);

    expect(
      (
        await orgB.client.patch(`/api/v1/workspace/lanes/${laneA.laneId}`, {
          riskStatus: "RED",
        })
      ).status,
    ).toBe(404);
    expect(
      (await orgB.client.delete(`/api/v1/workspace/lanes/${laneA.laneId}`)).status,
    ).toBe(404);

    // Org A's data remains completely untouched
    const netARes = await orgA.client.get("/api/v1/workspace/network");
    const netA = WorkspaceNetworkResponseSchema.parse(await netARes.json());
    expect(netA.products).toHaveLength(1);
    expect(netA.products[0]?.name).toBe("Alpha Product");
    expect(netA.lanes).toHaveLength(1);
    expect(netA.lanes[0]?.riskStatus).toBe("GREEN");
  });

  it("rejects cross-org references (fromFacilityId, toFacilityId, productId, inputId) and ignores spoofed ownerOrgId", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, { organizationName: "Org A" });
    const orgB = await registerOrg(app, { organizationName: "Org B" });

    const prodA = await createProductHelper(orgA.client, { name: "Org A Product" });
    const inputA = await createInputHelper(orgA.client, {
      productId: prodA.productId,
      name: "Org A Input",
      category: "Chemicals",
    });
    const { facility: facA } = await createFacilityHelper(orgA.client, {
      name: "Org A Plant",
      countryCode: "EE",
      lat: 59.44,
      lng: 24.75,
    });

    const { facility: facB1 } = await createFacilityHelper(orgB.client, {
      name: "Org B Plant 1",
      countryCode: "DE",
      lat: 52.52,
      lng: 13.4,
    });
    const { facility: facB2 } = await createFacilityHelper(orgB.client, {
      name: "Org B Plant 2",
      countryCode: "DE",
      lat: 48.14,
      lng: 11.58,
    });

    // Cross-org productId on SupplyInput create
    const crossInputRes = await orgB.client.post("/api/v1/workspace/inputs", {
      productId: prodA.productId,
      name: "Cross-Org Material",
      category: "Chemicals",
    });
    expect([400, 404]).toContain(crossInputRes.status);

    // Cross-org fromFacilityId on SupplyLane create
    const crossFromRes = await orgB.client.post("/api/v1/workspace/lanes", {
      fromFacilityId: facA.facilityId,
      toFacilityId: facB1.facilityId,
      materialCategory: "Chemicals",
    });
    expect([400, 404]).toContain(crossFromRes.status);

    // Cross-org toFacilityId on SupplyLane create
    const crossToRes = await orgB.client.post("/api/v1/workspace/lanes", {
      fromFacilityId: facB1.facilityId,
      toFacilityId: facA.facilityId,
      materialCategory: "Chemicals",
    });
    expect([400, 404]).toContain(crossToRes.status);

    // Cross-org inputId on SupplyLane create
    const crossLaneInputRes = await orgB.client.post("/api/v1/workspace/lanes", {
      fromFacilityId: facB1.facilityId,
      toFacilityId: facB2.facilityId,
      inputId: inputA.inputId,
      materialCategory: "Chemicals",
    });
    expect([400, 404]).toContain(crossLaneInputRes.status);

    // Client-supplied spoofed ownerOrgId is ignored on all create endpoints
    const spoofProductRes = await orgB.client.post("/api/v1/workspace/products", {
      name: "Spoof Attempt Product",
      ownerOrgId: orgA.organization.orgId,
    });
    expect(spoofProductRes.status).toBe(201);
    const spoofProduct = ProductSchema.parse(
      ((await spoofProductRes.json()) as { product: unknown }).product,
    );
    expect(spoofProduct.ownerOrgId).toBe(orgB.organization.orgId);

    const spoofFacRes = await orgB.client.post("/api/v1/workspace/facilities", {
      name: "Spoof Attempt Facility",
      countryCode: "DE",
      lat: 50.11,
      lng: 8.68,
      ownerOrgId: orgA.organization.orgId,
    });
    expect(spoofFacRes.status).toBe(201);
    const spoofFac = FacilitySchema.parse(
      ((await spoofFacRes.json()) as { facility: unknown }).facility,
    );
    expect(spoofFac.ownerOrgId).toBe(orgB.organization.orgId);

    // Org A never sees Org B's spoofed records
    const orgANet = WorkspaceNetworkResponseSchema.parse(
      await (await orgA.client.get("/api/v1/workspace/network")).json(),
    );
    expect(
      orgANet.products.some((p) => p.productId === spoofProduct.productId),
    ).toBe(false);
    expect(
      orgANet.facilities.some((f) => f.facilityId === spoofFac.facilityId),
    ).toBe(false);
  });

  it("refining a facility coordinate updates WKT and preserves connected lanes", async () => {
    const app = createTestApp();
    const { client } = await registerOrg(app);

    const { facility: supplier } = await createFacilityHelper(client, {
      name: "Shanghai Office (HQ)",
      kind: "HQ",
      locationPrecision: "HQ_ESTIMATED",
      countryCode: "CN",
      lat: 31.2304,
      lng: 121.4737,
    });
    const { facility: hq } = await createFacilityHelper(client, {
      name: "Tallinn Assembly HQ",
      kind: "HQ",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "EE",
      lat: 59.437,
      lng: 24.7536,
      isOwnFacility: true,
    });

    const lane = await createLaneHelper(client, {
      fromFacilityId: supplier.facilityId,
      toFacilityId: hq.facilityId,
      materialCategory: "Battery Cells",
      transportMode: "SEA",
      volumeSharePct: 70,
      annualSpendEur: 520000,
      riskStatus: "YELLOW",
      riskReason: "Red Sea maritime transit delay",
    });

    // Refine supplier HQ -> actual Shenzhen factory site
    const factoryLat = 22.5431;
    const factoryLng = 114.0579;
    const patchRes = await client.patch(
      `/api/v1/workspace/facilities/${supplier.facilityId}`,
      {
        name: "Shenzhen Cell Factory",
        kind: "FACTORY",
        locationPrecision: "SITE_VERIFIED",
        lat: factoryLat,
        lng: factoryLng,
      },
    );
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as {
      facility: Record<string, unknown>;
    };
    assertWktIfPresent(patchBody.facility, factoryLng, factoryLat);
    const refined = FacilitySchema.parse(patchBody.facility);
    expect(refined.locationPrecision).toBe("SITE_VERIFIED");

    // Verify lane is preserved intact
    const netRes = await client.get("/api/v1/workspace/network");
    const net = WorkspaceNetworkResponseSchema.parse(await netRes.json());
    const preservedLane = net.lanes.find((l) => l.laneId === lane.laneId);
    expect(preservedLane).toBeDefined();
    expect(preservedLane?.fromFacilityId).toBe(supplier.facilityId);
    expect(preservedLane?.toFacilityId).toBe(hq.facilityId);
    expect(preservedLane?.annualSpendEur).toBe(520000);
    expect(preservedLane?.riskStatus).toBe("YELLOW");
  });

  it("filters workspace network by productId and inputId accurately", async () => {
    const app = createTestApp();
    const { client } = await registerOrg(app);

    const prod1 = await createProductHelper(client, { name: "Inverter Alpha" });
    const prod2 = await createProductHelper(client, { name: "Battery Pack Beta" });

    const input1 = await createInputHelper(client, {
      productId: prod1.productId,
      name: "IGBT Modules",
      category: "Semiconductors",
    });
    const input2 = await createInputHelper(client, {
      productId: prod2.productId,
      name: "Lithium Carbonate",
      category: "Chemicals",
    });

    const { facility: sup1 } = await createFacilityHelper(client, {
      name: "Munich Semi Plant",
      countryCode: "DE",
      lat: 48.1351,
      lng: 11.582,
    });
    const { facility: sup2 } = await createFacilityHelper(client, {
      name: "Oulu Chem Plant",
      countryCode: "FI",
      lat: 65.0121,
      lng: 25.4651,
    });
    const { facility: hq } = await createFacilityHelper(client, {
      name: "Tallinn HQ",
      countryCode: "EE",
      lat: 59.437,
      lng: 24.7536,
      isOwnFacility: true,
    });

    const lane1 = await createLaneHelper(client, {
      fromFacilityId: sup1.facilityId,
      toFacilityId: hq.facilityId,
      inputId: input1.inputId,
      materialCategory: "Semiconductors",
    });
    const lane2 = await createLaneHelper(client, {
      fromFacilityId: sup2.facilityId,
      toFacilityId: hq.facilityId,
      inputId: input2.inputId,
      materialCategory: "Chemicals",
    });

    // Filter by productId = prod1
    const byProdRes = await client.get(
      `/api/v1/workspace/network?productId=${prod1.productId}`,
    );
    expect(byProdRes.status).toBe(200);
    const byProd = WorkspaceNetworkResponseSchema.parse(await byProdRes.json());
    expect(byProd.lanes.map((l) => l.laneId)).toEqual([lane1.laneId]);
    expect(byProd.inputs.map((i) => i.inputId)).toEqual([input1.inputId]);
    expect(byProd.lanes.map((l) => l.laneId)).not.toContain(lane2.laneId);

    // Filter by inputId = input2
    const byInputRes = await client.get(
      `/api/v1/workspace/network?inputId=${input2.inputId}`,
    );
    expect(byInputRes.status).toBe(200);
    const byInput = WorkspaceNetworkResponseSchema.parse(await byInputRes.json());
    expect(byInput.lanes.map((l) => l.laneId)).toEqual([lane2.laneId]);
    expect(byInput.lanes.map((l) => l.laneId)).not.toContain(lane1.laneId);
  });

  it("POST /api/v1/workspace/seed-demo is idempotent when called twice for the same org", async () => {
    const app = createTestApp();
    const { client } = await registerOrg(app);

    const firstRes = await client.post("/api/v1/workspace/seed-demo");
    expect(firstRes.status).toBe(201);
    const first = WorkspaceNetworkResponseSchema.parse(await firstRes.json());

    const secondRes = await client.post("/api/v1/workspace/seed-demo");
    expect([200, 201]).toContain(secondRes.status);
    const second = WorkspaceNetworkResponseSchema.parse(await secondRes.json());

    expect(second.products.length).toBe(first.products.length);
    expect(second.inputs.length).toBe(first.inputs.length);
    expect(second.facilities.length).toBe(first.facilities.length);
    expect(second.lanes.length).toBe(first.lanes.length);

    expect(second.products.map((p) => p.productId).sort()).toEqual(
      first.products.map((p) => p.productId).sort(),
    );
    expect(second.facilities.map((f) => f.facilityId).sort()).toEqual(
      first.facilities.map((f) => f.facilityId).sort(),
    );
    expect(second.lanes.map((l) => l.laneId).sort()).toEqual(
      first.lanes.map((l) => l.laneId).sort(),
    );
  });
});

// ============================================================================
// TIER 4 — REAL-WORLD APPLICATION SCENARIOS
// ============================================================================
describe("Tier 4 — Real-World Application Scenarios", () => {
  it("Scenario 1: Full Estonia 'Product X' Onboarding & Risk Audit Journey", async () => {
    const app = createTestApp();

    // 1. Register an Estonian manufacturer
    const { client } = await registerOrg(app, {
      organizationName: "Nordic Grid Electronics OÜ",
      countryCode: "EE",
      sector: "Power Electronics",
    });

    // 2. 1-click Demo Seed
    const seedRes = await client.post("/api/v1/workspace/seed-demo");
    expect(seedRes.status).toBe(201);
    const seeded = WorkspaceNetworkResponseSchema.parse(await seedRes.json());

    // 3. Verify Tallinn HQ, EE/LV/FI/DE/CN suppliers, Materials A-F, Yellow CN & Red LV risks
    const tallinnHq = seeded.facilities.find(
      (f) => f.countryCode === "EE" && f.isOwnFacility,
    );
    expect(tallinnHq).toBeDefined();
    if (!tallinnHq) throw new Error("Expected Tallinn HQ in seeded workspace");

    expect(seeded.inputs.length).toBeGreaterThanOrEqual(6);
    const facilityById = new Map(
      seeded.facilities.map((f) => [f.facilityId, f]),
    );
    const yellowChinaLane = seeded.lanes.find(
      (l) =>
        facilityById.get(l.fromFacilityId)?.countryCode === "CN" &&
        l.riskStatus === "YELLOW",
    );
    const redLatviaLane = seeded.lanes.find(
      (l) =>
        facilityById.get(l.fromFacilityId)?.countryCode === "LV" &&
        l.riskStatus === "RED",
    );
    expect(yellowChinaLane).toBeDefined();
    expect(redLatviaLane).toBeDefined();

    // 4. Filter network by the material supplied on the Red Latvian lane
    const auditedInputId = redLatviaLane?.inputId ?? seeded.inputs[0]?.inputId;
    expect(auditedInputId).toBeTruthy();
    const filteredRes = await client.get(
      `/api/v1/workspace/network?inputId=${auditedInputId}`,
    );
    expect(filteredRes.status).toBe(200);
    const filtered = WorkspaceNetworkResponseSchema.parse(
      await filteredRes.json(),
    );
    expect(filtered.lanes.length).toBeGreaterThanOrEqual(1);
    for (const lane of filtered.lanes) {
      expect(lane.inputId).toBe(auditedInputId);
    }

    // 5. Refine an HQ_ESTIMATED supplier (LV or CN) to SITE_VERIFIED
    const estimatedSupplier =
      seeded.facilities.find(
        (f) =>
          f.locationPrecision === "HQ_ESTIMATED" &&
          (f.countryCode === "LV" || f.countryCode === "CN"),
      ) ?? seeded.facilities.find((f) => !f.isOwnFacility);
    expect(estimatedSupplier).toBeDefined();
    if (!estimatedSupplier) throw new Error("Expected supplier facility");

    const verifiedLat = Number((estimatedSupplier.lat + 0.08).toFixed(4));
    const verifiedLng = Number((estimatedSupplier.lng + 0.08).toFixed(4));
    const refineRes = await client.patch(
      `/api/v1/workspace/facilities/${estimatedSupplier.facilityId}`,
      {
        locationPrecision: "SITE_VERIFIED",
        lat: verifiedLat,
        lng: verifiedLng,
      },
    );
    expect(refineRes.status).toBe(200);
    const refineBody = (await refineRes.json()) as {
      facility: Record<string, unknown>;
    };
    assertWktIfPresent(refineBody.facility, verifiedLng, verifiedLat);
    const refinedFac = FacilitySchema.parse(refineBody.facility);
    expect(refinedFac.locationPrecision).toBe("SITE_VERIFIED");

    // 6. Onboard a backup Finnish supplier & GREEN mitigation lane to Tallinn HQ
    const { facility: finnishBackup } = await createFacilityHelper(client, {
      name: "Tampere Precision Alloys Oy",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "FI",
      lat: 61.4978,
      lng: 23.761,
      sector: "Metallurgy",
      esgBadges: ["ISO-14001", "EU-CSRD-READY"],
    });

    const backupLane = await createLaneHelper(client, {
      fromFacilityId: finnishBackup.facilityId,
      toFacilityId: tallinnHq.facilityId,
      inputId: auditedInputId ?? null,
      materialCategory: redLatviaLane?.materialCategory ?? "Specialty Alloys",
      transportMode: "SEA",
      volumeSharePct: 40,
      annualVolume: 120,
      volumeUnit: "TONNES",
      annualSpendEur: 145000,
      contractEndDate: "2028-12-31",
      riskStatus: "GREEN",
      riskReason: "Backup Nordic supplier mitigating LV sanctions exposure",
    });

    // Verify full workspace reflects both refinement and backup corridor
    const finalNet = WorkspaceNetworkResponseSchema.parse(
      await (await client.get("/api/v1/workspace/network")).json(),
    );
    expect(
      finalNet.facilities.some((f) => f.facilityId === finnishBackup.facilityId),
    ).toBe(true);
    expect(finalNet.lanes.some((l) => l.laneId === backupLane.laneId)).toBe(true);

    // 7. Logout & verify server-side session revocation
    const capturedCookie = client.getCookieHeader();
    expect(capturedCookie).toBeTruthy();

    const logoutRes = await client.post("/api/v1/auth/logout");
    expect(logoutRes.status).toBe(200);

    const revokedRes = await client.rawRequest("/api/v1/workspace/network", {
      method: "GET",
      headers: { cookie: capturedCookie! },
    });
    expect(revokedRes.status).toBe(401);
  });

  it("Scenario 2: Multi-Supplier Volume Split Rebalancing & Contract Renewal Journey", async () => {
    const app = createTestApp();
    const { client } = await registerOrg(app, {
      organizationName: "Tartu Robotics OÜ",
      countryCode: "EE",
    });

    const product = await createProductHelper(client, {
      name: "Autonomous Pallet Mover",
      sku: "APM-400",
    });
    const material = await createInputHelper(client, {
      productId: product.productId,
      name: "Brushless Drive Motors",
      category: "Electromechanical",
      unit: "UNITS",
    });

    const { facility: hq } = await createFacilityHelper(client, {
      name: "Tartu Assembly Plant",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "EE",
      lat: 58.378,
      lng: 26.729,
      isOwnFacility: true,
    });
    const { facility: supPrimary } = await createFacilityHelper(client, {
      name: "Stuttgart Drive GmbH",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "DE",
      lat: 48.7758,
      lng: 9.1829,
    });
    const { facility: supSecondary } = await createFacilityHelper(client, {
      name: "Vaasa Motors Oy",
      kind: "FACTORY",
      locationPrecision: "SITE_VERIFIED",
      countryCode: "FI",
      lat: 63.0951,
      lng: 21.6165,
    });

    // Initial 80/20 split with expiring primary contract
    const lanePrimary = await createLaneHelper(client, {
      fromFacilityId: supPrimary.facilityId,
      toFacilityId: hq.facilityId,
      inputId: material.inputId,
      materialCategory: "Electromechanical",
      transportMode: "ROAD",
      volumeSharePct: 80,
      annualVolume: 800,
      volumeUnit: "UNITS",
      annualSpendEur: 400000,
      contractEndDate: "2026-12-31",
      riskStatus: "YELLOW",
      riskReason: "High single-supplier concentration (80%) & expiring contract",
    });
    const laneSecondary = await createLaneHelper(client, {
      fromFacilityId: supSecondary.facilityId,
      toFacilityId: hq.facilityId,
      inputId: material.inputId,
      materialCategory: "Electromechanical",
      transportMode: "MULTIMODAL",
      volumeSharePct: 20,
      annualVolume: 200,
      volumeUnit: "UNITS",
      annualSpendEur: 100000,
      contractEndDate: "2027-06-30",
      riskStatus: "GREEN",
    });

    // Rebalance to 50/50 and renew both contracts through 2028
    const patchPrimary = await client.patch(
      `/api/v1/workspace/lanes/${lanePrimary.laneId}`,
      {
        volumeSharePct: 50,
        annualVolume: 500,
        annualSpendEur: 250000,
        contractEndDate: "2028-12-31",
        riskStatus: "GREEN",
        riskReason: "Rebalanced 50/50 dual-source contract renewed",
      },
    );
    expect(patchPrimary.status).toBe(200);

    const patchSecondary = await client.patch(
      `/api/v1/workspace/lanes/${laneSecondary.laneId}`,
      {
        volumeSharePct: 50,
        annualVolume: 500,
        annualSpendEur: 250000,
        contractEndDate: "2028-12-31",
        riskStatus: "GREEN",
      },
    );
    expect(patchSecondary.status).toBe(200);

    // Verify rebalanced totals in network
    const netRes = await client.get(
      `/api/v1/workspace/network?inputId=${material.inputId}`,
    );
    const net = WorkspaceNetworkResponseSchema.parse(await netRes.json());
    expect(net.lanes).toHaveLength(2);
    const totalShare = net.lanes.reduce((acc, l) => acc + l.volumeSharePct, 0);
    const totalSpend = net.lanes.reduce(
      (acc, l) => acc + (l.annualSpendEur ?? 0),
      0,
    );
    expect(totalShare).toBe(100);
    expect(totalSpend).toBe(500000);
    for (const lane of net.lanes) {
      expect(lane.contractEndDate).toBe("2028-12-31");
      expect(lane.riskStatus).toBe("GREEN");
    }
  });

  it("Scenario 3: Multi-Tenant SaaS Isolation under Concurrent Org Workflows (EE electronics vs DE automotive)", async () => {
    const app = createTestApp();

    const [orgEE, orgDE] = await Promise.all([
      registerOrg(app, {
        organizationName: "Tallinn Microelectronics OÜ",
        countryCode: "EE",
        sector: "Electronics",
      }),
      registerOrg(app, {
        organizationName: "Bavaria Mobility AG",
        countryCode: "DE",
        sector: "Automotive",
      }),
    ]);

    // Interleaved concurrent workflows
    const [seedEERes, prodDE, facDE1, facDE2] = await Promise.all([
      orgEE.client.post("/api/v1/workspace/seed-demo"),
      createProductHelper(orgDE.client, {
        name: "EV Traction Axle",
        sku: "BAV-AX-90",
      }),
      createFacilityHelper(orgDE.client, {
        name: "Munich Final Assembly",
        kind: "FACTORY",
        locationPrecision: "SITE_VERIFIED",
        countryCode: "DE",
        lat: 48.1351,
        lng: 11.582,
        isOwnFacility: true,
      }),
      createFacilityHelper(orgDE.client, {
        name: "Graz Foundry GmbH",
        kind: "FACTORY",
        locationPrecision: "SITE_VERIFIED",
        countryCode: "AT",
        lat: 47.0707,
        lng: 15.4395,
      }),
    ]);

    expect(seedEERes.status).toBe(201);
    const inputDE = await createInputHelper(orgDE.client, {
      productId: prodDE.productId,
      name: "Cast Aluminum Housings",
      category: "Castings",
      unit: "TONNES",
    });
    const laneDE = await createLaneHelper(orgDE.client, {
      fromFacilityId: facDE2.facility.facilityId,
      toFacilityId: facDE1.facility.facilityId,
      inputId: inputDE.inputId,
      materialCategory: "Castings",
      transportMode: "RAIL",
      volumeSharePct: 100,
      annualSpendEur: 920000,
      riskStatus: "GREEN",
    });

    // Fetch both networks concurrently and verify zero cross-tenant leakage
    const [netEERes, netDERes] = await Promise.all([
      orgEE.client.get("/api/v1/workspace/network"),
      orgDE.client.get("/api/v1/workspace/network"),
    ]);
    const netEE = WorkspaceNetworkResponseSchema.parse(await netEERes.json());
    const netDE = WorkspaceNetworkResponseSchema.parse(await netDERes.json());

    expect(netDE.products.map((p) => p.productId)).toEqual([prodDE.productId]);
    expect(netDE.facilities).toHaveLength(2);
    expect(netDE.lanes.map((l) => l.laneId)).toEqual([laneDE.laneId]);

    expect(netEE.products.some((p) => p.productId === prodDE.productId)).toBe(
      false,
    );
    expect(netEE.lanes.some((l) => l.laneId === laneDE.laneId)).toBe(false);

    for (const f of netEE.facilities) {
      expect(f.ownerOrgId).toBe(orgEE.organization.orgId);
    }
    for (const f of netDE.facilities) {
      expect(f.ownerOrgId).toBe(orgDE.organization.orgId);
    }
  });

  it("Scenario 4: Facility Decommissioning & Network Consistency Journey", async () => {
    const app = createTestApp();
    const { client } = await registerOrg(app);

    const { facility: supplierA } = await createFacilityHelper(client, {
      name: "Gdansk Component Plant",
      kind: "FACTORY",
      countryCode: "PL",
      lat: 54.352,
      lng: 18.6466,
    });
    const { facility: hubB } = await createFacilityHelper(client, {
      name: "Riga Consolidation Hub",
      kind: "HUB",
      countryCode: "LV",
      lat: 56.9496,
      lng: 24.1052,
    });
    const { facility: hqC } = await createFacilityHelper(client, {
      name: "Tallinn HQ",
      kind: "HQ",
      countryCode: "EE",
      lat: 59.437,
      lng: 24.7536,
      isOwnFacility: true,
    });

    const laneAB = await createLaneHelper(client, {
      fromFacilityId: supplierA.facilityId,
      toFacilityId: hubB.facilityId,
      materialCategory: "Enclosures",
      volumeSharePct: 60,
    });
    const laneBC = await createLaneHelper(client, {
      fromFacilityId: hubB.facilityId,
      toFacilityId: hqC.facilityId,
      materialCategory: "Enclosures",
      volumeSharePct: 60,
    });
    const laneAC = await createLaneHelper(client, {
      fromFacilityId: supplierA.facilityId,
      toFacilityId: hqC.facilityId,
      materialCategory: "Enclosures",
      volumeSharePct: 40,
    });

    // Decommission Hub B
    const deleteRes = await client.delete(
      `/api/v1/workspace/facilities/${hubB.facilityId}`,
    );
    expect(deleteRes.status).toBe(200);

    // Increase direct lane to 100%
    const promoteRes = await client.patch(
      `/api/v1/workspace/lanes/${laneAC.laneId}`,
      { volumeSharePct: 100 },
    );
    expect(promoteRes.status).toBe(200);

    // Assert full graph consistency: zero dangling facility IDs
    const net = WorkspaceNetworkResponseSchema.parse(
      await (await client.get("/api/v1/workspace/network")).json(),
    );
    const facilityIds = new Set(net.facilities.map((f) => f.facilityId));
    expect(facilityIds.has(hubB.facilityId)).toBe(false);
    expect(net.lanes.map((l) => l.laneId)).toEqual([laneAC.laneId]);
    expect(net.lanes.map((l) => l.laneId)).not.toContain(laneAB.laneId);
    expect(net.lanes.map((l) => l.laneId)).not.toContain(laneBC.laneId);
    for (const lane of net.lanes) {
      expect(facilityIds.has(lane.fromFacilityId)).toBe(true);
      expect(facilityIds.has(lane.toFacilityId)).toBe(true);
    }
  });

  it("Scenario 5: Auth Lifecycle & Security Hygiene Journey", async () => {
    const app = createTestApp();

    // 1. Register -> verify cookie security attributes and zero passwordHash exposure
    const { client, user, email, password, setCookies } = await registerOrg(app, {
      organizationName: "Security Audit OÜ",
      countryCode: "EE",
    });

    const cookieHeader = setCookies.find((c) =>
      c.toLowerCase().startsWith("kulgo_session="),
    );
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader?.toLowerCase()).toContain("httponly");
    expect(cookieHeader?.toLowerCase()).toContain("samesite=lax");
    expect(cookieHeader?.toLowerCase()).toContain("path=/");

    const preLogoutCookie = client.getCookieHeader();
    expect(preLogoutCookie).toBeTruthy();

    // 2. Logout -> clears cookie and invalidates session server-side
    const logoutRes = await client.post("/api/v1/auth/logout");
    expect(logoutRes.status).toBe(200);
    expect(client.getCookie("kulgo_session")).toBeUndefined();

    // Replay pre-logout cookie -> must be rejected with 401
    const replayMe = await client.rawRequest("/api/v1/auth/me", {
      method: "GET",
      headers: { cookie: preLogoutCookie! },
    });
    expect(replayMe.status).toBe(401);

    const replayNet = await client.rawRequest("/api/v1/workspace/network", {
      method: "GET",
      headers: { cookie: preLogoutCookie! },
    });
    expect(replayNet.status).toBe(401);

    // 3. Wrong password -> 401 and no session cookie granted
    const failedLogin = await client.post("/api/v1/auth/login", {
      email,
      password: "DefinitelyWrongPassword!999",
    });
    expect(failedLogin.status).toBe(401);
    expect(client.getCookie("kulgo_session")).toBeUndefined();

    // 4. Re-login with correct password -> fresh valid session
    const reloginRes = await client.post("/api/v1/auth/login", {
      email,
      password,
    });
    expect(reloginRes.status).toBe(200);
    const reloginRaw = (await reloginRes.json()) as unknown;
    assertNoPasswordLeak(reloginRaw, password);
    const relogin = AuthMeResponseSchema.parse(reloginRaw);
    expect(relogin.user.userId).toBe(user.userId);
    expect(client.getCookie("kulgo_session")).toBeTruthy();

    // Authenticated workspace access works again
    const netRes = await client.get("/api/v1/workspace/network");
    expect(netRes.status).toBe(200);
  });
});

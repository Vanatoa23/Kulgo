import {
  BulkCatalogueImportResultSchema,
  FacilityAlternativesResponseSchema,
  IntroRequestResponseSchema,
  ListCatalogueItemsResponseSchema,
  TaxonomyResponseSchema,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../src/app.js";
import { InMemoryCaptureEmailProvider } from "../src/intelligence/notifications.js";
import { buildXlsxBuffer, parseXlsxBuffer } from "../src/workspace/xlsx.js";

function extractCookie(res: Response): string {
  const raw = res.headers.get("set-cookie");
  if (!raw) throw new Error("Missing Set-Cookie header");
  return raw.split(";")[0]!;
}

async function registerOrg(
  app: ReturnType<typeof createTestApp>,
  params: {
    email: string;
    organizationName: string;
    countryCode?: string;
    sector?: string;
  },
) {
  const res = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: params.email,
      password: "SuperSecurePassword123!",
      organizationName: params.organizationName,
      countryCode: params.countryCode ?? "EE",
      sector: params.sector ?? "Manufacturing",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { organization: { orgId: string } };
  return { cookie: extractCookie(res), orgId: body.organization.orgId };
}

describe("Sub-Project 5 — Product Catalogue, XLSX Onboarding, Alternatives & Outreach", () => {
  it("round-trips pure-TS XLSX generation and parsing cleanly", () => {
    const rows = [
      ["supplier_name", "country_code", "material_category", "annual_volume"],
      ["Nordic & Co <OÜ>", "EE", "Aluminum Extrusions", "450"],
      ["Suomi Metals Oy", "FI", "PCB Assembly", "12000"],
    ];
    const buf = buildXlsxBuffer("Suppliers", rows);
    const parsed = parseXlsxBuffer(buf);
    expect(parsed).toEqual(rows);
  });

  it("supports Product Catalogue CRUD, XLSX import, taxonomy, facility alternatives & request-intro", async () => {
    const emailCapture = new InMemoryCaptureEmailProvider();
    const app = createTestApp({}, { emailProvider: emailCapture });

    // 1. Register Supplier A (opts in + publishes Product Catalogue)
    const supplierA = await registerOrg(app, {
      email: "owner@baltic-extrusions.example",
      organizationName: "Baltic Extrusions OÜ",
      countryCode: "EE",
      sector: "Metals",
    });

    const optInRes = await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: supplierA.cookie,
      },
      body: JSON.stringify({
        openToNewBuyers: true,
        esgBadges: ["ISO 14001", "RE100"],
        capabilities: ["Aluminum Extrusions"],
      }),
    });
    expect(optInRes.status).toBe(200);

    // Check taxonomy endpoint
    const taxRes = await app.request("/api/v1/directory/taxonomy", {
      headers: { Cookie: supplierA.cookie },
    });
    expect(taxRes.status).toBe(200);
    const taxonomy = TaxonomyResponseSchema.parse(await taxRes.json());
    expect(taxonomy.categories).toHaveLength(20);

    // Create catalogue item
    const createItemRes = await app.request("/api/v1/directory/catalogue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: supplierA.cookie,
      },
      body: JSON.stringify({
        standardizedCategory: "ALUMINUM_EXTRUSIONS",
        productTitle: "EN AW-6061 Recycled Extrusion",
        baseUnit: "TONNES",
        productEmissionFactorTco2ePerUnit: 3.8,
        pcfVerified: true,
        specs: ["80% Recycled", "Anodized"],
        leadTimeDays: 10,
        moq: 5,
        capacityBand: "LARGE",
        certifications: ["ASI Performance"],
      }),
    });
    expect(createItemRes.status).toBe(201);
    const createdItem = (await createItemRes.json()) as {
      item: { itemId: string };
    };

    // Update catalogue item
    const patchRes = await app.request(
      `/api/v1/directory/catalogue/${createdItem.item.itemId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: supplierA.cookie,
        },
        body: JSON.stringify({ leadTimeDays: 12 }),
      },
    );
    expect(patchRes.status).toBe(200);

    // Download & re-import catalogue XLSX template
    const tmplRes = await app.request(
      "/api/v1/directory/catalogue/template.xlsx",
      {
        headers: { Cookie: supplierA.cookie },
      },
    );
    expect(tmplRes.status).toBe(200);
    const tmplBuf = Buffer.from(await tmplRes.arrayBuffer());

    const importCatRes = await app.request("/api/v1/directory/catalogue/import", {
      method: "POST",
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Cookie: supplierA.cookie,
      },
      body: tmplBuf,
    });
    expect(importCatRes.status).toBe(200);
    const importCat = BulkCatalogueImportResultSchema.parse(
      await importCatRes.json(),
    );
    expect(importCat.createdCount).toBe(2);
    expect(importCat.errors).toHaveLength(0);

    const listCatRes = await app.request("/api/v1/directory/catalogue", {
      headers: { Cookie: supplierA.cookie },
    });
    expect(listCatRes.status).toBe(200);
    const listedCat = ListCatalogueItemsResponseSchema.parse(
      await listCatRes.json(),
    );
    expect(listedCat.items).toHaveLength(3);

    // 2. Register Supplier B (NOT opted in — must NOT appear in alternatives)
    const supplierB = await registerOrg(app, {
      email: "owner@private-metals.example",
      organizationName: "Private Metals Ltd",
      countryCode: "DE",
    });
    await app.request("/api/v1/directory/catalogue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: supplierB.cookie,
      },
      body: JSON.stringify({
        standardizedCategory: "ALUMINUM_EXTRUSIONS",
        productTitle: "Hidden Extrusion",
      }),
    });

    // 3. Register Buyer Org with an own HQ + a supplier facility + lane for Aluminum Extrusions
    const buyer = await registerOrg(app, {
      email: "buyer@tallinn-mfg.example",
      organizationName: "Tallinn Precision Mfg OÜ",
      countryCode: "EE",
    });

    const ownRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
      body: JSON.stringify({
        name: "Tallinn Main Plant",
        kind: "HQ",
        countryCode: "EE",
        lat: 59.437,
        lng: 24.7536,
        isOwnFacility: true,
        relationshipRole: "OWN",
      }),
    });
    expect(ownRes.status).toBe(201);
    const ownFac = (await ownRes.json()) as { facility: { facilityId: string } };

    const supRes = await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
      body: JSON.stringify({
        name: "Far East Alu Corp",
        kind: "FACTORY",
        countryCode: "CN",
        lat: 31.2304,
        lng: 121.4737,
        isOwnFacility: false,
        relationshipRole: "SUPPLIER",
        sector: "Metals",
      }),
    });
    expect(supRes.status).toBe(201);
    const supFac = (await supRes.json()) as { facility: { facilityId: string } };

    const laneRes = await app.request("/api/v1/workspace/lanes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
      body: JSON.stringify({
        fromFacilityId: supFac.facility.facilityId,
        toFacilityId: ownFac.facility.facilityId,
        materialCategory: "Aluminum Extrusions",
        transportMode: "SEA",
        volumeSharePct: 100,
        annualVolume: 500,
        volumeUnit: "TONNES",
      }),
    });
    expect(laneRes.status).toBe(201);

    // 4. Query "See alternatives (x)" for the buyer's supplier facility
    const altRes = await app.request(
      `/api/v1/directory/alternatives/for-facility/${supFac.facility.facilityId}`,
      { headers: { Cookie: buyer.cookie } },
    );
    expect(altRes.status).toBe(200);
    const altData = FacilityAlternativesResponseSchema.parse(
      await altRes.json(),
    );

    expect(altData.count).toBeGreaterThanOrEqual(1);
    expect(altData.standardizedCategories).toContain("ALUMINUM_EXTRUSIONS");
    // Opted-in Supplier A MUST be top-ranked with matched catalogue items
    expect(altData.alternatives[0]?.orgId).toBe(supplierA.orgId);
    expect(altData.alternatives[0]?.matchedCatalogueItems.length).toBeGreaterThan(0);
    expect(altData.alternatives[0]?.distanceDeltaKm).toBeLessThan(0); // EE is much closer than CN
    expect(altData.alternatives[0]?.estimatedTransportCo2eDeltaT).toBeLessThan(0);

    // Non-opted-in Supplier B MUST NOT appear
    expect(
      altData.alternatives.some((a) => a.orgId === supplierB.orgId),
    ).toBe(false);

    // 5. 1-Click Request Intro / Quote
    const introRes = await app.request("/api/v1/directory/request-intro", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
      body: JSON.stringify({
        targetOrgId: supplierA.orgId,
        materialCategory: "Aluminum Extrusions",
        volumeBand: "250-500 tonnes/year",
        unit: "TONNES",
        note: "Looking for EU dual-sourcing starting Q2.",
      }),
    });
    expect(introRes.status).toBe(201);
    const intro = IntroRequestResponseSchema.parse(await introRes.json());
    expect(intro.status).toBe("SENT");
    expect(intro.targetOrgName).toBe("Baltic Extrusions OÜ");

    // Verify captured email contains requested material/volume but NEVER existing supplier name
    expect(emailCapture.sent).toHaveLength(1);
    expect(emailCapture.sent[0]!.to).toEqual(["owner@baltic-extrusions.example"]);
    expect(emailCapture.sent[0]!.text).toContain("Aluminum Extrusions");
    expect(emailCapture.sent[0]!.text).toContain("250-500 tonnes/year");
    expect(emailCapture.sent[0]!.text).not.toContain("Far East Alu Corp");

    // Requesting intro to non-opted-in Supplier B must fail with 404
    const hiddenIntroRes = await app.request("/api/v1/directory/request-intro", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
      body: JSON.stringify({
        targetOrgId: supplierB.orgId,
        materialCategory: "Aluminum Extrusions",
        volumeBand: "100 tonnes/year",
      }),
    });
    expect(hiddenIntroRes.status).toBe(404);
  });

  it("imports supplier onboarding XLSX template and enforces outreach deduplication & 1-click global unsubscribe", async () => {
    const emailCapture = new InMemoryCaptureEmailProvider();
    const app = createTestApp({}, { emailProvider: emailCapture });

    const buyer1 = await registerOrg(app, {
      email: "buyer1@nordic-oem.example",
      organizationName: "Nordic OEM AS",
      countryCode: "EE",
    });

    // Create own HQ so supplier onboarding XLSX can attach lanes to it
    await app.request("/api/v1/workspace/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer1.cookie },
      body: JSON.stringify({
        name: "Tallinn HQ",
        kind: "HQ",
        countryCode: "EE",
        lat: 59.437,
        lng: 24.7536,
        isOwnFacility: true,
        relationshipRole: "OWN",
      }),
    });

    // Download supplier onboarding XLSX template and upload it back
    const tmplRes = await app.request("/api/v1/workspace/templates/suppliers.xlsx", {
      headers: { Cookie: buyer1.cookie },
    });
    expect(tmplRes.status).toBe(200);
    const xlsxBuf = Buffer.from(await tmplRes.arrayBuffer());

    const importRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Cookie: buyer1.cookie,
      },
      body: xlsxBuf,
    });
    expect(importRes.status).toBe(200);
    const summary = (await importRes.json()) as {
      createdFacilities: number;
      createdLanes: number;
      errors: unknown[];
    };
    expect(summary.createdFacilities).toBe(2);
    expect(summary.createdLanes).toBe(2);
    expect(summary.errors).toHaveLength(0);

    // Wait briefly for fire-and-forget outreach promises to settle
    await new Promise((r) => setTimeout(r, 25));
    expect(emailCapture.sent.length).toBe(2);

    // Re-declaring the same supplier email for buyer1 MUST be deduplicated (no duplicate email)
    await app.request("/api/v1/workspace/relationship-declarations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer1.cookie },
      body: JSON.stringify({
        name: "Nordic AluWorks AB",
        role: "SUPPLIER",
        countryCode: "SE",
        contactEmail: "sales@nordicaluworks.example",
      }),
    });
    await new Promise((r) => setTimeout(r, 25));
    expect(emailCapture.sent.length).toBe(2);

    // Extract 1-click unsubscribe URL from the first outreach email and click it
    const firstEmailText = emailCapture.sent[0]!.text;
    const match = /\/api\/v1\/outreach\/unsubscribe\?token=([^\s]+)/.exec(
      firstEmailText,
    );
    expect(match).not.toBeNull();
    const unsubToken = decodeURIComponent(match![1]!);

    const unsubRes = await app.request(
      `/api/v1/outreach/unsubscribe?token=${encodeURIComponent(unsubToken)}`,
      { method: "GET" },
    );
    expect(unsubRes.status).toBe(200);

    // A SECOND buyer org declaring the unsubscribed supplier MUST NOT send an email
    const buyer2 = await registerOrg(app, {
      email: "buyer2@other-oem.example",
      organizationName: "Other OEM OÜ",
      countryCode: "EE",
    });
    const unsubEmail = emailCapture.sent[0]!.to[0]!;
    await app.request("/api/v1/workspace/relationship-declarations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer2.cookie },
      body: JSON.stringify({
        name: "Unsubscribed Supplier",
        role: "SUPPLIER",
        contactEmail: unsubEmail,
      }),
    });
    await new Promise((r) => setTimeout(r, 25));
    expect(emailCapture.sent.length).toBe(2);
  });
});

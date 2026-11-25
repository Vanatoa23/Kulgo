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

  it("handles real-world Excel self-closing <c .../> cells, XML entity edge cases, and blocks sparse-column & deflate DoS", async () => {
    const { deflateRawSync } = await import("node:zlib");
    // Build a valid base XLSX and replace sheet1.xml with Excel-style self-closing <c r="B2" s="1"/> + entities
    const base = buildXlsxBuffer("Sheet1", [
      ["supplier_name", "registry_code", "country_code"],
      ["Placeholder", "", "FI"],
    ]);
    expect(parseXlsxBuffer(base)[1]).toEqual(["Placeholder", "", "FI"]);

    // Construct custom sheet XML containing self-closing styled cell <c r="B2" s="1"/>, &#38;amp;, and out-of-range &#9999999;
    const customSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>supplier_name</t></is></c>
      <c r="B1" t="inlineStr"><is><t>registry_code</t></is></c>
      <c r="C1" t="inlineStr"><is><t>country_code</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>0</v></c>
      <c r="B2" s="1"/>
      <c r="C2" t="s"><v>1</v></c>
    </row>
  </sheetData>
</worksheet>`;
    const customSharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>Nordic &#38;amp; Co &#9999999;</t><rPh sb="0" eb="2"><t>HIDDEN_RUBY</t></rPh></si>
  <si><t>FI</t></si>
</sst>`;

    // Helper to build minimal ZIP for test XML parts
    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
    const crc32 = (b: Buffer) => {
      let c = 0xffffffff;
      for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const makeZip = (parts: Array<{ name: string; xml: string }>) => {
      const locals: Buffer[] = [];
      const centrals: Buffer[] = [];
      let offset = 0;
      for (const p of parts) {
        const nameBuf = Buffer.from(p.name, "utf8");
        const raw = Buffer.from(p.xml, "utf8");
        const comp = deflateRawSync(raw);
        const crc = crc32(raw);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(8, 8);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(comp.length, 18);
        lh.writeUInt32LE(raw.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26);
        locals.push(lh, nameBuf, comp);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(8, 10);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(comp.length, 20);
        ch.writeUInt32LE(raw.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28);
        ch.writeUInt32LE(offset, 42);
        centrals.push(ch, nameBuf);
        offset += lh.length + nameBuf.length + comp.length;
      }
      const cd = Buffer.concat(centrals);
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(parts.length, 8);
      eocd.writeUInt16LE(parts.length, 10);
      eocd.writeUInt32LE(cd.length, 12);
      eocd.writeUInt32LE(offset, 16);
      return Buffer.concat([...locals, cd, eocd]);
    };

    const excelStyleBuf = makeZip([
      { name: "xl/sharedStrings.xml", xml: customSharedStringsXml },
      { name: "xl/worksheets/sheet1.xml", xml: customSheetXml },
    ]);
    const parsedRows = parseXlsxBuffer(excelStyleBuf);
    expect(parsedRows).toEqual([
      ["supplier_name", "registry_code", "country_code"],
      ["Nordic &amp; Co \uFFFD", "", "FI"],
    ]);

    // Sparse column DoS (<c r="ZZZZZZ1">) must throw cleanly instead of hanging
    const sparseColBuf = makeZip([
      {
        name: "xl/worksheets/sheet1.xml",
        xml: `<worksheet><sheetData><row r="1"><c r="ZZZZZZ1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`,
      },
    ]);
    expect(() => parseXlsxBuffer(sparseColBuf)).toThrow(/column/i);
  });

  it("persists registryCode, enforces OWNER RBAC on catalogue, auto-creates HQ + Contracts on empty-workspace XLSX import, protects GET unsubscribe from scanners, and simulates What-If alternativeSwitch accurately", async () => {
    const emailCapture = new InMemoryCaptureEmailProvider();
    const app = createTestApp({}, { emailProvider: emailCapture });

    // 1. Organization & Facility registryCode persistence + Catalogue OWNER RBAC
    const owner = await registerOrg(app, {
      email: "owner@rbac-cat.ee",
      organizationName: "RBAC Catalogue OÜ",
      countryCode: "EE",
    });

    const orgPatchRes = await app.request("/api/v1/auth/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ registryCode: "12345678", openToNewBuyers: true }),
    });
    expect(orgPatchRes.status).toBe(200);
    const meRes = await app.request("/api/v1/auth/me", {
      headers: { Cookie: owner.cookie },
    });
    const meBody = (await meRes.json()) as {
      organization: { registryCode?: string | null };
    };
    expect(meBody.organization.registryCode).toBe("12345678");

    // Add a MEMBER user and verify 403 on POST /api/v1/directory/catalogue
    const addMemberRes = await app.request("/api/v1/auth/members", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        email: "member@rbac-cat.ee",
        password: "MemberSecurePassword123!",
        role: "MEMBER",
      }),
    });
    expect(addMemberRes.status).toBe(201);
    const memberLogin = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "member@rbac-cat.ee",
        password: "MemberSecurePassword123!",
      }),
    });
    const memberCookie = extractCookie(memberLogin);

    const memberCatPost = await app.request("/api/v1/directory/catalogue", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: memberCookie },
      body: JSON.stringify({
        standardizedCategory: "ALUMINUM_EXTRUSIONS",
        productTitle: "Unauthorized Member Item",
      }),
    });
    expect(memberCatPost.status).toBe(403);

    // 2. Fresh empty workspace (0 own facilities!) imports suppliers.xlsx -> auto-creates HQ, lanes, and Contracts
    const emptyBuyer = await registerOrg(app, {
      email: "fresh@empty-buyer.ee",
      organizationName: "Fresh Buyer OÜ",
      countryCode: "EE",
    });
    const tmplRes = await app.request("/api/v1/workspace/templates/suppliers.xlsx", {
      headers: { Cookie: emptyBuyer.cookie },
    });
    const xlsxBuf = Buffer.from(await tmplRes.arrayBuffer());

    const impRes = await app.request("/api/v1/workspace/import", {
      method: "POST",
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Cookie: emptyBuyer.cookie,
      },
      body: xlsxBuf,
    });
    expect(impRes.status).toBe(200);
    const impSummary = (await impRes.json()) as {
      createdFacilities: number;
      createdLanes: number;
      errors: unknown[];
    };
    expect(impSummary.errors).toHaveLength(0);
    expect(impSummary.createdFacilities).toBe(3); // 1 auto-created own HQ + 2 template suppliers
    expect(impSummary.createdLanes).toBe(2);

    const netRes = await app.request("/api/v1/workspace/network", {
      headers: { Cookie: emptyBuyer.cookie },
    });
    const netBody = (await netRes.json()) as {
      facilities: Array<{
        facilityId: string;
        name: string;
        isOwnFacility: boolean;
        registryCode?: string | null;
      }>;
      lanes: Array<{ laneId: string; fromFacilityId: string }>;
      contracts?: Array<{ contractType: string }>;
    };
    const importedAlu = netBody.facilities.find(
      (f) => f.name === "Nordic AluWorks AB",
    );
    expect(importedAlu?.registryCode).toBe("556001-1234");
    expect((netBody.contracts ?? []).length).toBe(2);

    // Wait for background outreach and verify RFC 8058 headers + scanner-safe GET unsubscribe
    await new Promise((r) => setTimeout(r, 30));
    expect(emailCapture.sent.length).toBe(2);
    expect(emailCapture.sent[0]!.headers?.["List-Unsubscribe"]).toContain(
      "/api/v1/outreach/unsubscribe?token=",
    );
    expect(emailCapture.sent[0]!.headers?.["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );

    const tokenMatch = /token=([^\s>]+)/.exec(
      emailCapture.sent[0]!.headers?.["List-Unsubscribe"] ?? "",
    );
    const unsubToken = decodeURIComponent(tokenMatch![1]!);

    // HTML scanner GET must return confirmation HTML WITHOUT suppressing the email
    const htmlGetRes = await app.request(
      `/api/v1/outreach/unsubscribe?token=${encodeURIComponent(unsubToken)}`,
      { method: "GET", headers: { Accept: "text/html,application/xhtml+xml" } },
    );
    expect(htmlGetRes.status).toBe(200);
    expect(await htmlGetRes.text()).toContain("<form");

    // 3. What-If Simulation with alternativeSwitch (50% switch drops single-source HHI 10000 -> 5000 & clears SPOF)
    const simRes = await app.request("/api/v1/analytics/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: emptyBuyer.cookie },
      body: JSON.stringify({
        laneChanges: [],
        alternativeSwitch: {
          fromFacilityId: importedAlu!.facilityId,
          alternativeName: "RBAC Catalogue OÜ",
          countryCode: "EE",
          riskStatus: "GREEN",
          switchPct: 50,
          estimatedDistanceKm: 80,
          productEmissionFactorTco2ePerUnit: 3.5,
          pcfVerified: true,
        },
      }),
    });
    expect(simRes.status).toBe(200);
    const simBody = (await simRes.json()) as {
      appliedChangesCount: number;
      deltas: {
        avgHhiDelta: number;
        spofCountDelta: number;
        resilienceScoreDelta: number;
      };
    };
    expect(simBody.appliedChangesCount).toBeGreaterThanOrEqual(1);
    expect(simBody.deltas.avgHhiDelta).toBeLessThan(0);
    expect(simBody.deltas.spofCountDelta).toBeLessThan(0);
    expect(simBody.deltas.resilienceScoreDelta).toBeGreaterThan(0);
  });
});

import {
  COMPANY_REGISTRY_MAX_CANDIDATES,
  CompanyRegistrySearchResponseSchema,
  EE_COMPANY_REGISTRY_SOURCE,
} from "@kulgo/shared";

import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createTestApp } from "../src/app.js";
import {
  createEeCompanyRegistrySearchService,
  type CompanyRegistrySearchService,
} from "../src/registry/service.js";
import { parseRegistryCsv } from "../src/registry/snapshot.js";

const SEARCH_PATH = "/api/v1/workspace/company-registry/search";
const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/registry/", import.meta.url));

const OFFICIAL_FIXTURE = path.join(FIXTURES_DIR, "ee-official-format.csv");
const AMBIGUOUS_FIXTURE = path.join(FIXTURES_DIR, "ee-ambiguous.csv");
const MANY_SIMILAR_FIXTURE = path.join(FIXTURES_DIR, "ee-many-similar.csv");
const CORRUPT_FIXTURE = path.join(FIXTURES_DIR, "corrupt.csv");

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
  email: string,
  organizationName: string,
): Promise<{ cookie: string; orgId: string }> {
  const res = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "RegistrySearchPassword2026!",
      organizationName,
      countryCode: "EE",
      sector: "Electronics",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { organization: { orgId: string } };
  return { cookie: extractCookie(res), orgId: body.organization.orgId };
}

function appWithSnapshot(snapshotPath: string) {
  return createTestApp({ EE_REGISTRY_SNAPSHOT_PATH: snapshotPath });
}

async function search(
  app: ReturnType<typeof createTestApp>,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return app.request(SEARCH_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(payload),
  });
}

async function searchOk(
  app: ReturnType<typeof createTestApp>,
  cookie: string,
  payload: Record<string, unknown>,
) {
  const res = await search(app, cookie, payload);
  expect(res.status).toBe(200);
  return CompanyRegistrySearchResponseSchema.parse(await res.json());
}

describe("Company registry search API (/api/v1/workspace/company-registry/search)", () => {
  it("requires authentication", async () => {
    const app = appWithSnapshot(OFFICIAL_FIXTURE);
    const res = await app.request(SEARCH_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nordic Alloys OÜ" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid payloads strictly (400) and never persists anything", async () => {
    const app = appWithSnapshot(OFFICIAL_FIXTURE);
    const org = await registerOrg(app, "reg-invalid@kulgo.ee", "Registry Invalid OU");

    const invalidPayloads: Array<Record<string, unknown>> = [
      {},
      { name: "" },
      { name: "   " },
      { name: "!!!" }, // normalizes to an empty name
      { name: 123 },
      { name: "x".repeat(161) },
      { name: "Valid Name", countryCode: "FIN" },
      { name: "Valid Name", countryCode: "E1" },
      { name: "Valid Name", registryId: "   " },
      { name: "Valid Name", registryId: "x".repeat(65) },
      { name: "Valid Name", ownerOrgId: "11111111-1111-4111-8111-111111111111" }, // strict input
      { name: "Valid Name", extra: "field" },
    ];
    for (const payload of invalidPayloads) {
      const res = await search(app, org.cookie, payload);
      expect(res.status).toBe(400);
    }

    const badJson = await app.request(SEARCH_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org.cookie },
      body: "{not json",
    });
    expect(badJson.status).toBe(400);
  });

  it("returns UNSUPPORTED_COUNTRY for non-EE countries", async () => {
    const app = appWithSnapshot(OFFICIAL_FIXTURE);
    const org = await registerOrg(app, "reg-country@kulgo.ee", "Registry Country OU");
    for (const countryCode of ["FI", "lv", "DE"]) {
      const result = await searchOk(app, org.cookie, {
        name: "Nordic Alloys OÜ",
        countryCode,
      });
      expect(result.outcome).toBe("UNSUPPORTED_COUNTRY");
      expect(result.candidates).toEqual([]);
      expect(result.source.id).toBe("EE_ARIREGISTER");
    }
  });

  it("reports SNAPSHOT_UNAVAILABLE when the snapshot is missing and keeps ordinary workspace operations working", async () => {
    const app = appWithSnapshot(path.join(FIXTURES_DIR, "does-not-exist.csv"));
    const org = await registerOrg(app, "reg-missing@kulgo.ee", "Registry Missing OU");

    const result = await searchOk(app, org.cookie, { name: "Nordic Alloys OÜ" });
    expect(result.outcome).toBe("SNAPSHOT_UNAVAILABLE");
    expect(result.candidates).toEqual([]);

    // Ordinary workspace operations are unaffected by the missing source.
    expect((await app.request("/api/v1/health")).status).toBe(200);
    expect(
      (
        await app.request("/api/v1/workspace/network", {
          headers: { Cookie: org.cookie },
        })
      ).status,
    ).toBe(200);
  });

  it("reports SNAPSHOT_UNAVAILABLE for a corrupt snapshot without breaking the app", async () => {
    const app = appWithSnapshot(CORRUPT_FIXTURE);
    const org = await registerOrg(app, "reg-corrupt@kulgo.ee", "Registry Corrupt OU");

    const result = await searchOk(app, org.cookie, { name: "Nordic Alloys OÜ" });
    expect(result.outcome).toBe("SNAPSHOT_UNAVAILABLE");

    expect((await app.request("/api/v1/health")).status).toBe(200);
    expect(
      (
        await app.request("/api/v1/workspace/network", {
          headers: { Cookie: org.cookie },
        })
      ).status,
    ).toBe(200);
  });

  it("parses the official CSV format (BOM, 18 columns, quoted fields) and returns only safe candidate fields", async () => {
    const app = appWithSnapshot(OFFICIAL_FIXTURE);
    const org = await registerOrg(app, "reg-format@kulgo.ee", "Registry Format OU");

    // Exact hit without country or ID -> offered as a candidate (Estonia-first).
    const result = await searchOk(app, org.cookie, { name: "Nordic Alloys OÜ" });
    expect(result.outcome).toBe("CANDIDATES");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual({
      legalName: "Nordic Alloys OÜ",
      registryId: "10137319",
      countryCode: "EE",
      source: "EE_ARIREGISTER",
      status: "ACTIVE",
    });
    expect(result.source).toEqual(EE_COMPANY_REGISTRY_SOURCE);
    expect(result.source.licence).toBe("CC BY 4.0");
    expect(result.source.licenceUrl).toBe("https://creativecommons.org/licenses/by/4.0/");

    // Case/diacritic/punctuation-insensitive exact match hits the same entry.
    for (const variant of ["nordic alloys ou", "NORDIC ALLOYS OÜ", "  Nordic-Alloys  OÜ "]) {
      const variantResult = await searchOk(app, org.cookie, { name: variant });
      expect(variantResult.candidates.map((c) => c.registryId)).toEqual(["10137319"]);
    }

    // Quoted field with embedded quotes parses correctly.
    const quoted = await searchOk(app, org.cookie, {
      name: 'OÜ "Kordamine" Test',
      countryCode: "EE",
    });
    expect(quoted.outcome).toBe("CONCLUSIVE_MATCH");
    expect(quoted.candidates[0]?.legalName).toBe('OÜ "Kordamine" Test');
    expect(quoted.candidates[0]?.registryId).toBe("77777777");

    // Strict response contract rejects unexpected fields.
    const res = await search(app, org.cookie, { name: "Nordic Alloys OÜ" });
    const body = (await res.json()) as {
      candidates: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
    expect(() =>
      CompanyRegistrySearchResponseSchema.parse({ ...body, leakedField: "x" }),
    ).toThrow();
    expect(() =>
      CompanyRegistrySearchResponseSchema.parse({
        ...body,
        candidates: body.candidates.map((c) => ({ ...c, email: "x@y.z" })),
      }),
    ).toThrow();
  });

  it("Estonia-first: exact unique name is conclusive with matching country or a consistent ID", async () => {
    const app = appWithSnapshot(OFFICIAL_FIXTURE);
    const org = await registerOrg(app, "reg-conclusive@kulgo.ee", "Registry Conclusive OU");

    // Matching country (lowercase input is normalized to EE).
    const byCountry = await searchOk(app, org.cookie, {
      name: "Tartu Electronics AS",
      countryCode: "ee",
    });
    expect(byCountry.outcome).toBe("CONCLUSIVE_MATCH");
    expect(byCountry.candidates.map((c) => c.registryId)).toEqual(["11223344"]);

    // Consistent registry ID (whitespace-trimmed) without country.
    const byId = await searchOk(app, org.cookie, {
      name: "Tartu Electronics AS",
      registryId: " 11223344 ",
    });
    expect(byId.outcome).toBe("CONCLUSIVE_MATCH");
    expect(byId.candidates[0]?.status).toBe("ACTIVE");

    // Both together.
    const both = await searchOk(app, org.cookie, {
      name: "Tartu Electronics AS",
      countryCode: "EE",
      registryId: "11223344",
    });
    expect(both.outcome).toBe("CONCLUSIVE_MATCH");
  });

  it("never silently attaches another company on an ID/name conflict", async () => {
    const app = appWithSnapshot(OFFICIAL_FIXTURE);
    const org = await registerOrg(app, "reg-conflict@kulgo.ee", "Registry Conflict OU");

    // 11223344 belongs to Tartu Electronics AS, not to Nordic Alloys OÜ.
    const conflict = await searchOk(app, org.cookie, {
      name: "Nordic Alloys OÜ",
      registryId: "11223344",
    });
    expect(conflict.outcome).toBe("CANDIDATES");
    expect(conflict.candidates.map((c) => c.registryId)).not.toContain("11223344");
    expect(conflict.candidates.map((c) => c.legalName)).not.toContain("Tartu Electronics AS");
    expect(conflict.candidates.map((c) => c.registryId)).toContain("10137319");

    // Even with a matching country, a conflicting ID blocks a conclusive result.
    const conflictWithCountry = await searchOk(app, org.cookie, {
      name: "Nordic Alloys OÜ",
      countryCode: "EE",
      registryId: "11223344",
    });
    expect(conflictWithCountry.outcome).toBe("CANDIDATES");
    expect(conflictWithCountry.candidates.map((c) => c.registryId)).not.toContain("11223344");
  });

  it("a client-supplied registry ID alone verifies nothing", async () => {
    const app = appWithSnapshot(OFFICIAL_FIXTURE);
    const org = await registerOrg(app, "reg-idonly@kulgo.ee", "Registry IdOnly OU");

    // Unknown ID, no country -> name-based candidates, never conclusive via the ID.
    const unknownId = await searchOk(app, org.cookie, {
      name: "Nordic Alloys OÜ",
      registryId: "00000000",
    });
    expect(unknownId.outcome).toBe("CANDIDATES");

    // ID-only query with a non-matching name is not a match at all.
    const idOnly = await searchOk(app, org.cookie, {
      name: "Completely Different Name",
      registryId: "10137319",
    });
    expect(idOnly.outcome).toBe("NO_MATCH");
    expect(idOnly.candidates).toEqual([]);
  });

  it("offers the name/country record as a choice when the supplied registry ID is missing from the snapshot", async () => {
    const app = appWithSnapshot(OFFICIAL_FIXTURE);
    const org = await registerOrg(app, "reg-missingid@kulgo.ee", "Registry MissingId OU");

    // Missing ID + exact unique name + EE country: the record is a choice, not conclusive.
    const missingId = await searchOk(app, org.cookie, {
      name: "Nordic Alloys OÜ",
      countryCode: "EE",
      registryId: "00000000",
    });
    expect(missingId.outcome).toBe("CANDIDATES");
    expect(missingId.candidates).toHaveLength(1);
    expect(missingId.candidates[0]?.registryId).toBe("10137319");
    expect(missingId.candidates[0]?.legalName).toBe("Nordic Alloys OÜ");

    // Without any ID, the same name/country query stays conclusive.
    const noId = await searchOk(app, org.cookie, {
      name: "Nordic Alloys OÜ",
      countryCode: "EE",
    });
    expect(noId.outcome).toBe("CONCLUSIVE_MATCH");
    expect(noId.candidates.map((c) => c.registryId)).toEqual(["10137319"]);

    // Missing ID without country still goes to user choice (unchanged).
    const missingIdNoCountry = await searchOk(app, org.cookie, {
      name: "Nordic Alloys OÜ",
      registryId: "00000000",
    });
    expect(missingIdNoCountry.outcome).toBe("CANDIDATES");
    expect(missingIdNoCountry.candidates.map((c) => c.registryId)).toEqual(["10137319"]);

    // Missing ID + ambiguous exact names still offers all of them as choices.
    const appAmb = appWithSnapshot(AMBIGUOUS_FIXTURE);
    const orgAmb = await registerOrg(appAmb, "reg-missingid-amb@kulgo.ee", "Registry MissingId Amb OU");
    const amb = await searchOk(appAmb, orgAmb.cookie, {
      name: "Dup Name OÜ",
      countryCode: "EE",
      registryId: "00000000",
    });
    expect(amb.outcome).toBe("CANDIDATES");
    expect(amb.candidates.map((c) => c.registryId).sort()).toEqual(["20000001", "20000002"]);

    // Missing ID and no plausible name match at all is still NO_MATCH.
    const none = await searchOk(app, org.cookie, {
      name: "Totally Unknown Company Xyz",
      countryCode: "EE",
      registryId: "00000000",
    });
    expect(none.outcome).toBe("NO_MATCH");
    expect(none.candidates).toEqual([]);
  });

  it("sends multiple plausible matches to user choice; a consistent ID disambiguates", async () => {
    const app = appWithSnapshot(AMBIGUOUS_FIXTURE);
    const org = await registerOrg(app, "reg-ambiguous@kulgo.ee", "Registry Ambiguous OU");

    // Two identical names -> candidates, even with country EE (not unique).
    const ambiguous = await searchOk(app, org.cookie, {
      name: "Dup Name OÜ",
      countryCode: "EE",
    });
    expect(ambiguous.outcome).toBe("CANDIDATES");
    expect(ambiguous.candidates.map((c) => c.registryId).sort()).toEqual([
      "20000001",
      "20000002",
    ]);
    expect(ambiguous.candidates.find((c) => c.registryId === "20000001")?.status).toBe("ACTIVE");
    expect(ambiguous.candidates.find((c) => c.registryId === "20000002")?.status).toBe("INACTIVE");

    // A consistent ID picks exactly one.
    const disambiguated = await searchOk(app, org.cookie, {
      name: "Dup Name OÜ",
      registryId: "20000002",
    });
    expect(disambiguated.outcome).toBe("CONCLUSIVE_MATCH");
    expect(disambiguated.candidates).toHaveLength(1);
    expect(disambiguated.candidates[0]?.registryId).toBe("20000002");
    expect(disambiguated.candidates[0]?.status).toBe("INACTIVE");
  });

  it("maps official status codes: R is ACTIVE, L/N are INACTIVE", async () => {
    const app = appWithSnapshot(OFFICIAL_FIXTURE);
    const org = await registerOrg(app, "reg-status@kulgo.ee", "Registry Status OU");

    const active = await searchOk(app, org.cookie, {
      name: "Nordic Alloys OÜ",
      countryCode: "EE",
    });
    expect(active.candidates[0]?.status).toBe("ACTIVE");

    const liquidation = await searchOk(app, org.cookie, {
      name: "Likvideeritud Ettevõte OÜ",
      countryCode: "EE",
    });
    expect(liquidation.outcome).toBe("CONCLUSIVE_MATCH");
    expect(liquidation.candidates[0]?.status).toBe("INACTIVE");

    const bankruptcy = await searchOk(app, org.cookie, { name: "Pankrotis Firma AS" });
    expect(bankruptcy.candidates[0]?.status).toBe("INACTIVE");
  });

  it("returns NO_MATCH when nothing is plausible", async () => {
    const app = appWithSnapshot(OFFICIAL_FIXTURE);
    const org = await registerOrg(app, "reg-nomatch@kulgo.ee", "Registry NoMatch OU");
    const result = await searchOk(app, org.cookie, {
      name: "Totally Unknown Company Xyz",
      countryCode: "EE",
    });
    expect(result.outcome).toBe("NO_MATCH");
    expect(result.candidates).toEqual([]);
  });

  it("fuzzy fallback is bounded and never conclusive", async () => {
    const app = appWithSnapshot(MANY_SIMILAR_FIXTURE);
    const org = await registerOrg(app, "reg-fuzzy@kulgo.ee", "Registry Fuzzy OU");

    const result = await searchOk(app, org.cookie, {
      name: "Similar Name",
      countryCode: "EE",
    });
    expect(result.outcome).toBe("CANDIDATES");
    expect(result.candidates.length).toBeLessThanOrEqual(COMPANY_REGISTRY_MAX_CANDIDATES);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.legalName.startsWith("Similar Name"))).toBe(true);

    // Partial name over the official fixture: both Nordic Alloys entries, no auto-attach.
    const app2 = appWithSnapshot(OFFICIAL_FIXTURE);
    const org2 = await registerOrg(app2, "reg-fuzzy2@kulgo.ee", "Registry Fuzzy Two OU");
    const partial = await searchOk(app2, org2.cookie, {
      name: "Nordic Alloys",
      countryCode: "EE",
    });
    expect(partial.outcome).toBe("CANDIDATES");
    expect(partial.candidates.map((c) => c.registryId).sort()).toEqual([
      "10137319",
      "12312312",
    ]);
  });

  it("refreshes safely from a replaced on-disk snapshot and recovers from a corrupt replacement", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kulgo-registry-"));
    const snapshotPath = path.join(dir, "snapshot.csv");
    try {
      const header =
        "nimi;ariregistri_kood;ettevotja_oiguslik_vorm;kmkr_nr;ettevotja_staatus;ettevotja_staatus_tekstina\n";
      await writeFile(
        snapshotPath,
        `${header}Old Snapshot OÜ;10000001;Osaühing;;R;Registrisse kantud\n`,
        "utf8",
      );
      const app = appWithSnapshot(snapshotPath);
      const org = await registerOrg(app, "reg-refresh@kulgo.ee", "Registry Refresh OU");

      const before = await searchOk(app, org.cookie, {
        name: "Old Snapshot OÜ",
        countryCode: "EE",
      });
      expect(before.outcome).toBe("CONCLUSIVE_MATCH");
      expect(before.candidates[0]?.registryId).toBe("10000001");

      // Operator replaces the snapshot on disk (atomic rename simulated by write + mtime bump).
      await writeFile(
        snapshotPath,
        `${header}New Snapshot AS;20000002;Aktsiaselts;;R;Registrisse kantud\n`,
        "utf8",
      );
      const bumped = new Date(Date.now() + 5000);
      await utimes(snapshotPath, bumped, bumped);

      const afterReplace = await searchOk(app, org.cookie, {
        name: "New Snapshot AS",
        countryCode: "EE",
      });
      expect(afterReplace.outcome).toBe("CONCLUSIVE_MATCH");
      expect(afterReplace.candidates[0]?.registryId).toBe("20000002");

      const oldGone = await searchOk(app, org.cookie, { name: "Old Snapshot OÜ" });
      expect(oldGone.outcome).toBe("NO_MATCH");

      // Corrupt replacement -> unavailable, but the app keeps working.
      await writeFile(snapshotPath, "garbage,not,a,registry\n\x00\x01\n", "utf8");
      await utimes(snapshotPath, bumped, bumped);
      const corrupt = await searchOk(app, org.cookie, { name: "New Snapshot AS" });
      expect(corrupt.outcome).toBe("SNAPSHOT_UNAVAILABLE");
      expect((await app.request("/api/v1/health")).status).toBe(200);
      expect(
        (
          await app.request("/api/v1/workspace/network", {
            headers: { Cookie: org.cookie },
          })
        ).status,
      ).toBe(200);

      // Restoring a valid snapshot recovers without restart.
      await writeFile(
        snapshotPath,
        `${header}Restored OÜ;30000003;Osaühing;;R;Registrisse kantud\n`,
        "utf8",
      );
      const bumped2 = new Date(Date.now() + 10000);
      await utimes(snapshotPath, bumped2, bumped2);
      const restored = await searchOk(app, org.cookie, {
        name: "Restored OÜ",
        countryCode: "EE",
      });
      expect(restored.outcome).toBe("CONCLUSIVE_MATCH");
      expect(restored.candidates[0]?.registryId).toBe("30000003");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes only the search terms to the registry service and returns public data only", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const base = createEeCompanyRegistrySearchService(OFFICIAL_FIXTURE);
    const spy: CompanyRegistrySearchService = {
      snapshotState: () => base.snapshotState(),
      search: async (input) => {
        captured.push({ ...input });
        return base.search(input);
      },
    };
    const app = createTestApp(
      { EE_REGISTRY_SNAPSHOT_PATH: OFFICIAL_FIXTURE },
      { registrySearch: spy },
    );
    const orgA = await registerOrg(app, "reg-privacy-a@kulgo.ee", "Registry Privacy A OU");
    const orgB = await registerOrg(app, "reg-privacy-b@kulgo.ee", "Registry Privacy B OU");

    const secretName = "SECRET_SUPPLIER_OF_ORG_A_9F3K";
    const resA = await search(app, orgA.cookie, {
      name: secretName,
      countryCode: "EE",
      registryId: "10137319",
    });
    expect(resA.status).toBe(200);
    const textA = await resA.text();

    // The service received only name/countryCode/registryId — never org or user data.
    expect(captured).toHaveLength(1);
    expect(Object.keys(captured[0]!).sort()).toEqual(["countryCode", "name", "registryId"]);
    expect(JSON.stringify(captured[0])).not.toContain(orgA.orgId);
    expect(JSON.stringify(captured[0])).not.toContain("reg-privacy-a@kulgo.ee");

    // The response is strict public registry data: no org IDs, no emails, no echo of other tenants.
    const parsed = CompanyRegistrySearchResponseSchema.parse(JSON.parse(textA));
    expect(textA).not.toContain(orgA.orgId);
    expect(textA).not.toContain(orgB.orgId);
    expect(textA).not.toContain("@");
    expect(parsed.candidates.every((c) => c.source === "EE_ARIREGISTER")).toBe(true);

    // Org B searching sees only the same public snapshot data — nothing about Org A.
    const resB = await search(app, orgB.cookie, { name: secretName });
    const textB = await resB.text();
    expect(resB.status).toBe(200);
    expect(textB).not.toContain(orgA.orgId);
    expect(textB).not.toContain("reg-privacy-a@kulgo.ee");
    CompanyRegistrySearchResponseSchema.parse(JSON.parse(textB));
  });

  it("parses only name/registry-code/status columns and rejects corrupt CSV at the unit level", async () => {
    const text = await readFile(OFFICIAL_FIXTURE, "utf8");
    const index = parseRegistryCsv(text);
    expect(index.rowCount).toBe(6);
    expect(index.byRegistryId.get("10137319")?.legalName).toBe("Nordic Alloys OÜ");
    expect(index.byRegistryId.get("10137319")?.status).toBe("ACTIVE");
    expect(index.byRegistryId.get("55667788")?.status).toBe("INACTIVE");
    expect(index.byRegistryId.get("99887766")?.status).toBe("INACTIVE");
    expect(index.byRegistryId.get("77777777")?.legalName).toBe('OÜ "Kordamine" Test');

    const corruptText = await readFile(CORRUPT_FIXTURE, "utf8");
    expect(() => parseRegistryCsv(corruptText)).toThrow();
    expect(() => parseRegistryCsv("")).toThrow();
    expect(() => parseRegistryCsv("foo;bar\n1;2\n")).toThrow();
  });
});

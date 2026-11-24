import {
  CreateRelationshipDeclarationResponseSchema,
  ListRelationshipDeclarationsResponseSchema,
  RelationshipDeclarationSchema,
} from "@kulgo/shared";

import { describe, expect, it } from "vitest";

import { createTestApp } from "../src/app.js";

const DECLARATIONS_PATH = "/api/v1/workspace/relationship-declarations";

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
      password: "DeclarationsTestPassword2026!",
      organizationName,
      countryCode: "EE",
      sector: "Electronics",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { organization: { orgId: string } };
  return { cookie: extractCookie(res), orgId: body.organization.orgId };
}

async function createDeclaration(
  app: ReturnType<typeof createTestApp>,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return app.request(DECLARATIONS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(payload),
  });
}

async function listDeclarations(
  app: ReturnType<typeof createTestApp>,
  cookie: string,
): Promise<Response> {
  return app.request(DECLARATIONS_PATH, { headers: { Cookie: cookie } });
}

describe("Relationship Declarations API (/api/v1/workspace/relationship-declarations)", () => {
  it("creates name-only supplier and buyer declarations and lists them owner-scoped", async () => {
    const app = createTestApp();
    const org = await registerOrg(app, "decl-owner@kulgo.ee", "Declaration Owner OU");

    // Name-only SUPPLIER declaration: name is trimmed, optional fields are null.
    const supplierRes = await createDeclaration(app, org.cookie, {
      name: "  Nordic Alloys Oy  ",
      role: "SUPPLIER",
    });
    expect(supplierRes.status).toBe(201);
    const supplierBody = CreateRelationshipDeclarationResponseSchema.parse(
      await supplierRes.json(),
    );
    const supplier = supplierBody.declaration;
    expect(supplier.name).toBe("Nordic Alloys Oy");
    expect(supplier.role).toBe("SUPPLIER");
    expect(supplier.countryCode).toBeNull();
    expect(supplier.registryId).toBeNull();
    expect(supplier.contactEmail).toBeNull();
    expect(supplier.status).toBe("DECLARED");
    expect(supplier.ownerOrgId).toBe(org.orgId);
    expect(() => RelationshipDeclarationSchema.parse(supplier)).not.toThrow();

    // Name-only CLIENT declaration (both directions).
    const clientRes = await createDeclaration(app, org.cookie, {
      name: "Baltic Retail Group AS",
      role: "CLIENT",
    });
    expect(clientRes.status).toBe(201);
    const client = CreateRelationshipDeclarationResponseSchema.parse(
      await clientRes.json(),
    ).declaration;
    expect(client.role).toBe("CLIENT");
    expect(client.ownerOrgId).toBe(org.orgId);
    expect(client.declarationId).not.toBe(supplier.declarationId);

    // List returns both declarations, newest first, strictly owner-scoped.
    const listRes = await listDeclarations(app, org.cookie);
    expect(listRes.status).toBe(200);
    const list = ListRelationshipDeclarationsResponseSchema.parse(await listRes.json());
    expect(list.declarations).toHaveLength(2);
    expect(list.declarations.map((d) => d.declarationId).sort()).toEqual(
      [supplier.declarationId, client.declarationId].sort(),
    );
    expect(list.declarations.every((d) => d.ownerOrgId === org.orgId)).toBe(true);
  });

  it("accepts optional country, registry ID, and contact email; a registry ID stays a client declaration", async () => {
    const app = createTestApp();
    const org = await registerOrg(app, "decl-full@kulgo.ee", "Full Fields OU");

    const res = await createDeclaration(app, org.cookie, {
      name: "Tartu Electronics AS",
      role: "SUPPLIER",
      countryCode: "ee",
      registryId: "  12345678 ",
      contactEmail: "  OPS@TARTUELEC.EE ",
    });
    expect(res.status).toBe(201);
    const { declaration } = CreateRelationshipDeclarationResponseSchema.parse(
      await res.json(),
    );
    expect(declaration.countryCode).toBe("EE");
    expect(declaration.registryId).toBe("12345678");
    expect(declaration.contactEmail).toBe("ops@tartuelec.ee");
    // A supplied registry ID is a client declaration at this stage.
    expect(declaration.status).toBe("DECLARED");
    expect(declaration.ownerOrgId).toBe(org.orgId);

    const listRes = await listDeclarations(app, org.cookie);
    const list = ListRelationshipDeclarationsResponseSchema.parse(await listRes.json());
    expect(list.declarations).toHaveLength(1);
    expect(list.declarations[0]).toEqual(declaration);
  });

  it("rejects invalid fields and client-supplied owner organizations", async () => {
    const app = createTestApp();
    const org = await registerOrg(app, "decl-invalid@kulgo.ee", "Invalid Fields OU");

    const invalidPayloads: Array<Record<string, unknown>> = [
      { role: "SUPPLIER" }, // missing name
      { name: "", role: "SUPPLIER" }, // empty name
      { name: "   ", role: "CLIENT" }, // whitespace-only name
      { name: "Valid Name", role: "VENDOR" }, // invalid role
      { name: "Valid Name", role: "SUPPLIER", contactEmail: "not-an-email" },
      { name: "Valid Name", role: "SUPPLIER", countryCode: "FIN" }, // not 2 letters
      { name: "Valid Name", role: "SUPPLIER", countryCode: "E1" },
      { name: "Valid Name", role: "SUPPLIER", registryId: "   " },
      // The request never takes its owner organization from client input:
      // the strict input contract rejects an ownerOrgId field outright.
      { name: "Spoof Attempt", role: "SUPPLIER", ownerOrgId: "11111111-1111-4111-8111-111111111111" },
    ];

    for (const payload of invalidPayloads) {
      const res = await createDeclaration(app, org.cookie, payload);
      expect(res.status).toBe(400);
    }

    // Invalid JSON body
    const badJson = await app.request(DECLARATIONS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: org.cookie },
      body: "{not json",
    });
    expect(badJson.status).toBe(400);

    // Nothing was persisted
    const list = ListRelationshipDeclarationsResponseSchema.parse(
      await (await listDeclarations(app, org.cookie)).json(),
    );
    expect(list.declarations).toHaveLength(0);
  });

  it("returns 401 for anonymous create and list", async () => {
    const app = createTestApp();

    expect((await app.request(DECLARATIONS_PATH)).status).toBe(401);
    expect(
      (
        await app.request(DECLARATIONS_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Anonymous Supplier", role: "SUPPLIER" }),
        })
      ).status,
    ).toBe(401);
  });

  it("isolates two organizations: independent create/list without cross-tenant access", async () => {
    const app = createTestApp();
    const orgA = await registerOrg(app, "decl-a@org-a.ee", "Org A Declarations");
    const orgB = await registerOrg(app, "decl-b@org-b.ee", "Org B Declarations");

    const secretNameA = "SECRET_SUPPLIER_OF_ORG_A_9F3K";
    const secretEmailA = "secret-decl-a@org-a.ee";

    const aRes = await createDeclaration(app, orgA.cookie, {
      name: secretNameA,
      role: "SUPPLIER",
      contactEmail: secretEmailA,
      registryId: "REG-A-1",
    });
    expect(aRes.status).toBe(201);
    const declA = CreateRelationshipDeclarationResponseSchema.parse(await aRes.json())
      .declaration;
    expect(declA.ownerOrgId).toBe(orgA.orgId);

    await createDeclaration(app, orgA.cookie, { name: "Org A Buyer", role: "CLIENT" });

    const bRes = await createDeclaration(app, orgB.cookie, {
      name: "Org B Supplier",
      role: "SUPPLIER",
      countryCode: "FI",
    });
    expect(bRes.status).toBe(201);
    const declB = CreateRelationshipDeclarationResponseSchema.parse(await bRes.json())
      .declaration;
    expect(declB.ownerOrgId).toBe(orgB.orgId);

    // Org A lists only its own two declarations.
    const listARes = await listDeclarations(app, orgA.cookie);
    expect(listARes.status).toBe(200);
    const listA = ListRelationshipDeclarationsResponseSchema.parse(await listARes.json());
    expect(listA.declarations).toHaveLength(2);
    expect(listA.declarations.every((d) => d.ownerOrgId === orgA.orgId)).toBe(true);

    // Org B lists only its own single declaration — zero cross-tenant leakage.
    const listBRes = await listDeclarations(app, orgB.cookie);
    expect(listBRes.status).toBe(200);
    const listBText = await listBRes.text();
    const listB = ListRelationshipDeclarationsResponseSchema.parse(JSON.parse(listBText));
    expect(listB.declarations).toHaveLength(1);
    expect(listB.declarations[0]).toEqual(declB);
    expect(listBText).not.toContain(secretNameA);
    expect(listBText).not.toContain(secretEmailA);
    expect(listBText).not.toContain("REG-A-1");
    expect(listBText).not.toContain(orgA.orgId);
  });

  it("strict response contracts reject unexpected fields", async () => {
    const app = createTestApp();
    const org = await registerOrg(app, "decl-strict@kulgo.ee", "Strict Contracts OU");

    const res = await createDeclaration(app, org.cookie, {
      name: "Strict Supplier",
      role: "SUPPLIER",
    });
    expect(res.status).toBe(201);
    const created = CreateRelationshipDeclarationResponseSchema.parse(await res.json());

    expect(() =>
      CreateRelationshipDeclarationResponseSchema.parse({
        ...created,
        ownerOrgId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toThrow();

    const list = ListRelationshipDeclarationsResponseSchema.parse(
      await (await listDeclarations(app, org.cookie)).json(),
    );
    expect(() =>
      ListRelationshipDeclarationsResponseSchema.parse({
        ...list,
        declarationsOfOtherOrgs: [],
      }),
    ).toThrow();
    expect(() =>
      RelationshipDeclarationSchema.parse({
        ...created.declaration,
        otherOrgSecret: "leak",
      }),
    ).toThrow();
  });
});

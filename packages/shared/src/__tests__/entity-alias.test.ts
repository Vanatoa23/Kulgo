import { describe, expect, it } from "vitest";
import {
  PublicEntitySchema,
  resolvePublicEntity,
} from "../entity-alias.js";
import { AlertAckReasonSchema, OrgAlertAckSchema } from "../network.js";

const tallinn = PublicEntitySchema.parse({
  entityId: "ee-tallinna-sadam",
  canonicalName: "AS Tallinna Sadam",
  registryIds: { EE_ARIREGISTER: "10137319" },
  aliases: ["Port of Tallinn"],
  negativeMatches: ["Tallinna Sadam Spa"],
  sites: [{ name: "Muuga Harbour", kind: "PORT_OR_TERMINAL", countryCode: "EE" }],
});

describe("public entity dictionary", () => {
  it("resolves aliases, sites and registry ids", () => {
    expect(resolvePublicEntity([tallinn], { name: "port of tallinn" })?.matchedOn).toBe("ALIAS");
    expect(resolvePublicEntity([tallinn], { name: "Muuga  harbour" })?.site?.kind).toBe("PORT_OR_TERMINAL");
    expect(resolvePublicEntity([tallinn], { registryId: "10137319" })?.matchedOn).toBe("REGISTRY_ID");
  });
  it("honours negative matches", () => {
    expect(resolvePublicEntity([tallinn], { name: "Tallinna Sadam Spa" })).toBeNull();
  });
});

describe("alert ack reason", () => {
  const base = {
    orgId: "11111111-1111-4111-8111-111111111111",
    signalId: "s1",
    status: "ACKNOWLEDGED",
    acknowledgedByUserId: "22222222-2222-4222-8222-222222222222",
    acknowledgedAt: new Date().toISOString(),
  };
  it("defaults reason to null and accepts enum values", () => {
    expect(OrgAlertAckSchema.parse(base).reason).toBeNull();
    expect(OrgAlertAckSchema.parse({ ...base, reason: "HANDLED" }).reason).toBe("HANDLED");
    expect(AlertAckReasonSchema.safeParse("BOGUS").success).toBe(false);
  });
});

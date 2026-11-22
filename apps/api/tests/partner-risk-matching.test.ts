import { describe, expect, it, vi } from "vitest";
import { AnalyticsSummarySchema, FacilitySchema, RiskSignalSchema, SupplyLaneSchema, WorkspaceNetworkResponseSchema } from "@kulgo/shared";
import { InMemoryAuthRepository } from "../src/auth/repository.js";
import { InMemoryWorkspaceRepository } from "../src/workspace/repository.js";
import { InMemoryInvitationRepository } from "../src/invites/repository.js";
import { InMemoryRiskSignalRepository } from "../src/analytics/risk-signals.js";
import { createPartnerHiddenSummaryResolver } from "../src/analytics/partner-resolver.js";
import { OrgScopedAnalyticsRepository } from "../src/analytics/repository.js";

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const buyerOrg = id(10), partnerOrg = id(11);
const own = (n: number, orgId: string) => FacilitySchema.parse({
  facilityId: id(n), ownerOrgId: orgId, name: "Own plant", kind: "FACTORY",
  locationPrecision: "SITE_VERIFIED", countryCode: "EE", lat: 59.4, lng: 24.7, isOwnFacility: true,
});
const tier1 = FacilitySchema.parse({ ...own(2, buyerOrg), name: "Visible partner", isOwnFacility: false, isPartnerVerified: true });
const secret = FacilitySchema.parse({ ...own(4, partnerOrg), name: "SECRET upstream identity",
  countryCode: "CN", lat: 22.5, lng: 114, isOwnFacility: false });
const makeLane = (n: number, from: string, to: string, orgId: string) => SupplyLaneSchema.parse({
  laneId: id(n), ownerOrgId: orgId, fromFacilityId: from, toFacilityId: to,
  materialCategory: "Electronics", transportMode: "SEA", volumeSharePct: 100,
  annualSpendEur: 1_200_000, riskStatus: "GREEN",
});
const signal = RiskSignalSchema.parse({ signalId: "private-event", title: "Disruption",
  kind: "SANCTIONS", severity: "RED", affectedCountryCodes: [], active: true,
  polygonWkt: "POLYGON ((113 22, 115 22, 115 23, 113 23, 113 22))" });

describe("hidden upstream risk matching (#38)", () => {
  it.each(["climate plus lane sanctions", "polygon sanctions", "corridor sanctions", "unrelated event"])("propagates %s without leaking private topology", async scenario => {
    const authRepo = new InMemoryAuthRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const riskSignalRepo = new InMemoryRiskSignalRepository([]);
    const inviteRepo = new InMemoryInvitationRepository({ authRepo, workspaceRepo });
    const buyerLane = makeLane(5, tier1.facilityId, id(1), buyerOrg);
    const upstreamLane = makeLane(6, secret.facilityId, id(3), partnerOrg);
    if (scenario === "climate plus lane sanctions") {
      upstreamLane.riskStatus = "RED";
      upstreamLane.riskReason = "Secondary sanctions on SECRET upstream identity";
    }
    const buyer = WorkspaceNetworkResponseSchema.parse({ facilities: [own(1, buyerOrg), tier1], lanes: [buyerLane], products: [], inputs: [] });
    const partner = WorkspaceNetworkResponseSchema.parse({ facilities: [own(3, partnerOrg), secret], lanes: [upstreamLane], products: [], inputs: [] });
    vi.spyOn(workspaceRepo, "getNetwork").mockImplementation(async org => org === buyerOrg ? buyer : partner);
    vi.spyOn(inviteRepo, "listVerifiedPartnerLinksForOrg").mockImplementation(async org => org === buyerOrg ? [{
      inviteId: id(7), fromOrgId: buyerOrg, targetFacilityId: tier1.facilityId, partnerOrgId: partnerOrg,
      linkedAt: new Date().toISOString(), fulfilledByFacilityId: id(3),
    }] : []);
    const resolvePartnerHiddenSummaries = createPartnerHiddenSummaryResolver({ authRepo, workspaceRepo, riskSignalRepo, inviteRepo });
    const repo = new OrgScopedAnalyticsRepository({ authRepo, workspaceRepo, riskSignalRepo, resolvePartnerHiddenSummaries });
    const baseline = await repo.getSummary(buyerOrg);
    await riskSignalRepo.upsertSignal({ ...signal,
      ...(scenario === "climate plus lane sanctions" ? { kind: "CLIMATE" as const, severity: "YELLOW" as const } : {}),
      ...(scenario === "corridor sanctions" ? { polygonWkt: "POLYGON EMPTY", affectedChokepoints: ["SUEZ_CANAL" as const] } : {}),
      ...(scenario === "unrelated event" ? { polygonWkt: "POLYGON ((0 0, 1 0, 1 1, 0 1, 0 0))" } : {}),
    });
    const summary = AnalyticsSummarySchema.parse(await repo.getSummary(buyerOrg));
    const sanctions = summary.alerts.filter(a => a.category === "SECONDARY_SANCTION");
    if (scenario === "unrelated event") {
      expect(sanctions).toHaveLength(0);
      expect(summary.financialRisk?.baseEur).toBe(baseline.financialRisk?.baseEur);
    } else {
      expect(sanctions).toContainEqual(expect.objectContaining({ severity: "RED", affectedTier1FacilityIds: [tier1.facilityId] }));
      if (scenario !== "climate plus lane sanctions") {
        expect(summary.financialRisk!.baseEur!).toBeGreaterThan(baseline.financialRisk!.baseEur!);
      }
    }
    const serialized = JSON.stringify(summary);
    for (const forbidden of [partnerOrg, secret.facilityId, secret.name, upstreamLane.laneId, '"lat":', '"lng":']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

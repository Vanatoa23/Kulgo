import {
  AlternativeCandidateSchema,
  type AlternativeCandidate,
  type RiskSignal,
  type RiskStatus,
} from "@kulgo/shared";
import type { RiskSignalRepository } from "../analytics/risk-signals.js";
import type { AuthRepository } from "../auth/repository.js";

export interface DirectoryFilters {
  countryCode?: string;
  capability?: string;
  excludeRed?: boolean;
}

/**
 * Deterministic seeded EU/Nordic alternative suppliers available in Kulgo's
 * opt-in supplier directory. Exposes strictly public capability and ESG info.
 */
export const SEEDED_EU_ALTERNATIVES: readonly AlternativeCandidate[] = [
  AlternativeCandidateSchema.parse({
    orgId: "90000001-0001-4001-8001-000000000001",
    name: "Nordic AluWorks AB",
    countryCode: "SE",
    capabilities: [
      "Aluminum Alloys",
      "Recycled Extrusions",
      "Precision CNC Machining",
    ],
    esgBadges: ["ISO-14001", "100% Hydro Powered", "EU-CSRD-READY"],
    riskStatus: "GREEN",
    source: "SEEDED_DIRECTORY",
  }),
  AlternativeCandidateSchema.parse({
    orgId: "90000001-0001-4001-8001-000000000002",
    name: "Suomi MicroElectronics Oy",
    countryCode: "FI",
    capabilities: [
      "Precision Electronics",
      "PCB Assembly",
      "Power Control Modules",
    ],
    esgBadges: ["ISO-14001", "EcoVadis Gold", "Conflict-Free Minerals"],
    riskStatus: "GREEN",
    source: "SEEDED_DIRECTORY",
  }),
  AlternativeCandidateSchema.parse({
    orgId: "90000001-0001-4001-8001-000000000003",
    name: "Baltic Copper & Cable AS",
    countryCode: "EE",
    capabilities: [
      "Copper Wiring",
      "Shielded Harnesses",
      "Industrial Connectors",
    ],
    esgBadges: ["ISO-14001", "EU-CSRD-READY", "Green Baltic Certified"],
    riskStatus: "GREEN",
    source: "SEEDED_DIRECTORY",
  }),
  AlternativeCandidateSchema.parse({
    orgId: "90000001-0001-4001-8001-000000000004",
    name: "RheinPolymer Precision GmbH",
    countryCode: "DE",
    capabilities: [
      "Industrial Polymers",
      "Bio-Based Enclosures",
      "Injection Molding",
    ],
    esgBadges: ["ISO-14001", "ISCC Plus", "EU-CSRD-READY"],
    riskStatus: "GREEN",
    source: "SEEDED_DIRECTORY",
  }),
  AlternativeCandidateSchema.parse({
    orgId: "90000001-0001-4001-8001-000000000005",
    name: "Vistula Cell & Pack Sp. z o.o.",
    countryCode: "PL",
    capabilities: [
      "Battery Cells",
      "Lithium Pack Assembly",
      "Thermal Management",
    ],
    esgBadges: ["EU Battery Passport Ready", "ISO-14001"],
    riskStatus: "GREEN",
    source: "SEEDED_DIRECTORY",
  }),
  AlternativeCandidateSchema.parse({
    orgId: "90000001-0001-4001-8001-000000000006",
    name: "Kaunas Fasteners & Steel UAB",
    countryCode: "LT",
    capabilities: [
      "Steel Fasteners",
      "Cold-Rolled Steel",
      "Corrosion-Resistant Hardware",
    ],
    esgBadges: ["ISO-14001", "CBAM Verified"],
    riskStatus: "GREEN",
    source: "SEEDED_DIRECTORY",
  }),
  AlternativeCandidateSchema.parse({
    orgId: "90000001-0001-4001-8001-000000000007",
    name: "Fjord Silicon & Wafers AS",
    countryCode: "NO",
    capabilities: [
      "Semiconductor Substrates",
      "Precision Electronics",
      "Industrial Sensors",
    ],
    esgBadges: ["100% Renewable", "EcoVadis Platinum", "EU-CSRD-READY"],
    riskStatus: "GREEN",
    source: "SEEDED_DIRECTORY",
  }),
  AlternativeCandidateSchema.parse({
    orgId: "90000001-0001-4001-8001-000000000008",
    name: "Danube Metals Trading SRL",
    countryCode: "RO",
    capabilities: ["Raw Steel", "Aluminum Alloys", "Bulk Ore Logistics"],
    esgBadges: ["ISO-9001"],
    riskStatus: "YELLOW",
    source: "SEEDED_DIRECTORY",
  }),
];

function resolveCountryRiskStatus(
  countryCode: string,
  riskSignals: readonly RiskSignal[],
): RiskStatus {
  let status: RiskStatus = "GREEN";
  for (const signal of riskSignals) {
    if (!signal.active) continue;
    if (!signal.affectedCountryCodes.includes(countryCode)) continue;
    if (signal.severity === "RED") {
      return "RED";
    }
    if (signal.severity === "YELLOW") {
      status = "YELLOW";
    }
  }
  return status;
}

export interface DirectoryRepository {
  listAlternatives(
    requesterOrgId: string,
    filters?: DirectoryFilters,
  ): Promise<AlternativeCandidate[]>;
}

export interface DirectoryRepositoryDeps {
  authRepo: AuthRepository;
  riskSignalRepo: RiskSignalRepository;
}

/**
 * Opt-in Alternative Supplier Directory repository.
 * Combines seeded EU/Nordic alternatives with Kulgo organizations that
 * explicitly opted in (`openToNewBuyers = true`).
 *
 * Strictly returns `AlternativeCandidateSchema` DTOs and NEVER reveals
 * existing buyers, private supply lanes, emails, or facility coordinates.
 */
export class KulgoDirectoryRepository implements DirectoryRepository {
  private readonly authRepo: AuthRepository;
  private readonly riskSignalRepo: RiskSignalRepository;

  constructor(deps: DirectoryRepositoryDeps) {
    this.authRepo = deps.authRepo;
    this.riskSignalRepo = deps.riskSignalRepo;
  }

  async listAlternatives(
    requesterOrgId: string,
    filters: DirectoryFilters = {},
  ): Promise<AlternativeCandidate[]> {
    const [optInOrgs, riskSignals] = await Promise.all([
      this.authRepo.listDirectoryOrganizations(),
      this.riskSignalRepo.listActive(),
    ]);

    const kulgoCandidates: AlternativeCandidate[] = optInOrgs
      .filter((org) => org.orgId !== requesterOrgId)
      .map((org) =>
        AlternativeCandidateSchema.parse({
          orgId: org.orgId,
          name: org.name,
          countryCode: org.countryCode,
          capabilities:
            org.capabilities.length > 0 ? org.capabilities : [org.sector],
          esgBadges: org.esgBadges,
          riskStatus: resolveCountryRiskStatus(org.countryCode, riskSignals),
          source: "KULGO_DIRECTORY",
        }),
      );

    let candidates: AlternativeCandidate[] = [
      ...kulgoCandidates,
      ...SEEDED_EU_ALTERNATIVES.map((item) => ({
        ...item,
        capabilities: [...item.capabilities],
        esgBadges: [...item.esgBadges],
      })),
    ];

    if (filters.countryCode) {
      const normalizedCountry = filters.countryCode.trim().toUpperCase();
      candidates = candidates.filter(
        (c) => c.countryCode === normalizedCountry,
      );
    }

    if (filters.capability) {
      const needle = filters.capability.trim().toLowerCase();
      candidates = candidates.filter(
        (c) =>
          c.capabilities.some((cap) => cap.toLowerCase().includes(needle)) ||
          c.name.toLowerCase().includes(needle),
      );
    }

    if (filters.excludeRed) {
      candidates = candidates.filter((c) => c.riskStatus !== "RED");
    }

    const riskOrder: Record<RiskStatus, number> = { GREEN: 0, YELLOW: 1, RED: 2 };
    candidates.sort((a, b) => {
      if (a.source !== b.source) {
        return a.source === "KULGO_DIRECTORY" ? -1 : 1;
      }
      if (riskOrder[a.riskStatus] !== riskOrder[b.riskStatus]) {
        return riskOrder[a.riskStatus] - riskOrder[b.riskStatus];
      }
      return a.name.localeCompare(b.name);
    });

    return candidates.map((item) => AlternativeCandidateSchema.parse(item));
  }
}

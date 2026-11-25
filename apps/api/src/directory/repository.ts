import {
  AlternativeCandidateSchema,
  AlternativeCatalogueSnippetSchema,
  AlternativeMatchSchema,
  FacilityAlternativesResponseSchema,
  KULGO_TAXONOMY_BY_CODE,
  inferUnitFamilyFromVolumeUnit,
  matchStandardizedCategories,
  tokenizeMaterialText,
  type AlternativeCandidate,
  type AlternativeCatalogueSnippet,
  type AlternativeMatch,
  type CatalogueItem,
  type FacilityAlternativesResponse,
  type RiskSignal,
  type RiskStatus,
  type StandardizedCategoryCode,
  type UnitFamily,
} from "@kulgo/shared";
import type { RiskSignalRepository } from "../analytics/risk-signals.js";
import type { AuthRepository } from "../auth/repository.js";
import type { WorkspaceRepository } from "../workspace/repository.js";
import type { CatalogueRepository } from "./catalogue-repository.js";

export interface DirectoryFilters {
  countryCode?: string;
  capability?: string;
  excludeRed?: boolean;
}

/**
 * Coarse country centroid coordinates (public geography only) used to estimate
 * directional transport distance and CO2e deltas for alternative suppliers
 * without ever exposing private supplier facility coordinates.
 */
const COUNTRY_CENTROIDS: Readonly<Record<string, readonly [number, number]>> = {
  EE: [59.437, 24.7536],
  FI: [60.1699, 24.9384],
  SE: [59.3293, 18.0686],
  LV: [56.9496, 24.1052],
  LT: [54.6872, 25.2797],
  NO: [59.9139, 10.7522],
  DK: [55.6761, 12.5683],
  DE: [52.52, 13.405],
  PL: [52.2297, 21.0122],
  NL: [52.3676, 4.9041],
  BE: [50.8503, 4.3517],
  FR: [48.8566, 2.3522],
  GB: [51.5074, -0.1278],
  RO: [44.4268, 26.1025],
  CZ: [50.0755, 14.4378],
  AT: [48.2082, 16.3738],
  IT: [45.4642, 9.19],
  ES: [40.4168, -3.7038],
  US: [39.8283, -98.5795],
  CN: [31.2304, 121.4737],
  TW: [25.033, 121.5654],
  KR: [37.5665, 126.978],
  JP: [35.6762, 139.6503],
  IN: [19.076, 72.8777],
};

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

function toCatalogueSnippet(item: CatalogueItem): AlternativeCatalogueSnippet {
  const def = KULGO_TAXONOMY_BY_CODE.get(item.standardizedCategory);
  return AlternativeCatalogueSnippetSchema.parse({
    itemId: item.itemId,
    standardizedCategory: item.standardizedCategory,
    categoryLabel: def?.label ?? item.standardizedCategory,
    productTitle: item.productTitle,
    baseUnit: item.baseUnit,
    unitFamily: item.unitFamily,
    productEmissionFactorTco2ePerUnit: item.productEmissionFactorTco2ePerUnit,
    pcfVerified: item.pcfVerified,
    specs: item.specs,
    leadTimeDays: item.leadTimeDays,
    moq: item.moq,
    capacityBand: item.capacityBand,
    certifications: item.certifications,
  });
}

function jaccardSimilarity(tokensA: Set<string>, tokensB: Set<string>): number {
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection += 1;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DirectoryRepository {
  listAlternatives(
    requesterOrgId: string,
    filters?: DirectoryFilters,
  ): Promise<AlternativeCandidate[]>;
  listAlternativesForFacility(
    requesterOrgId: string,
    facilityId: string,
  ): Promise<FacilityAlternativesResponse | null>;
}

export interface DirectoryRepositoryDeps {
  authRepo: AuthRepository;
  riskSignalRepo: RiskSignalRepository;
  workspaceRepo?: WorkspaceRepository;
  catalogueRepo?: CatalogueRepository;
}

/**
 * Opt-in Alternative Supplier Directory repository.
 * Combines seeded EU/Nordic alternatives with Kulgo organizations that
 * explicitly opted in (`openToNewBuyers = true`) and their public Product Catalogues.
 *
 * Strictly returns `AlternativeCandidateSchema` / `AlternativeMatchSchema` DTOs
 * and NEVER reveals existing buyers, private supply lanes, emails, or facility coordinates.
 */
export class KulgoDirectoryRepository implements DirectoryRepository {
  private readonly authRepo: AuthRepository;
  private readonly riskSignalRepo: RiskSignalRepository;
  private readonly workspaceRepo?: WorkspaceRepository;
  private readonly catalogueRepo?: CatalogueRepository;

  constructor(deps: DirectoryRepositoryDeps) {
    this.authRepo = deps.authRepo;
    this.riskSignalRepo = deps.riskSignalRepo;
    this.workspaceRepo = deps.workspaceRepo;
    this.catalogueRepo = deps.catalogueRepo;
  }

  async listAlternatives(
    requesterOrgId: string,
    filters: DirectoryFilters = {},
  ): Promise<AlternativeCandidate[]> {
    const [optInOrgs, riskSignals] = await Promise.all([
      this.authRepo.listDirectoryOrganizations(),
      this.riskSignalRepo.listActive(),
    ]);

    const otherOptInOrgs = optInOrgs.filter(
      (org) => org.orgId !== requesterOrgId,
    );
    const catalogueItems = this.catalogueRepo
      ? await this.catalogueRepo.listByOrgIds(otherOptInOrgs.map((o) => o.orgId))
      : [];
    const catalogueByOrg = new Map<string, CatalogueItem[]>();
    for (const item of catalogueItems) {
      const list = catalogueByOrg.get(item.orgId) ?? [];
      list.push(item);
      catalogueByOrg.set(item.orgId, list);
    }

    const kulgoCandidates: AlternativeCandidate[] = otherOptInOrgs.map((org) => {
      const orgItems = catalogueByOrg.get(org.orgId) ?? [];
      const catLabels = orgItems.map(
        (i) =>
          KULGO_TAXONOMY_BY_CODE.get(i.standardizedCategory)?.label ??
          i.productTitle,
      );
      const mergedCapabilities = Array.from(
        new Set([
          ...org.capabilities,
          ...catLabels,
          ...(org.capabilities.length === 0 && catLabels.length === 0
            ? [org.sector]
            : []),
        ]),
      );
      return AlternativeCandidateSchema.parse({
        orgId: org.orgId,
        name: org.name,
        countryCode: org.countryCode,
        capabilities: mergedCapabilities,
        esgBadges: org.esgBadges,
        riskStatus: resolveCountryRiskStatus(org.countryCode, riskSignals),
        source: "KULGO_DIRECTORY",
      });
    });

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
      const needleCategories = new Set(
        matchStandardizedCategories(needle).map((m) => m.code),
      );
      candidates = candidates.filter((c) => {
        if (
          c.capabilities.some((cap) => cap.toLowerCase().includes(needle)) ||
          c.name.toLowerCase().includes(needle)
        ) {
          return true;
        }
        if (needleCategories.size > 0) {
          for (const cap of c.capabilities) {
            if (
              matchStandardizedCategories(cap).some((m) =>
                needleCategories.has(m.code),
              )
            ) {
              return true;
            }
          }
        }
        return false;
      });
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

  async listAlternativesForFacility(
    requesterOrgId: string,
    facilityId: string,
  ): Promise<FacilityAlternativesResponse | null> {
    if (!this.workspaceRepo) {
      return null;
    }

    const [network, optInOrgs, riskSignals] = await Promise.all([
      this.workspaceRepo.getNetwork(requesterOrgId),
      this.authRepo.listDirectoryOrganizations(),
      this.riskSignalRepo.listActive(),
    ]);

    const facility = network.facilities.find((f) => f.facilityId === facilityId);
    if (!facility) {
      return null;
    }

    // Connected lanes for this supplier facility
    const connectedLanes = network.lanes.filter(
      (l) =>
        l.fromFacilityId === facilityId || l.toFacilityId === facilityId,
    );

    const materialCategories = Array.from(
      new Set(
        connectedLanes
          .map((l) => l.materialCategory.trim())
          .filter((c) => c.length > 0),
      ),
    );
    if (materialCategories.length === 0 && facility.sector) {
      materialCategories.push(facility.sector);
    }

    const targetCategories = new Set<StandardizedCategoryCode>();
    for (const mat of materialCategories) {
      for (const m of matchStandardizedCategories(mat)) {
        if (m.score >= 60) {
          targetCategories.add(m.code);
        }
      }
    }

    const targetUnitFamilies = new Set<UnitFamily>();
    for (const lane of connectedLanes) {
      targetUnitFamilies.add(inferUnitFamilyFromVolumeUnit(lane.volumeUnit));
    }

    const targetTokens = new Set<string>();
    for (const mat of materialCategories) {
      for (const tok of tokenizeMaterialText(mat)) {
        targetTokens.add(tok);
      }
    }

    // Determine buyer destination coordinates (own facility receiving from this supplier)
    const ownFacilities = network.facilities.filter((f) => f.isOwnFacility);
    const destFacility =
      connectedLanes
        .map((l) =>
          network.facilities.find(
            (f) => f.facilityId === l.toFacilityId && f.isOwnFacility,
          ),
        )
        .find((f): f is NonNullable<typeof f> => Boolean(f)) ??
      ownFacilities[0] ??
      null;

    // Baseline distance & annual tonnes for transport CO2e delta estimation
    const currentDistanceKm =
      connectedLanes.find((l) => l.distanceKm !== null)?.distanceKm ??
      (destFacility
        ? Math.round(
            haversineKm(
              facility.lat,
              facility.lng,
              destFacility.lat,
              destFacility.lng,
            ),
          )
        : null);

    const annualMassTonnes = (() => {
      const volLane = connectedLanes.find((l) => l.annualVolume !== null);
      if (!volLane || volLane.annualVolume === null) return 100;
      if (volLane.volumeUnit === "KG") return volLane.annualVolume / 1000;
      if (volLane.volumeUnit === "TONNES") return volLane.annualVolume;
      return 100;
    })();

    // Exclude buyer's own org and any linked partner org on this facility
    const excludedOrgIds = new Set<string>([requesterOrgId]);
    // Also exclude by exact normalized name match with the current supplier
    const currentSupplierNameLower = facility.name.trim().toLowerCase();

    const eligibleOptInOrgs = optInOrgs.filter(
      (org) =>
        !excludedOrgIds.has(org.orgId) &&
        org.name.trim().toLowerCase() !== currentSupplierNameLower,
    );

    const catalogueItems = this.catalogueRepo
      ? await this.catalogueRepo.listByOrgIds(
          eligibleOptInOrgs.map((o) => o.orgId),
        )
      : [];
    const catalogueByOrg = new Map<string, CatalogueItem[]>();
    for (const item of catalogueItems) {
      const list = catalogueByOrg.get(item.orgId) ?? [];
      list.push(item);
      catalogueByOrg.set(item.orgId, list);
    }

    const computeGeoDeltas = (
      candidateCountryCode: string,
    ): {
      estimatedDistanceKm: number | null;
      distanceDeltaKm: number | null;
      estimatedTransportCo2eDeltaT: number | null;
    } => {
      const centroid = COUNTRY_CENTROIDS[candidateCountryCode.toUpperCase()];
      if (!destFacility || !centroid) {
        return {
          estimatedDistanceKm: null,
          distanceDeltaKm: null,
          estimatedTransportCo2eDeltaT: null,
        };
      }
      const estDist = Math.round(
        haversineKm(centroid[0], centroid[1], destFacility.lat, destFacility.lng),
      );
      if (currentDistanceKm === null) {
        return {
          estimatedDistanceKm: estDist,
          distanceDeltaKm: null,
          estimatedTransportCo2eDeltaT: null,
        };
      }
      const deltaKm = Math.round(estDist - currentDistanceKm);
      // Road/multimodal freight intensity ~0.000062 tCO2e per tonne-km
      const co2Delta =
        Math.round(deltaKm * annualMassTonnes * 0.000062 * 100) / 100;
      return {
        estimatedDistanceKm: estDist,
        distanceDeltaKm: deltaKm,
        estimatedTransportCo2eDeltaT: co2Delta,
      };
    };

    const matches: AlternativeMatch[] = [];

    // 1. Score opted-in Kulgo organizations + their Product Catalogues
    for (const org of eligibleOptInOrgs) {
      const orgItems = catalogueByOrg.get(org.orgId) ?? [];
      const matchedItems: CatalogueItem[] = [];
      let bestScore = 0;
      let matchReason = "";

      for (const item of orgItems) {
        const catMatch = targetCategories.has(item.standardizedCategory);
        const unitCompat =
          targetUnitFamilies.size === 0 ||
          targetUnitFamilies.has(item.unitFamily);
        const itemTokens = new Set([
          ...tokenizeMaterialText(item.productTitle),
          ...item.specs.flatMap(tokenizeMaterialText),
        ]);
        const tagSim = jaccardSimilarity(targetTokens, itemTokens);

        if (catMatch) {
          matchedItems.push(item);
          const itemScore = Math.min(
            100,
            (unitCompat ? 92 : 78) + Math.round(tagSim * 8),
          );
          if (itemScore > bestScore) {
            bestScore = itemScore;
            const label =
              KULGO_TAXONOMY_BY_CODE.get(item.standardizedCategory)?.label ??
              item.standardizedCategory;
            matchReason = unitCompat
              ? `Catalogue match: ${label} (${item.unitFamily})`
              : `Catalogue category match: ${label}`;
          }
        } else if (tagSim >= 0.25) {
          matchedItems.push(item);
          const itemScore = Math.min(82, Math.round(55 + tagSim * 30));
          if (itemScore > bestScore) {
            bestScore = itemScore;
            matchReason = `Catalogue spec similarity: ${item.productTitle}`;
          }
        }
      }

      // Fallback to org capabilities if no catalogue item matched
      if (bestScore === 0) {
        for (const cap of org.capabilities) {
          const capCats = matchStandardizedCategories(cap);
          const hit = capCats.find(
            (m) => m.score >= 60 && targetCategories.has(m.code),
          );
          if (hit) {
            bestScore = Math.max(bestScore, 75);
            const label =
              KULGO_TAXONOMY_BY_CODE.get(hit.code)?.label ?? hit.code;
            matchReason = `Capability match: ${label}`;
          } else {
            const sim = jaccardSimilarity(
              targetTokens,
              new Set(tokenizeMaterialText(cap)),
            );
            if (sim >= 0.3) {
              bestScore = Math.max(bestScore, Math.round(55 + sim * 20));
              matchReason = `Capability similarity: ${cap}`;
            }
          }
        }
      }

      if (bestScore > 0) {
        const riskStatus = resolveCountryRiskStatus(org.countryCode, riskSignals);
        const geo = computeGeoDeltas(org.countryCode);
        const certs = Array.from(
          new Set([
            ...org.esgBadges,
            ...matchedItems.flatMap((i) => i.certifications),
          ]),
        );
        const capabilities = Array.from(
          new Set([
            ...org.capabilities,
            ...matchedItems.map(
              (i) =>
                KULGO_TAXONOMY_BY_CODE.get(i.standardizedCategory)?.label ??
                i.productTitle,
            ),
          ]),
        );

        matches.push(
          AlternativeMatchSchema.parse({
            orgId: org.orgId,
            name: org.name,
            countryCode: org.countryCode,
            riskStatus,
            esgBadges: org.esgBadges,
            certifications: certs,
            capabilities,
            source: "KULGO_DIRECTORY",
            matchScore: bestScore,
            matchReason,
            matchedCatalogueItems: matchedItems.map(toCatalogueSnippet),
            ...geo,
          }),
        );
      }
    }

    // 2. Score seeded EU/Nordic alternatives
    for (const seeded of SEEDED_EU_ALTERNATIVES) {
      if (seeded.name.trim().toLowerCase() === currentSupplierNameLower) {
        continue;
      }
      let bestScore = 0;
      let matchReason = "";
      for (const cap of seeded.capabilities) {
        const capCats = matchStandardizedCategories(cap);
        const hit = capCats.find(
          (m) => m.score >= 60 && targetCategories.has(m.code),
        );
        if (hit) {
          bestScore = Math.max(bestScore, 80);
          const label =
            KULGO_TAXONOMY_BY_CODE.get(hit.code)?.label ?? hit.code;
          matchReason = `EU/Nordic verified match: ${label}`;
        } else {
          const sim = jaccardSimilarity(
            targetTokens,
            new Set(tokenizeMaterialText(cap)),
          );
          if (sim >= 0.3) {
            bestScore = Math.max(bestScore, Math.round(50 + sim * 25));
            matchReason = `EU/Nordic capability match: ${cap}`;
          }
        }
      }

      if (bestScore > 0) {
        const geo = computeGeoDeltas(seeded.countryCode);
        matches.push(
          AlternativeMatchSchema.parse({
            orgId: seeded.orgId,
            name: seeded.name,
            countryCode: seeded.countryCode,
            riskStatus: seeded.riskStatus,
            esgBadges: [...seeded.esgBadges],
            certifications: [...seeded.esgBadges],
            capabilities: [...seeded.capabilities],
            source: "SEEDED_DIRECTORY",
            matchScore: bestScore,
            matchReason,
            matchedCatalogueItems: [],
            ...geo,
          }),
        );
      }
    }

    const riskOrder: Record<RiskStatus, number> = { GREEN: 0, YELLOW: 1, RED: 2 };
    matches.sort((a, b) => {
      if (a.source !== b.source) {
        return a.source === "KULGO_DIRECTORY" ? -1 : 1;
      }
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      if (riskOrder[a.riskStatus] !== riskOrder[b.riskStatus]) {
        return riskOrder[a.riskStatus] - riskOrder[b.riskStatus];
      }
      const distA = a.estimatedDistanceKm ?? Number.MAX_SAFE_INTEGER;
      const distB = b.estimatedDistanceKm ?? Number.MAX_SAFE_INTEGER;
      if (distA !== distB) {
        return distA - distB;
      }
      return a.name.localeCompare(b.name);
    });

    return FacilityAlternativesResponseSchema.parse({
      facilityId,
      materialCategories,
      standardizedCategories: Array.from(targetCategories),
      count: matches.length,
      alternatives: matches,
    });
  }
}

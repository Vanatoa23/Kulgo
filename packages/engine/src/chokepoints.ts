import type {
  ChokepointCode,
  Facility,
  RiskSignal,
  RiskSignalKind,
  RiskStatus,
  SupplyLane,
  TransportMode,
} from "@kulgo/shared";
import { isPointInWktPolygon } from "./geo.js";

export interface ChokepointDefinition {
  code: ChokepointCode;
  name: string;
  region: "GLOBAL_MARITIME" | "EU_BALTIC_MARITIME" | "EU_OVERLAND_RAIL";
  modes: TransportMode[];
  polygonWkt: string;
  centroid: { lat: number; lng: number };
}

/**
 * Canonical Global & European Chokepoint Registry.
 * Pure, zero-I/O WKT bounding polygons used for corridor tagging and map overlays.
 */
export const CHOKEPOINT_REGISTRY: Record<ChokepointCode, ChokepointDefinition> = {
  SUEZ_CANAL: {
    code: "SUEZ_CANAL",
    name: "Suez Canal",
    region: "GLOBAL_MARITIME",
    modes: ["SEA", "MULTIMODAL"],
    polygonWkt: "POLYGON ((32.1 29.8, 32.7 29.8, 32.7 31.4, 32.1 31.4, 32.1 29.8))",
    centroid: { lat: 30.585, lng: 32.342 },
  },
  RED_SEA_BAB_EL_MANDEB: {
    code: "RED_SEA_BAB_EL_MANDEB",
    name: "Red Sea & Bab el-Mandeb",
    region: "GLOBAL_MARITIME",
    modes: ["SEA", "MULTIMODAL"],
    polygonWkt: "POLYGON ((42.0 12.0, 44.5 12.0, 44.5 15.5, 42.0 15.5, 42.0 12.0))",
    centroid: { lat: 12.6, lng: 43.3 },
  },
  PANAMA_CANAL: {
    code: "PANAMA_CANAL",
    name: "Panama Canal",
    region: "GLOBAL_MARITIME",
    modes: ["SEA", "MULTIMODAL"],
    polygonWkt: "POLYGON ((-80.1 8.8, -79.4 8.8, -79.4 9.5, -80.1 9.5, -80.1 8.8))",
    centroid: { lat: 9.08, lng: -79.68 },
  },
  MALACCA_STRAIT: {
    code: "MALACCA_STRAIT",
    name: "Strait of Malacca",
    region: "GLOBAL_MARITIME",
    modes: ["SEA", "MULTIMODAL"],
    polygonWkt: "POLYGON ((99.5 1.0, 104.2 1.0, 104.2 5.5, 99.5 5.5, 99.5 1.0))",
    centroid: { lat: 2.5, lng: 101.5 },
  },
  STRAIT_OF_HORMUZ: {
    code: "STRAIT_OF_HORMUZ",
    name: "Strait of Hormuz",
    region: "GLOBAL_MARITIME",
    modes: ["SEA", "MULTIMODAL"],
    polygonWkt: "POLYGON ((55.5 25.5, 57.5 25.5, 57.5 27.2, 55.5 27.2, 55.5 25.5))",
    centroid: { lat: 26.56, lng: 56.25 },
  },
  BOSPORUS_STRAIT: {
    code: "BOSPORUS_STRAIT",
    name: "Bosporus & Turkish Straits",
    region: "GLOBAL_MARITIME",
    modes: ["SEA", "MULTIMODAL"],
    polygonWkt: "POLYGON ((28.7 40.9, 29.4 40.9, 29.4 41.3, 28.7 41.3, 28.7 40.9))",
    centroid: { lat: 41.12, lng: 29.07 },
  },
  BALTIC_SEA: {
    code: "BALTIC_SEA",
    name: "Baltic Sea Maritime Corridor",
    region: "EU_BALTIC_MARITIME",
    modes: ["SEA", "MULTIMODAL"],
    polygonWkt: "POLYGON ((13.0 54.0, 29.5 54.0, 29.5 60.8, 13.0 60.8, 13.0 54.0))",
    centroid: { lat: 57.5, lng: 20.0 },
  },
  DANISH_STRAITS: {
    code: "DANISH_STRAITS",
    name: "Danish Straits (Great Belt & Øresund)",
    region: "EU_BALTIC_MARITIME",
    modes: ["SEA", "MULTIMODAL"],
    polygonWkt: "POLYGON ((10.0 54.5, 13.2 54.5, 13.2 57.8, 10.0 57.8, 10.0 54.5))",
    centroid: { lat: 55.7, lng: 11.5 },
  },
  NORTH_SEA: {
    code: "NORTH_SEA",
    name: "North Sea Port Range (Rotterdam / Hamburg / Antwerp)",
    region: "EU_BALTIC_MARITIME",
    modes: ["SEA", "MULTIMODAL"],
    polygonWkt: "POLYGON ((2.0 51.0, 9.5 51.0, 9.5 56.0, 2.0 56.0, 2.0 51.0))",
    centroid: { lat: 53.0, lng: 5.0 },
  },
  ENGLISH_CHANNEL: {
    code: "ENGLISH_CHANNEL",
    name: "English Channel / Dover Strait",
    region: "EU_BALTIC_MARITIME",
    modes: ["SEA", "MULTIMODAL"],
    polygonWkt: "POLYGON ((-2.5 49.5, 2.5 49.5, 2.5 51.4, -2.5 51.4, -2.5 49.5))",
    centroid: { lat: 50.6, lng: 0.5 },
  },
  ALPINE_BRENNER_CORRIDOR: {
    code: "ALPINE_BRENNER_CORRIDOR",
    name: "Alpine Brenner Rail & Road Corridor",
    region: "EU_OVERLAND_RAIL",
    modes: ["RAIL", "ROAD", "MULTIMODAL"],
    polygonWkt: "POLYGON ((10.8 46.5, 12.2 46.5, 12.2 47.6, 10.8 47.6, 10.8 46.5))",
    centroid: { lat: 47.0, lng: 11.5 },
  },
  ALPINE_GOTTHARD_CORRIDOR: {
    code: "ALPINE_GOTTHARD_CORRIDOR",
    name: "Alpine Gotthard Rail & Road Corridor",
    region: "EU_OVERLAND_RAIL",
    modes: ["RAIL", "ROAD", "MULTIMODAL"],
    polygonWkt: "POLYGON ((8.2 46.1, 9.2 46.1, 9.2 47.0, 8.2 47.0, 8.2 46.1))",
    centroid: { lat: 46.55, lng: 8.6 },
  },
  RHINE_VALLEY_CORRIDOR: {
    code: "RHINE_VALLEY_CORRIDOR",
    name: "Rhine Valley Corridor",
    region: "EU_OVERLAND_RAIL",
    modes: ["RAIL", "ROAD", "MULTIMODAL"],
    polygonWkt: "POLYGON ((6.5 47.5, 8.8 47.5, 8.8 51.8, 6.5 51.8, 6.5 47.5))",
    centroid: { lat: 49.9, lng: 7.8 },
  },
  BALTIC_VIA_BALTICA_CORRIDOR: {
    code: "BALTIC_VIA_BALTICA_CORRIDOR",
    name: "Via Baltica & Rail Baltica Corridor",
    region: "EU_OVERLAND_RAIL",
    modes: ["RAIL", "ROAD", "MULTIMODAL"],
    polygonWkt: "POLYGON ((20.5 52.0, 26.5 52.0, 26.5 59.6, 20.5 59.6, 20.5 52.0))",
    centroid: { lat: 55.8, lng: 23.8 },
  },
  EU_EASTERN_BORDER_CORRIDOR: {
    code: "EU_EASTERN_BORDER_CORRIDOR",
    name: "EU Eastern Border Freight Corridor",
    region: "EU_OVERLAND_RAIL",
    modes: ["RAIL", "ROAD", "MULTIMODAL"],
    polygonWkt: "POLYGON ((22.5 49.0, 28.5 49.0, 28.5 59.6, 22.5 59.6, 22.5 49.0))",
    centroid: { lat: 54.0, lng: 25.5 },
  },
};

const BALTIC_COUNTRIES = new Set(["EE", "LV", "LT", "FI", "SE", "PL"]);
const NORTH_SEA_COUNTRIES = new Set(["NL", "BE", "DE", "GB", "NO", "DK"]);
const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "NO", "CH", "GB",
]);
const EAST_ASIA_COUNTRIES = new Set(["CN", "JP", "KR", "TW", "VN", "TH", "MY", "SG", "ID", "PH", "HK"]);
const SOUTH_ASIA_COUNTRIES = new Set(["IN", "BD", "PK", "LK"]);
const PERSIAN_GULF_COUNTRIES = new Set(["AE", "SA", "QA", "KW", "BH", "OM", "IQ"]);
const BLACK_SEA_COUNTRIES = new Set(["UA", "RO", "BG", "GE", "TR"]);
const AMERICAS_COUNTRIES = new Set(["US", "CA", "MX", "BR", "CL", "PE", "CO", "PA"]);
const EU_EASTERN_NEIGHBORS = new Set(["UA", "BY", "RU", "MD"]);

function isMaritimeMode(mode: TransportMode): boolean {
  return mode === "SEA" || mode === "MULTIMODAL";
}

function isOverlandMode(mode: TransportMode): boolean {
  return mode === "RAIL" || mode === "ROAD" || mode === "MULTIMODAL";
}

/**
 * Pure heuristic corridor tagger: infers canonical chokepoints traversed by a
 * transport lane based on origin/destination country codes and transport mode.
 */
export function inferLaneChokepoints(
  fromCountryCode: string,
  toCountryCode: string,
  transportMode: TransportMode,
): ChokepointCode[] {
  const a = fromCountryCode.toUpperCase();
  const b = toCountryCode.toUpperCase();
  const pair = new Set([a, b]);
  const hasAny = (set: Set<string>) => set.has(a) || set.has(b);
  const bothIn = (set: Set<string>) => set.has(a) && set.has(b);
  const crosses = (set1: Set<string>, set2: Set<string>) =>
    (set1.has(a) && set2.has(b)) || (set2.has(a) && set1.has(b));

  const tags = new Set<ChokepointCode>();

  if (isMaritimeMode(transportMode)) {
    // Asia <-> Europe
    if (crosses(EAST_ASIA_COUNTRIES, EU_COUNTRIES)) {
      tags.add("MALACCA_STRAIT");
      tags.add("RED_SEA_BAB_EL_MANDEB");
      tags.add("SUEZ_CANAL");
    } else if (crosses(SOUTH_ASIA_COUNTRIES, EU_COUNTRIES)) {
      tags.add("RED_SEA_BAB_EL_MANDEB");
      tags.add("SUEZ_CANAL");
    }

    // Persian Gulf <-> Europe / Asia
    if (hasAny(PERSIAN_GULF_COUNTRIES) && !bothIn(PERSIAN_GULF_COUNTRIES)) {
      tags.add("STRAIT_OF_HORMUZ");
      if (hasAny(EU_COUNTRIES)) {
        tags.add("RED_SEA_BAB_EL_MANDEB");
        tags.add("SUEZ_CANAL");
      }
    }

    // Black Sea <-> Non-Black Sea
    if (hasAny(BLACK_SEA_COUNTRIES) && !bothIn(BLACK_SEA_COUNTRIES)) {
      tags.add("BOSPORUS_STRAIT");
    }

    // East Asia <-> Americas
    if (crosses(EAST_ASIA_COUNTRIES, AMERICAS_COUNTRIES)) {
      tags.add("PANAMA_CANAL");
    }

    // Baltic Sea & Danish Straits
    if (bothIn(BALTIC_COUNTRIES)) {
      tags.add("BALTIC_SEA");
    } else if (hasAny(BALTIC_COUNTRIES)) {
      tags.add("BALTIC_SEA");
      tags.add("DANISH_STRAITS");
      if (hasAny(NORTH_SEA_COUNTRIES) || !bothIn(EU_COUNTRIES)) {
        tags.add("NORTH_SEA");
      }
    } else if (hasAny(NORTH_SEA_COUNTRIES) && !bothIn(NORTH_SEA_COUNTRIES)) {
      tags.add("NORTH_SEA");
    }

    // English Channel (GB <-> Continental EU or Atlantic <-> North Sea)
    if (
      (pair.has("GB") && hasAny(EU_COUNTRIES) && a !== b) ||
      (crosses(NORTH_SEA_COUNTRIES, AMERICAS_COUNTRIES)) ||
      (crosses(NORTH_SEA_COUNTRIES, EAST_ASIA_COUNTRIES))
    ) {
      tags.add("ENGLISH_CHANNEL");
    }
  }

  if (isOverlandMode(transportMode)) {
    // Via Baltica (Baltics <-> Poland / Central EU)
    const balticThree = new Set(["EE", "LV", "LT"]);
    if (
      (hasAny(balticThree) && hasAny(new Set(["PL", "DE", "CZ", "SK", "NL", "BE", "AT", "FR", "IT"]))) ||
      (bothIn(balticThree) && a !== b)
    ) {
      tags.add("BALTIC_VIA_BALTICA_CORRIDOR");
    }

    // EU Eastern Border
    if (crosses(EU_COUNTRIES, EU_EASTERN_NEIGHBORS)) {
      tags.add("EU_EASTERN_BORDER_CORRIDOR");
    }

    // Alpine corridors (Italy <-> Germany/Austria/Switzerland/North)
    if (crosses(new Set(["IT"]), new Set(["DE", "AT", "PL", "CZ", "DK", "SE", "NL"]))) {
      tags.add("ALPINE_BRENNER_CORRIDOR");
    }
    if (crosses(new Set(["IT"]), new Set(["CH", "BE", "FR", "NL", "DE"]))) {
      tags.add("ALPINE_GOTTHARD_CORRIDOR");
    }

    // Rhine Valley (NL/BE <-> DE/CH/FR)
    if (crosses(new Set(["NL", "BE"]), new Set(["DE", "CH", "AT", "IT"]))) {
      tags.add("RHINE_VALLEY_CORRIDOR");
    }
  }

  return Array.from(tags);
}

export function isSignalActive(signal: RiskSignal, nowIso?: string): boolean {
  if (!signal.active || signal.lifecycle === "RESOLVED") {
    return false;
  }
  if (signal.expiresAt && nowIso) {
    return Date.parse(signal.expiresAt) > Date.parse(nowIso);
  }
  return true;
}

export interface FacilitySignalMatch {
  facilityId: string;
  signalId: string;
  matchType: "POLYGON" | "COUNTRY" | "REGION" | "SECTOR";
  severity: RiskStatus;
}

export interface LaneSignalMatch {
  laneId: string;
  signalId: string;
  matchedChokepoints: ChokepointCode[];
  severity: RiskStatus;
}

export interface AnonymizedPartnerRegionAlert {
  signalId: string;
  kind: RiskSignalKind;
  severity: RiskStatus;
  title: string;
  countryCode: string | null;
  regionCode: string | null;
  matchedChokepoints: ChokepointCode[];
}

/**
 * Layer 1: Match active RiskSignals against Tier-1 facilities via WKT polygon
 * intersection, countryCode, regionCode, or sector.
 */
export function matchFacilityRiskSignals(
  facilities: (Pick<Facility, "facilityId" | "lat" | "lng" | "countryCode" | "regionCode"> & Partial<Pick<Facility, "sector">>)[],
  signals: RiskSignal[],
  nowIso?: string,
): FacilitySignalMatch[] {
  const activeSignals = signals.filter((s) => isSignalActive(s, nowIso));
  const matches: FacilitySignalMatch[] = [];

  for (const facility of facilities) {
    for (const signal of activeSignals) {
      if (isPointInWktPolygon(facility.lat, facility.lng, signal.polygonWkt)) {
        matches.push({
          facilityId: facility.facilityId,
          signalId: signal.signalId,
          matchType: "POLYGON",
          severity: signal.severity,
        });
        continue;
      }

      if (
        signal.affectedCountryCodes.includes(facility.countryCode.toUpperCase())
      ) {
        matches.push({
          facilityId: facility.facilityId,
          signalId: signal.signalId,
          matchType: "COUNTRY",
          severity: signal.severity,
        });
        continue;
      }

      if (
        facility.regionCode &&
        signal.regionCode &&
        facility.regionCode.toUpperCase() === signal.regionCode.toUpperCase()
      ) {
        matches.push({
          facilityId: facility.facilityId,
          signalId: signal.signalId,
          matchType: "REGION",
          severity: signal.severity,
        });
        continue;
      }

      if (facility.sector && signal.affectedSectors.includes(facility.sector)) {
        matches.push({
          facilityId: facility.facilityId,
          signalId: signal.signalId,
          matchType: "SECTOR",
          severity: signal.severity,
        });
      }
    }
  }

  return matches;
}

/**
 * Layer 2: Match active RiskSignals against transport lanes via canonical
 * chokepoint corridor tagging.
 */
export function matchLaneRiskSignals(
  lanes: Pick<SupplyLane, "laneId" | "fromFacilityId" | "toFacilityId" | "transportMode">[],
  facilitiesById: Map<string, Pick<Facility, "countryCode">>,
  signals: RiskSignal[],
  nowIso?: string,
): LaneSignalMatch[] {
  const activeSignals = signals.filter(
    (s) => isSignalActive(s, nowIso) && s.affectedChokepoints.length > 0 &&
      // A geographically targeted sanctions advisory must not expand to every
      // supplier using the same broad corridor. Layer 1 matches its targets.
      (s.kind !== "SANCTIONS" ||
        (s.affectedCountryCodes.length === 0 && !s.regionCode)),
  );
  const matches: LaneSignalMatch[] = [];

  for (const lane of lanes) {
    const from = facilitiesById.get(lane.fromFacilityId);
    const to = facilitiesById.get(lane.toFacilityId);
    if (!from || !to) continue;

    const laneChokepoints = inferLaneChokepoints(
      from.countryCode,
      to.countryCode,
      lane.transportMode,
    );
    if (laneChokepoints.length === 0) continue;

    for (const signal of activeSignals) {
      const intersection = laneChokepoints.filter((cp) =>
        signal.affectedChokepoints.includes(cp),
      );
      if (intersection.length > 0) {
        matches.push({
          laneId: lane.laneId,
          signalId: signal.signalId,
          matchedChokepoints: intersection,
          severity: signal.severity,
        });
      }
    }
  }

  return matches;
}

/**
 * Shared lane relevance for analytics and finance, including hidden partner
 * evaluation. Each signal contributes once across all matching layers.
 */
export function matchNetworkRiskSignals(
  lanes: readonly SupplyLane[],
  facilities: readonly Facility[],
  signals: readonly RiskSignal[],
  nowIso: string,
): Map<string, RiskSignal[]> {
  const activeSignals = signals.filter((s) => isSignalActive(s, nowIso));
  const facilitiesById = new Map(facilities.map((f) => [f.facilityId, f]));
  const facilityMatches = matchFacilityRiskSignals([...facilities], activeSignals, nowIso);
  const laneMatches = matchLaneRiskSignals([...lanes], facilitiesById, activeSignals, nowIso);
  const byFacility = new Map<string, Set<string>>();
  const byLane = new Map<string, Set<string>>();
  for (const match of facilityMatches) {
    const ids = byFacility.get(match.facilityId) ?? new Set<string>();
    ids.add(match.signalId);
    byFacility.set(match.facilityId, ids);
  }
  for (const match of laneMatches) {
    const ids = byLane.get(match.laneId) ?? new Set<string>();
    ids.add(match.signalId);
    byLane.set(match.laneId, ids);
  }
  return new Map(lanes.map((lane) => [
    lane.laneId,
    activeSignals.filter((signal) =>
      byFacility.get(lane.fromFacilityId)?.has(signal.signalId) ||
      byLane.get(lane.laneId)?.has(signal.signalId),
    ),
  ]));
}

/**
 * Layer 3 (Privacy-Preserving): Intersect active RiskSignals with hidden
 * Tier-2+ partner regions/countries/chokepoints and return strictly anonymized
 * regional alerts with ZERO partner IDs, names, or coordinates.
 */
export function matchPartnerRegionRiskSignals(
  partnerRegions: Array<{
    countryCode: string;
    regionCode: string | null;
    chokepoints?: ChokepointCode[];
  }>,
  signals: RiskSignal[],
  nowIso?: string,
): AnonymizedPartnerRegionAlert[] {
  const activeSignals = signals.filter((s) => isSignalActive(s, nowIso));
  const deduped = new Map<string, AnonymizedPartnerRegionAlert>();

  for (const region of partnerRegions) {
    const cc = region.countryCode.toUpperCase();
    const rc = region.regionCode?.toUpperCase() ?? null;
    const cps = region.chokepoints ?? [];

    for (const signal of activeSignals) {
      const countryHit = signal.affectedCountryCodes.includes(cc);
      const regionHit = Boolean(
        rc && signal.regionCode && signal.regionCode.toUpperCase() === rc,
      );
      const matchedCps = cps.filter((cp) =>
        signal.affectedChokepoints.includes(cp),
      );

      if (countryHit || regionHit || matchedCps.length > 0) {
        const key = `${signal.signalId}:${cc}:${rc ?? ""}`;
        if (!deduped.has(key)) {
          deduped.set(key, {
            signalId: signal.signalId,
            kind: signal.kind,
            severity: signal.severity,
            title: signal.title,
            countryCode: countryHit ? cc : null,
            regionCode: regionHit ? rc : signal.regionCode,
            matchedChokepoints: matchedCps,
          });
        }
      }
    }
  }

  return Array.from(deduped.values());
}

import { CHOKEPOINT_REGISTRY } from "@kulgo/engine";
import {
  RiskSignalSchema,
  type ChokepointCode,
  type RiskSignal,
  type RiskStatus,
} from "@kulgo/shared";
import { computeCanonicalDedupeKey } from "../dedupe.js";

/**
 * Builds a closed WGS84 WKT POLYGON bounding box around a lat/lng point.
 */
export function buildPointBufferWkt(
  lat: number,
  lng: number,
  radiusDeg = 1.0,
): string {
  const minLng = Math.max(-180, lng - radiusDeg).toFixed(4);
  const maxLng = Math.min(180, lng + radiusDeg).toFixed(4);
  const minLat = Math.max(-90, lat - radiusDeg).toFixed(4);
  const maxLat = Math.min(90, lat + radiusDeg).toFixed(4);
  return `POLYGON ((${minLng} ${minLat}, ${maxLng} ${minLat}, ${maxLng} ${maxLat}, ${minLng} ${maxLat}, ${minLng} ${minLat}))`;
}

/**
 * Converts a GeoJSON Geometry (Polygon, MultiPolygon, or Point) into a WKT POLYGON.
 */
export function geoJsonGeometryToWkt(
  geometry: { type?: string; coordinates?: unknown } | null | undefined,
  pointRadiusDeg = 1.0,
): string | null {
  if (!geometry || !geometry.type || !geometry.coordinates) return null;

  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    const [lng, lat] = geometry.coordinates as [number, number];
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return buildPointBufferWkt(lat, lng, pointRadiusDeg);
    }
    return null;
  }

  let ring: unknown[] | null = null;
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    ring = geometry.coordinates[0] as unknown[] | null;
  } else if (
    geometry.type === "MultiPolygon" &&
    Array.isArray(geometry.coordinates)
  ) {
    const firstPoly = geometry.coordinates[0] as unknown[] | undefined;
    ring = (firstPoly?.[0] as unknown[] | undefined) ?? null;
  }

  if (!ring || ring.length < 3) return null;
  const pairs: string[] = [];
  for (const coord of ring) {
    if (!Array.isArray(coord) || coord.length < 2) continue;
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      pairs.push(`${lng} ${lat}`);
    }
  }
  if (pairs.length < 3) return null;
  if (pairs[0] !== pairs[pairs.length - 1]) {
    pairs.push(pairs[0]!);
  }
  return `POLYGON ((${pairs.join(", ")}))`;
}

// --- 1. GDACS GeoJSON Parser (UN / EC JRC) ---

interface GdacsFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    eventid?: string | number;
    eventtype?: string;
    alertlevel?: string;
    name?: string;
    description?: string;
    country?: string;
    iso3?: string;
    fromdate?: string;
    todate?: string;
    url?: { report?: string } | string;
  };
}

function mapGdacsSeverity(level?: string): RiskStatus {
  const norm = (level ?? "").toUpperCase();
  if (norm === "RED") return "RED";
  if (norm === "ORANGE" || norm === "YELLOW") return "YELLOW";
  return "GREEN";
}

export function parseGdacsGeoJson(
  payload: { features?: GdacsFeature[] },
  nowIso = new Date().toISOString(),
): RiskSignal[] {
  const signals: RiskSignal[] = [];
  for (const feature of payload.features ?? []) {
    const props = feature.properties;
    if (!props?.eventid || !props.name) continue;
    const severity = mapGdacsSeverity(props.alertlevel);
    if (severity === "GREEN") continue;

    const polygonWkt = geoJsonGeometryToWkt(feature.geometry, 1.2);
    if (!polygonWkt) continue;

    const reportUrl =
      typeof props.url === "string"
        ? props.url
        : typeof props.url?.report === "string"
          ? props.url.report
          : null;
    const publishedAt =
      props.fromdate && !Number.isNaN(Date.parse(props.fromdate))
        ? new Date(props.fromdate).toISOString()
        : nowIso;
    const expiresAt =
      props.todate && !Number.isNaN(Date.parse(props.todate))
        ? new Date(props.todate).toISOString()
        : new Date(Date.parse(nowIso) + 7 * 86_400_000).toISOString();

    const dedupeKey = computeCanonicalDedupeKey(
      "CLIMATE",
      `GDACS:${props.eventtype ?? "EVT"}:${props.eventid}`,
      publishedAt,
    );

    signals.push(
      RiskSignalSchema.parse({
        signalId: `gdacs-${props.eventtype ?? "evt"}-${props.eventid}`.toLowerCase(),
        kind: "CLIMATE",
        severity,
        title: props.name.slice(0, 200),
        description: props.description ? props.description.slice(0, 1000) : null,
        regionCode: props.country ? props.country.slice(0, 64) : null,
        affectedCountryCodes: [],
        affectedChokepoints: [],
        affectedSectors: [],
        polygonWkt,
        sourceUrls: reportUrl ? [reportUrl] : [],
        publishedAt,
        lastSeenAt: nowIso,
        expiresAt,
        resolvedAt: null,
        dedupeKey,
        confidence: 0.95,
        verificationStatus: "CONFIRMED",
        lifecycle: "ACTIVE",
        active: true,
      }),
    );
  }
  return signals;
}

// --- 2. USGS Earthquake Hazards GeoJSON Parser ---

interface UsgsFeature {
  id?: string;
  geometry?: { type?: string; coordinates?: number[] };
  properties?: {
    mag?: number;
    place?: string;
    time?: number;
    url?: string;
    alert?: string | null;
    title?: string;
  };
}

export function parseUsgsGeoJson(
  payload: { features?: UsgsFeature[] },
  nowIso = new Date().toISOString(),
): RiskSignal[] {
  const signals: RiskSignal[] = [];
  for (const feature of payload.features ?? []) {
    const props = feature.properties;
    const mag = props?.mag ?? 0;
    if (!feature.id || mag < 5.5) continue;

    const radiusDeg = mag >= 7.0 ? 2.0 : mag >= 6.2 ? 1.2 : 0.7;
    const polygonWkt = geoJsonGeometryToWkt(feature.geometry, radiusDeg);
    if (!polygonWkt) continue;

    const severity: RiskStatus =
      props?.alert === "red" || mag >= 6.8 ? "RED" : "YELLOW";
    const publishedAt =
      typeof props?.time === "number"
        ? new Date(props.time).toISOString()
        : nowIso;
    const expiresAt = new Date(
      Date.parse(publishedAt) + 5 * 86_400_000,
    ).toISOString();

    signals.push(
      RiskSignalSchema.parse({
        signalId: `usgs-${feature.id}`,
        kind: "CLIMATE",
        severity,
        title: (props?.title ?? `M${mag.toFixed(1)} Earthquake`).slice(0, 200),
        description: props?.place
          ? `USGS Earthquake M${mag.toFixed(1)} near ${props.place}.`
          : null,
        regionCode: null,
        affectedCountryCodes: [],
        affectedChokepoints: [],
        affectedSectors: [],
        polygonWkt,
        sourceUrls: props?.url ? [props.url] : [],
        publishedAt,
        lastSeenAt: nowIso,
        expiresAt,
        resolvedAt: null,
        dedupeKey: computeCanonicalDedupeKey(
          "CLIMATE",
          `USGS:${feature.id}`,
          publishedAt,
        ),
        confidence: 0.98,
        verificationStatus: "CONFIRMED",
        lifecycle: "ACTIVE",
        active: true,
      }),
    );
  }
  return signals;
}

// --- 3. IMF PortWatch ArcGIS GeoJSON Parser (28 Global Chokepoints) ---

const PORTWATCH_NAME_TO_CHOKEPOINT: Record<string, ChokepointCode> = {
  "suez canal": "SUEZ_CANAL",
  "bab el-mandeb": "RED_SEA_BAB_EL_MANDEB",
  "bab el-mandeb strait": "RED_SEA_BAB_EL_MANDEB",
  "panama canal": "PANAMA_CANAL",
  "malacca strait": "MALACCA_STRAIT",
  "strait of malacca": "MALACCA_STRAIT",
  "strait of hormuz": "STRAIT_OF_HORMUZ",
  "bosporus strait": "BOSPORUS_STRAIT",
  "danish straits": "DANISH_STRAITS",
  "dover strait": "ENGLISH_CHANNEL",
  "english channel": "ENGLISH_CHANNEL",
};

interface PortWatchFeature {
  properties?: {
    portname?: string;
    chokepoint_name?: string;
    pct_change_7d?: number;
    transit_drop_pct?: number;
    date?: string;
  };
}

export function parsePortWatchGeoJson(
  payload: { features?: PortWatchFeature[] },
  nowIso = new Date().toISOString(),
): RiskSignal[] {
  const signals: RiskSignal[] = [];
  for (const feature of payload.features ?? []) {
    const props = feature.properties;
    const rawName = (props?.chokepoint_name ?? props?.portname ?? "")
      .trim()
      .toLowerCase();
    const code = PORTWATCH_NAME_TO_CHOKEPOINT[rawName];
    if (!code) continue;

    // Positive drop percentage (e.g. transit_drop_pct = 35 or pct_change_7d = -35)
    const dropPct =
      typeof props?.transit_drop_pct === "number"
        ? props.transit_drop_pct
        : typeof props?.pct_change_7d === "number"
          ? -props.pct_change_7d
          : 0;
    if (dropPct < 25) continue;

    const cp = CHOKEPOINT_REGISTRY[code];
    const severity: RiskStatus = dropPct >= 45 ? "RED" : "YELLOW";
    const publishedAt =
      props?.date && !Number.isNaN(Date.parse(props.date))
        ? new Date(props.date).toISOString()
        : nowIso;
    const expiresAt = new Date(
      Date.parse(nowIso) + 3 * 86_400_000,
    ).toISOString();

    signals.push(
      RiskSignalSchema.parse({
        signalId: `portwatch-${code.toLowerCase()}-${publishedAt.slice(0, 10)}`,
        kind: "MARITIME_CHOKEPOINT",
        severity,
        title: `${cp.name}: ${Math.round(dropPct)}% 7-day vessel transit drop`,
        description: `IMF PortWatch detected a ${Math.round(dropPct)}% drop in 7-day rolling vessel transits through ${cp.name}.`,
        regionCode: code,
        affectedCountryCodes: [],
        affectedChokepoints: [code],
        affectedSectors: ["Maritime", "Logistics"],
        polygonWkt: cp.polygonWkt,
        sourceUrls: ["https://portwatch.imf.org/"],
        publishedAt,
        lastSeenAt: nowIso,
        expiresAt,
        resolvedAt: null,
        dedupeKey: computeCanonicalDedupeKey(
          "MARITIME_CHOKEPOINT",
          code,
          publishedAt,
        ),
        confidence: 0.95,
        verificationStatus: "CONFIRMED",
        lifecycle: "ACTIVE",
        active: true,
      }),
    );
  }
  return signals;
}

// --- 4. MeteoAlarm CAP 1.2 / Atom XML Parser (EU & Baltic) ---

function extractXmlTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = re.exec(block);
  return match?.[1] ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : null;
}

/**
 * Converts a CAP 1.2 polygon string ("lat1,lng1 lat2,lng2 ...") into WGS84 WKT POLYGON.
 */
export function capPolygonToWkt(capPolygon: string): string | null {
  const tokens = capPolygon.trim().split(/\s+/);
  const pairs: string[] = [];
  for (const token of tokens) {
    const [latStr, lngStr] = token.split(",");
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      pairs.push(`${lng} ${lat}`);
    }
  }
  if (pairs.length < 3) return null;
  if (pairs[0] !== pairs[pairs.length - 1]) {
    pairs.push(pairs[0]!);
  }
  return `POLYGON ((${pairs.join(", ")}))`;
}

export function parseMeteoAlarmAtomXml(
  xml: string,
  countryCode: string,
  nowIso = new Date().toISOString(),
): RiskSignal[] {
  const cc = countryCode.toUpperCase();
  const signals: RiskSignal[] = [];
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];

  for (const entry of entries) {
    const severityRaw = (
      extractXmlTag(entry, "cap:severity") ?? ""
    ).toLowerCase();
    if (severityRaw !== "extreme" && severityRaw !== "severe") continue;

    const title = extractXmlTag(entry, "title") ?? "Severe Weather Warning";
    const id = extractXmlTag(entry, "id") ?? `${cc}-${title.slice(0, 24)}`;
    const event = extractXmlTag(entry, "cap:event") ?? "Severe Weather";
    const areaDesc = extractXmlTag(entry, "cap:areaDesc");
    const expiresRaw = extractXmlTag(entry, "cap:expires");
    const sentRaw = extractXmlTag(entry, "cap:sent") ?? extractXmlTag(entry, "updated");
    const capPoly = extractXmlTag(entry, "cap:polygon");
    const linkMatch = /<link[^>]+href="([^"]+)"/i.exec(entry);

    const polygonWkt = capPoly
      ? capPolygonToWkt(capPoly)
      : null;
    if (!polygonWkt) continue;

    const publishedAt =
      sentRaw && !Number.isNaN(Date.parse(sentRaw))
        ? new Date(sentRaw).toISOString()
        : nowIso;
    const expiresAt =
      expiresRaw && !Number.isNaN(Date.parse(expiresRaw))
        ? new Date(expiresRaw).toISOString()
        : new Date(Date.parse(nowIso) + 2 * 86_400_000).toISOString();

    const severity: RiskStatus = severityRaw === "extreme" ? "RED" : "YELLOW";

    signals.push(
      RiskSignalSchema.parse({
        signalId: `meteoalarm-${cc.toLowerCase()}-${computeCanonicalDedupeKey("CLIMATE", id, publishedAt).slice(0, 12)}`,
        kind: "CLIMATE",
        severity,
        title: `${event} (${cc}${areaDesc ? ` — ${areaDesc}` : ""})`.slice(0, 200),
        description: title.slice(0, 1000),
        regionCode: cc,
        affectedCountryCodes: [cc],
        affectedChokepoints: [],
        affectedSectors: [],
        polygonWkt,
        sourceUrls: linkMatch?.[1] ? [linkMatch[1]] : [],
        publishedAt,
        lastSeenAt: nowIso,
        expiresAt,
        resolvedAt: null,
        dedupeKey: computeCanonicalDedupeKey(
          "CLIMATE",
          `METEOALARM:${cc}:${event}`,
          publishedAt,
        ),
        confidence: 0.96,
        verificationStatus: "CONFIRMED",
        lifecycle: "ACTIVE",
        active: true,
      }),
    );
  }

  return signals;
}

// --- Live Stage 1 Fetcher ---

export interface Stage1FetchOptions {
  fetchFn?: typeof fetch;
  meteoAlarmCountries?: readonly string[];
  nowIso?: string;
}

export async function fetchStage1Signals(
  options: Stage1FetchOptions = {},
): Promise<{ signals: RiskSignal[]; errors: string[] }> {
  const fetchFn = options.fetchFn ?? fetch;
  const nowIso = options.nowIso ?? new Date().toISOString();
  const countries = options.meteoAlarmCountries ?? ["estonia", "latvia", "lithuania", "germany", "finland"];
  const countryToIso2: Record<string, string> = {
    estonia: "EE",
    latvia: "LV",
    lithuania: "LT",
    germany: "DE",
    finland: "FI",
    poland: "PL",
    sweden: "SE",
  };

  const signals: RiskSignal[] = [];
  const errors: string[] = [];

  // 1. GDACS GeoJSON
  try {
    const res = await fetchFn(
      "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=Red;Orange&limit=50",
    );
    if (res.ok) {
      const json = (await res.json()) as { features?: GdacsFeature[] };
      signals.push(...parseGdacsGeoJson(json, nowIso));
    } else {
      errors.push(`GDACS HTTP ${res.status}`);
    }
  } catch (err) {
    errors.push(`GDACS: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. USGS Earthquakes M5.5+
  try {
    const res = await fetchFn(
      "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=5.5&limit=30",
    );
    if (res.ok) {
      const json = (await res.json()) as { features?: UsgsFeature[] };
      signals.push(...parseUsgsGeoJson(json, nowIso));
    } else {
      errors.push(`USGS HTTP ${res.status}`);
    }
  } catch (err) {
    errors.push(`USGS: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. MeteoAlarm Atom/CAP per EU/Baltic country
  for (const country of countries) {
    const iso2 = countryToIso2[country.toLowerCase()];
    if (!iso2) continue;
    try {
      const res = await fetchFn(
        `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${country.toLowerCase()}`,
      );
      if (res.ok) {
        const xml = await res.text();
        signals.push(...parseMeteoAlarmAtomXml(xml, iso2, nowIso));
      } else {
        errors.push(`MeteoAlarm(${iso2}) HTTP ${res.status}`);
      }
    } catch (err) {
      errors.push(
        `MeteoAlarm(${iso2}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { signals, errors };
}

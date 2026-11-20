export interface GeoPoint {
  lng: number;
  lat: number;
}

/**
 * Parses a WKT POLYGON string (e.g. "POLYGON ((lng1 lat1, lng2 lat2, ...))")
 * into its exterior ring coordinates. Returns an empty array if malformed.
 */
export function parseWktPolygon(wkt: string): GeoPoint[] {
  const match = /POLYGON\s*\(\s*\(([^)]+)\)/i.exec(wkt.trim());
  if (!match?.[1]) {
    return [];
  }

  const points: GeoPoint[] = [];
  for (const pair of match[1].split(",")) {
    const parts = pair.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      points.push({ lng, lat });
    }
  }
  return points;
}

/**
 * Ray-casting point-in-polygon check against a WKT POLYGON exterior ring.
 * Coordinates use standard WGS84 (lat, lng).
 */
export function isPointInWktPolygon(
  lat: number,
  lng: number,
  polygonWkt: string,
): boolean {
  const ring = parseWktPolygon(polygonWkt);
  if (ring.length < 3) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!;
    const pj = ring[j]!;
    const intersects =
      pi.lat > lat !== pj.lat > lat &&
      lng < ((pj.lng - pi.lng) * (lat - pi.lat)) / (pj.lat - pi.lat) + pi.lng;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

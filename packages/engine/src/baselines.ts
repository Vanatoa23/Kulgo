import type { TransportMode } from "@kulgo/shared";

/**
 * Default GLEC-aligned well-to-wheel freight emission factors
 * expressed in kg CO2e per tonne-kilometer.
 */
export const TRANSPORT_EMISSION_FACTORS_KG_PER_TKM: Record<
  TransportMode,
  number
> = {
  SEA: 0.016,
  RAIL: 0.028,
  ROAD: 0.096,
  AIR: 0.602,
  MULTIMODAL: 0.065,
};

/**
 * Baseline annual Scope 1+2 tCO2e estimate per unverified Tier-1 supplier
 * by broad sector (used strictly as a clearly-labelled ESTIMATED fallback).
 */
export const SECTOR_BASELINE_SCOPE12_TCO2E: Record<string, number> = {
  Electronics: 420,
  Metals: 1150,
  Chemicals: 980,
  Packaging: 260,
  Logistics: 510,
  Manufacturing: 480,
};

const EARTH_RADIUS_KM = 6371;

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_KM * c * 10) / 10;
}

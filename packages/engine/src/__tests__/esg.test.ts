import { describe, expect, it } from "vitest";
import { haversineDistanceKm } from "../baselines.js";
import { computeEsgSummary, estimateLaneCo2eTonnes } from "../esg.js";

describe("ESG & transport emission engine", () => {
  it("computes realistic Tallinn -> Shanghai great-circle distance", () => {
    const km = haversineDistanceKm(59.437, 24.7536, 31.2304, 121.4737);
    expect(km).toBeGreaterThan(7400);
    expect(km).toBeLessThan(7800);
  });

  it("estimates higher emissions for AIR than SEA over the same lane", () => {
    const sea = estimateLaneCo2eTonnes({
      distanceKm: 7600,
      annualTonnes: 100,
      transportMode: "SEA",
    });
    const air = estimateLaneCo2eTonnes({
      distanceKm: 7600,
      annualTonnes: 100,
      transportMode: "AIR",
    });
    expect(air).toBeGreaterThan(sea * 30);
  });

  it("marks ESG confidence as ESTIMATED when any Tier-1 supplier is unverified", () => {
    const summary = computeEsgSummary({
      ownScope1Tco2e: 120,
      ownScope2Tco2e: 80,
      suppliers: [
        {
          isPartnerVerified: true,
          sector: "Electronics",
          reportedScope12Tco2e: 300,
          hiddenUpstreamScope3Tco2e: 450,
        },
        {
          isPartnerVerified: false,
          sector: "Metals",
          reportedScope12Tco2e: null,
          hiddenUpstreamScope3Tco2e: null,
        },
      ],
      laneTransportCo2eTonnes: [12.5, 45.5],
    });

    expect(summary.confidence).toBe("ESTIMATED");
    expect(summary.verifiedCoveragePct).toBe(50);
    expect(summary.upstreamScope3Tco2e).toBe(300 + 450 + 1150);
    expect(summary.transportScope3Tco2e).toBe(58);
    expect(summary.totalTco2e).toBe(120 + 80 + 1900 + 58);
  });

  it("upgrades ESG confidence to NETWORK_VERIFIED when 100% of suppliers are verified", () => {
    const summary = computeEsgSummary({
      ownScope1Tco2e: 50,
      ownScope2Tco2e: 50,
      suppliers: [
        {
          isPartnerVerified: true,
          sector: "Packaging",
          reportedScope12Tco2e: 100,
          hiddenUpstreamScope3Tco2e: 200,
        },
      ],
      laneTransportCo2eTonnes: [10],
    });
    expect(summary.confidence).toBe("NETWORK_VERIFIED");
    expect(summary.verifiedCoveragePct).toBe(100);
  });

  it("handles antipodal coordinates in haversineDistanceKm without NaN", () => {
    const antipodalKm = haversineDistanceKm(0, 0, 0, 180);
    expect(Number.isFinite(antipodalKm)).toBe(true);
    // Half Earth circumference: pi * 6371 ≈ 20015.1 km
    expect(antipodalKm).toBeCloseTo(20015.1, 1);
  });

  it("guards haversineDistanceKm, estimateLaneCo2eTonnes, and computeEsgSummary against NaN and Infinity", () => {
    expect(haversineDistanceKm(NaN, 0, 10, 10)).toBe(0);
    expect(haversineDistanceKm(0, Infinity, 10, 10)).toBe(0);
    expect(haversineDistanceKm(0, 0, -Infinity, 10)).toBe(0);
    expect(haversineDistanceKm(0, 0, 10, NaN)).toBe(0);

    expect(
      estimateLaneCo2eTonnes({
        distanceKm: NaN,
        annualTonnes: 100,
        transportMode: "ROAD",
      }),
    ).toBe(0);
    expect(
      estimateLaneCo2eTonnes({
        distanceKm: 500,
        annualTonnes: Infinity,
        transportMode: "AIR",
      }),
    ).toBe(0);

    const summary = computeEsgSummary({
      ownScope1Tco2e: NaN,
      ownScope2Tco2e: Infinity,
      suppliers: [
        {
          isPartnerVerified: true,
          sector: "Electronics",
          reportedScope12Tco2e: NaN,
          hiddenUpstreamScope3Tco2e: Infinity,
        },
        {
          isPartnerVerified: false,
          sector: "Metals",
          reportedScope12Tco2e: Infinity,
          hiddenUpstreamScope3Tco2e: null,
        },
      ],
      laneTransportCo2eTonnes: [NaN, Infinity, -50, 25.5],
    });

    expect(summary.scope1Tco2e).toBe(0);
    expect(summary.scope2Tco2e).toBe(0);
    // Verified supplier with NaN/Infinity contributes 0; unverified with Infinity falls back to Metals baseline (1150)
    expect(summary.upstreamScope3Tco2e).toBe(1150);
    expect(summary.transportScope3Tco2e).toBe(25.5);
    expect(summary.totalTco2e).toBe(1175.5);
    expect(Number.isFinite(summary.totalTco2e)).toBe(true);
  });
});

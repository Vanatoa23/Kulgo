import { describe, expect, it } from "vitest";
import { computeHhi } from "../hhi.js";

describe("computeHhi", () => {
  it("flags a single-source material (100%) as SINGLE_SOURCE SPOF", () => {
    const result = computeHhi("MATERIAL", "Material B", [
      { key: "sup-b1", weight: 100 },
    ]);
    expect(result.rawHhi).toBe(10000);
    expect(result.normalizedScore).toBe(100);
    expect(result.concentrationLevel).toBe("SINGLE_SOURCE");
    expect(result.isSinglePointOfFailure).toBe(true);
  });

  it("scores a 30/70 two-supplier split (Material A) as HIGH concentration", () => {
    const result = computeHhi("MATERIAL", "Material A", [
      { key: "sup-a1", weight: 30 },
      { key: "sup-a2", weight: 70 },
    ]);
    expect(result.rawHhi).toBe(5800);
    expect(result.concentrationLevel).toBe("HIGH");
    expect(result.isSinglePointOfFailure).toBe(false);
  });

  it("scores a 20/30/50 three-supplier split (Material E) accurately", () => {
    const result = computeHhi("MATERIAL", "Material E", [
      { key: "sup-e1", weight: 20 },
      { key: "sup-e2", weight: 30 },
      { key: "sup-e3", weight: 50 },
    ]);
    expect(result.rawHhi).toBe(3800);
    expect(result.normalizedScore).toBe(38);
    expect(result.concentrationLevel).toBe("HIGH");
  });

  it("aggregates duplicate keys before squaring shares", () => {
    const result = computeHhi("COUNTRY", "Countries", [
      { key: "EE", weight: 25 },
      { key: "EE", weight: 25 },
      { key: "FI", weight: 50 },
    ]);
    expect(result.rawHhi).toBe(5000);
  });
});

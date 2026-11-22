import { randomUUID } from "node:crypto";
import { deriveNetworkCommercials } from "@kulgo/engine";
import {
  CreateContractInputSchema, CreateFacilityInputSchema,
  CreateSupplyInputInputSchema, CreateSupplyLaneInputSchema,
} from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { WorkspaceConflictError, type WorkspaceRepository } from "../../src/workspace/repository.js";

export function commercialRegressionCases(createRepo: () => WorkspaceRepository) {
  async function fixture() {
    const repo = createRepo();
    const orgId = randomUUID();
    const facilities = await Promise.all(["Source", "WH A", "WH B"].map((name) =>
      repo.createFacility(orgId, CreateFacilityInputSchema.parse({
        name, kind: "WAREHOUSE", countryCode: "EE", lat: 59, lng: 25,
        relationshipRole: "OWN", isOwnFacility: true,
      })),
    ));
    const input = await repo.createInput(orgId, CreateSupplyInputInputSchema.parse({
      name: "Copper", category: "Metals", unit: "TONNES",
    }));
    const lanes = await Promise.all(facilities.slice(1).map((to) =>
      repo.createLane(orgId, CreateSupplyLaneInputSchema.parse({
        fromFacilityId: facilities[0]!.facilityId, toFacilityId: to.facilityId,
        inputId: input.inputId, materialCategory: "Metals", volumeUnit: "TONNES",
        annualVolume: 100, annualSpendEur: 1000, volumeSharePct: 50,
      })),
    ));
    const payload = {
      contract: CreateContractInputSchema.parse({
        supplierFacilityId: facilities[0]!.facilityId, title: "Annual supply",
        contractType: "FRAMEWORK", startDate: "2026-01-01", endDate: null,
      }),
      lines: [{ laneId: lanes[0]!.laneId, cadence: "PER_YEAR" as const,
        committedVolume: 100, unit: "TONNES", committedSpend: 1000, currency: "EUR" }],
      idempotencyKey: randomUUID(),
    };
    return { repo, orgId, lanes, payload, input };
  }

  describe("Commercial review regressions", () => {
    it.each(["RUN_RATE", "PERIOD_WINDOW"] as const)(
      "preserves mixed contract/legacy sources and totals across repeated saves (%s)", async (viewMode) => {
        const { repo, orgId, lanes, payload } = await fixture();
        await repo.createContractWithLinesAtomic(orgId, payload);
        const source = await repo.getNetwork(orgId);
        for (const percentages of [[75, 25], [25, 75], [75, 25]]) {
          await repo.applyAllocationSplitsAtomic(orgId, lanes.map((lane, i) => ({
            laneId: lane.laneId, allocationSplitPct: percentages[i]!,
          })));
          const network = await repo.getNetwork(orgId);
          expect(network.lanes.map((l) => [l.laneId, l.annualVolume, l.annualSpendEur]).sort())
            .toEqual(source.lanes.map((l) => [l.laneId, l.annualVolume, l.annualSpendEur]).sort());
          expect(network.contractLines).toEqual(source.contractLines);
          const derived = deriveNetworkCommercials(network.lanes, network.inputs,
            network.contracts ?? [], network.contractLines ?? [], {
              asOfDate: "2026-01-01", viewMode, facilities: network.facilities,
              windowStart: "2026-01-01", windowEndExclusive: "2027-01-01",
            });
          for (let i = 0; i < lanes.length; i++) {
            const summary = derived.laneSummaries.get(lanes[i]!.laneId)!;
            expect(summary.activeVolume).toBeCloseTo(200 * percentages[i]! / 100, 4);
            expect(summary.activeSpendEur).toBeCloseTo(2000 * percentages[i]! / 100, 2);
          }
        }
      },
    );

    it("compares resolved material inputs on replay, including omitted/null defaults", async () => {
      const { repo, orgId, payload, input, lanes } = await fixture();
      const created = await repo.createContractWithLinesAtomic(orgId, payload);
      expect(created.lines[0]!.inputId).toBe(input.inputId);
      for (const inputId of [undefined, null, input.inputId]) {
        const replay = await repo.createContractWithLinesAtomic(orgId, {
          ...payload, lines: [{ ...payload.lines[0]!, inputId }],
        });
        expect(replay.deduplicated).toBe(true);
      }
      const other = await repo.createInput(orgId, CreateSupplyInputInputSchema.parse({
        name: "Aluminum", category: "Metals", unit: "TONNES",
      }));
      await expect(repo.createContractWithLinesAtomic(orgId, {
        ...payload, lines: [{ ...payload.lines[0]!, inputId: other.inputId }],
      })).rejects.toBeInstanceOf(WorkspaceConflictError);
      // Omission must resolve against the current lane, not blindly reuse the stored input.
      await repo.updateLane(orgId, lanes[0]!.laneId, { inputId: other.inputId });
      await expect(repo.createContractWithLinesAtomic(orgId, payload))
        .rejects.toBeInstanceOf(WorkspaceConflictError);
      expect(await repo.listContractLines(orgId)).toEqual(created.lines);
      expect(await repo.listContracts(orgId)).toHaveLength(1);
    });
  });
}

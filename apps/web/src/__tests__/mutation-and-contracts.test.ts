import { describe, expect, it, vi } from "vitest";
import { createRequestGuard } from "../lib/request-guard.js";

/**
 * Mirrors App.tsx's `runMutation` contract (#47B): returns `true` ONLY when
 * the server confirms success in the active session, and `false` on rejected
 * requests, 401s, or network failures so forms preserve user-entered drafts.
 */
function createMutationHarness() {
  const sessionGuard = createRequestGuard();
  let bannerError: string | null = null;
  let loggedOut = false;

  const runMutation = async (fn: () => Promise<void>): Promise<boolean> => {
    const ticket = sessionGuard.capture();
    bannerError = null;
    try {
      await fn();
      return ticket.isCurrent();
    } catch (err) {
      if (!ticket.isCurrent()) return false;
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        loggedOut = true;
        return false;
      }
      bannerError = err instanceof Error ? err.message : "Action failed.";
      return false;
    }
  };

  return {
    sessionGuard,
    runMutation,
    getBannerError: () => bannerError,
    isLoggedOut: () => loggedOut,
  };
}

describe("Issue #47B — Form draft preservation on failed saves", () => {
  it("preserves user-entered form draft when server rejects a create request", async () => {
    const { runMutation, getBannerError } = createMutationHarness();
    let draft = { name: "Nordic Alloy OÜ", countryCode: "EE", sector: "Metals" };

    const ok = await runMutation(async () => {
      throw new Error("Validation failed: duplicate facility");
    });

    if (ok) {
      draft = { name: "", countryCode: "EE", sector: "" };
    }

    expect(ok).toBe(false);
    expect(getBannerError()).toContain("Validation failed");
    expect(draft).toEqual({
      name: "Nordic Alloy OÜ",
      countryCode: "EE",
      sector: "Metals",
    });
  });

  it("preserves user-entered form draft on network error and clears only after retry succeeds", async () => {
    const { runMutation } = createMutationHarness();
    let draft = { name: "Tartu Warehouse", countryCode: "EE" };

    // First attempt fails with a network error
    const firstOk = await runMutation(async () => {
      throw new TypeError("Failed to fetch");
    });
    if (firstOk) {
      draft = { name: "", countryCode: "EE" };
    }
    expect(firstOk).toBe(false);
    expect(draft.name).toBe("Tartu Warehouse");

    // Second attempt succeeds -> now form resets cleanly
    const retryOk = await runMutation(async () => {
      await Promise.resolve();
    });
    if (retryOk) {
      draft = { name: "", countryCode: "EE" };
    }
    expect(retryOk).toBe(true);
    expect(draft.name).toBe("");
  });

  it("returns false and does not reset drafts when session changes mid-flight", async () => {
    const { sessionGuard, runMutation } = createMutationHarness();
    let draft = { name: "In-flight Supplier" };

    const ok = await runMutation(async () => {
      sessionGuard.invalidate();
    });
    if (ok) {
      draft = { name: "" };
    }

    expect(ok).toBe(false);
    expect(draft.name).toBe("In-flight Supplier");
  });
});

describe("Issue #47A — Atomic base+top-up contract creation & reconciliation", () => {
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const isValidIsoDate = (value: string): boolean => {
    if (!ISO_DATE_RE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  };

  it("blocks invalid/cleared startDate before sending any contract request", async () => {
    const createContractSpy = vi.fn();
    const startDate = "";
    const endDate = "2027-06-01";

    let error: string | null = null;
    if (!isValidIsoDate(startDate)) {
      error = "Please enter a valid start date (YYYY-MM-DD).";
    } else if (endDate && endDate < startDate) {
      error = "End date must be on or after the start date.";
    } else {
      await createContractSpy();
    }

    expect(error).toBe("Please enter a valid start date (YYYY-MM-DD).");
    expect(createContractSpy).not.toHaveBeenCalled();
  });

  it("reconciles server contracts on failure without clearing draft fields", async () => {
    const onChanged = vi.fn(async () => {});
    const createContractSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("500 Internal Server Error"))
      .mockResolvedValueOnce({ contract: { contractId: "c-2" }, lines: [] });

    let draft = { volume: "45", spend: "90000", startDate: "2026-07-01" };
    let error: string | null = null;

    const submit = async () => {
      error = null;
      try {
        await createContractSpy({
          preserveLegacyBaseForLaneId: "lane-1",
          startDate: draft.startDate,
        });
        draft = { volume: "", spend: "", startDate: draft.startDate };
        await onChanged();
      } catch (err) {
        error = err instanceof Error ? err.message : "Failed";
        await onChanged();
      }
    };

    await submit();
    expect(error).toBe("500 Internal Server Error");
    expect(draft.volume).toBe("45");
    expect(draft.spend).toBe("90000");
    expect(onChanged).toHaveBeenCalledTimes(1);

    await submit();
    expect(error).toBeNull();
    expect(draft.volume).toBe("");
    expect(draft.spend).toBe("");
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(createContractSpy).toHaveBeenCalledTimes(2);
  });
});

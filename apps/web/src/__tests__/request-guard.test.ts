import { describe, expect, it } from "vitest";
import { createRequestGuard } from "../lib/request-guard";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Mimics App's loader: commits only if its ticket is still current. */
function makeLoader(guard: ReturnType<typeof createRequestGuard>) {
  const state = { network: "" };
  const load = async (fetcher: Promise<string>) => {
    const ticket = guard.begin();
    const data = await fetcher;
    if (!ticket.isCurrent()) return;
    state.network = data;
  };
  return { state, load };
}

describe("request guard", () => {
  it("discards account A's delayed response after logout and login as B", async () => {
    const guard = createRequestGuard();
    const { state, load } = makeLoader(guard);
    const a = deferred<string>();
    const b = deferred<string>();

    const pendingA = load(a.promise);
    guard.invalidate(); // logout
    guard.invalidate(); // login as B
    const pendingB = load(b.promise);

    b.resolve("B-network");
    await pendingB;
    a.resolve("A-network"); // late
    await pendingA;

    expect(state.network).toBe("B-network");
  });

  it("discards a stale response after logout with no new load", async () => {
    const guard = createRequestGuard();
    const { state, load } = makeLoader(guard);
    const a = deferred<string>();
    const pendingA = load(a.promise);
    guard.invalidate();
    a.resolve("A-network");
    await pendingA;
    expect(state.network).toBe("");
  });

  it("older refresh completing last cannot overwrite a newer one", async () => {
    const guard = createRequestGuard();
    const { state, load } = makeLoader(guard);
    const older = deferred<string>();
    const newer = deferred<string>();

    const p1 = load(older.promise);
    const p2 = load(newer.promise);
    newer.resolve("new");
    await p2;
    older.resolve("old");
    await p1;

    expect(state.network).toBe("new");
  });
});

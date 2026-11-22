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

describe("mutations", () => {
  /** Mirrors App: mutations bind to the session and invalidate older loads. */
  function setup() {
    const session = createRequestGuard();
    const network = createRequestGuard();
    const state = { network: "" };
    const load = async (p: Promise<string>) => {
      const t = network.begin();
      const v = await p;
      if (t.isCurrent()) state.network = v;
    };
    const mutate = async (p: Promise<string>) => {
      const s = session.capture();
      const v = await p;
      if (!s.isCurrent()) return;
      network.invalidate();
      state.network = v;
    };
    return { session, state, load, mutate };
  }

  it("A's delayed seedDemo cannot replace B's network after logout/login", async () => {
    const { session, state, load, mutate } = setup();
    const seedA = deferred<string>();
    const loadB = deferred<string>();
    const pSeed = mutate(seedA.promise);
    session.invalidate(); // logout + login as B
    const pLoad = load(loadB.promise);
    loadB.resolve("B");
    await pLoad;
    seedA.resolve("A-seeded");
    await pSeed;
    expect(state.network).toBe("B");
  });

  it("an older refresh cannot erase a successful mutation", async () => {
    const { state, load, mutate } = setup();
    const refresh = deferred<string>();
    const pRefresh = load(refresh.promise);
    await mutate(Promise.resolve("with-new-facility"));
    refresh.resolve("stale-without-facility");
    await pRefresh;
    expect(state.network).toBe("with-new-facility");
  });
});

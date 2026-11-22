import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpArcadeDbClient } from "../src/db/client.js";

const client = () => new HttpArcadeDbClient({
  url: "http://database.test", database: "kulgo", user: "root", password: "test",
});
const begun = (id: string) => new Response(null, { status: 204, headers: { "arcadedb-session-id": id } });
const ok = () => new Response(null, { status: 204 });
const rows = (value: unknown[]) => Response.json({ result: value });

afterEach(() => vi.unstubAllGlobals());

describe("ArcadeDB HTTP transactions", () => {
  it("scopes every read/write to one repeatable-read session and returns only after commit", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(begun("session-1"))
      .mockResolvedValueOnce(rows([{ status: "PENDING" }]))
      .mockResolvedValueOnce(rows([{ status: "ACCEPTED" }]))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const result = await client().transaction(async db => {
      await db.query("sql", "SELECT FROM Invitation");
      return db.command("sql", "UPDATE Invitation SET status = :status", { status: "ACCEPTED" });
    });
    expect(result).toEqual([{ status: "ACCEPTED" }]);
    expect(fetchMock.mock.calls.map(call => String(call[0]).split("/").at(-2))).toEqual(["begin", "query", "command", "commit"]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ isolationLevel: "REPEATABLE_READ" });
    for (const call of fetchMock.mock.calls.slice(1)) expect(call[1].headers["arcadedb-session-id"]).toBe("session-1");
  });

  it("rolls back callback failures and preserves the original error if rollback fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(begun("session-1"))
      .mockResolvedValueOnce(rows([])).mockRejectedValueOnce(new Error("rollback unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const failure = new Error("edge creation failed");
    await expect(client().transaction(async db => {
      await db.command("sql", "UPDATE Invitation SET status = 'ACCEPTED'");
      throw failure;
    })).rejects.toBe(failure);
    expect(fetchMock.mock.calls.at(-1)![0]).toContain("/rollback/");
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  for (const exception of ["ConcurrentModificationException", "DuplicatedKeyException", "NeedRetryException"]) {
    it(`restarts all reads and writes on a fresh session after ${exception}`, async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(begun("loser"))
        .mockResolvedValueOnce(rows([{ status: "PENDING" }]))
        .mockResolvedValueOnce(new Response(JSON.stringify({ exception }), { status: 503 }))
        .mockResolvedValueOnce(ok())
        .mockResolvedValueOnce(begun("retry"))
        .mockResolvedValueOnce(rows([{ status: "ACCEPTED" }]))
        .mockResolvedValueOnce(ok());
      vi.stubGlobal("fetch", fetchMock);
      const work = vi.fn(async db => db.query("sql", "SELECT status FROM Invitation"));
      expect(await client().transaction(work)).toEqual([{ status: "ACCEPTED" }]);
      expect(work).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]![1].headers["arcadedb-session-id"]).toBe("loser");
      expect(fetchMock.mock.calls[5]![1].headers["arcadedb-session-id"]).toBe("retry");
    });
  }

  it("does not retry a lost commit response with an unknown outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(begun("session-1"))
      .mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const work = vi.fn(async () => "accepted");
    await expect(client().transaction(work)).rejects.toThrow("fetch failed");
    expect(work).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  it("does not treat an expired session as a successful commit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(begun("session-1"))
      .mockResolvedValueOnce(new Response("session expired", { status: 404 })).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().transaction(async () => "accepted")).rejects.toThrow("session expired");
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  it("bounds retries on persistent conflicts", async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes("/begin/") ? begun("session")
      : url.includes("/commit/") ? new Response("ConcurrentModificationException", { status: 503 }) : ok());
    vi.stubGlobal("fetch", fetchMock);
    const work = vi.fn(async () => "accepted");
    await expect(client().transaction(work)).rejects.toThrow("ConcurrentModificationException");
    expect(work).toHaveBeenCalledTimes(5);
  });
});

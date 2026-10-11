/**
 * Artifact store: SQLite rows behind an in-memory read-through cache.
 * Memory hit, miss → DB load → re-warm, expiry with refresh guidance,
 * periodic sweep, per-session byte-budget eviction, and cascade on session delete.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createTestDb, type TestDb } from "../__test-utils__/db";
import { createQueries, type Queries } from "../db/queries";

const app = createTestDb();
mock.module("../db", () => ({ db: app.db, sqlite: app.sqlite, ...createQueries(app.db) }));

const { ArtifactStore } = await import("../orchestration/tools/artifact-store");
const { appConfig } = await import("../config");
const DEFAULT_BUDGET = appConfig.artifact.max_session_bytes;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = "s1";
const OTHER_SESSION = "s2";
const TOOL = "chembl__search_activities";
const INPUT = { target: "CHEMBL203", limit: 500 };
const HOUR_MS = 3_600_000;
const DATA = { results: [{ id: 1, name: "a" }, { id: 2, name: "b" }] };

let t: TestDb;
let q: Queries;
let store: InstanceType<typeof ArtifactStore>;
const stores: InstanceType<typeof ArtifactStore>[] = [];

beforeEach(() => {
  t = createTestDb();
  q = createQueries(t.db);
  q.userQueries.create(USER_ID, `clerk_${USER_ID}`, "a@example.com", "Ada", null, "user", null, null);
  q.chatSessionQueries.create(SESSION, USER_ID, null);
  q.chatSessionQueries.create(OTHER_SESSION, USER_ID, null);
  store = new ArtifactStore(q.artifactQueries);
  stores.push(store);
});

afterEach(() => {
  mock.restore(); // Date.now spies
  appConfig.artifact.max_session_bytes = DEFAULT_BUDGET;
});

afterAll(() => {
  for (const s of stores) s.destroy();
});

/** A payload whose stored JSON is exactly `chars` long. */
function sized(chars: number): { p: string } {
  return { p: "x".repeat(chars - '{"p":""}'.length) };
}

function sessionIds(sessionId: string): string[] {
  return t.sqlite
    .query<{ id: string }, [string]>("SELECT id FROM artifacts WHERE session_id = ? ORDER BY rowid")
    .all(sessionId)
    .map((r) => r.id);
}

function rowCount(): number {
  return t.sqlite.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM artifacts").get()!.n;
}

describe("ArtifactStore", () => {
  it("store() writes a gzipped row and warms memory", () => {
    const id = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    const json = JSON.stringify(DATA);

    const row = q.artifactQueries.findForSession(id, SESSION)!;
    expect(row.tool_name).toBe(TOOL);
    expect(JSON.parse(row.tool_input_json)).toEqual(INPUT);
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(row.data)))).toBe(json);
    expect(row.raw_size_chars).toBe(9000);
    expect(row.stored_size_chars).toBe(json.length);
    expect(row.expires_at - row.created_at).toBe(24 * 3600);
    expect(store.isCached(id)).toBe(true);
  });

  it("draws a fresh ID when the generated one collides with a stored row", async () => {
    // First two draws collide, the third is unique.
    const fills = [0xaa, 0xaa, 0xbb];
    spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(arr: T) => {
      (arr as unknown as Uint8Array).fill(fills.shift() ?? 0xcc);
      return arr;
    });
    const first = store.store(SESSION, TOOL, INPUT, { v: "original" }, 10);
    const second = store.store(SESSION, TOOL, INPUT, { v: "replacement" }, 10);

    expect(first).toBe("art_aaaaaaaa");
    expect(second).toBe("art_bbbbbbbb");
    store.clear();
    expect((await store.query(first, SESSION, ".v")).result).toBe("original");
    expect((await store.query(second, SESSION, ".v")).result).toBe("replacement");
  });

  it("serves a memory hit without touching the database", async () => {
    const id = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    const find = spyOn(q.artifactQueries, "findForSession");

    const { result, error } = await store.query(id, SESSION, ".results | length");
    expect(error).toBeUndefined();
    expect(result).toBe(2);
    expect(find).not.toHaveBeenCalled();
    find.mockRestore();
  });

  it("loads from the database on a memory miss and re-warms memory", async () => {
    const id = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    store.clear(); // as if the 5-minute memory window had passed
    expect(store.isCached(id)).toBe(false);

    const { result, error } = await store.query(id, SESSION, "[.results[] | .name]");
    expect(error).toBeUndefined();
    expect(result).toEqual(["a", "b"]);
    expect(store.isCached(id)).toBe(true);
    const lookup = store.get(id, SESSION);
    expect(lookup.status === "ok" && lookup.artifact.toolInput).toEqual(INPUT);
  });

  it("reads artifacts written by another process instance (fresh store, same DB)", async () => {
    const id = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    const restarted = new ArtifactStore(q.artifactQueries);
    stores.push(restarted);

    expect((await restarted.query(id, SESSION, ".results[0].id")).result).toBe(1);
  });

  it("blocks cross-session access from memory and from the database", async () => {
    const id = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    expect((await store.query(id, OTHER_SESSION, ".")).error).toContain("not found");

    store.clear();
    expect((await store.query(id, OTHER_SESSION, ".")).error).toContain("not found");
    expect(store.isCached(id)).toBe(false);
  });

  it("keeps many artifacts while the session is within its byte budget", () => {
    appConfig.artifact.max_session_bytes = 1000;
    const ids = Array.from({ length: 11 }, () => store.store(SESSION, TOOL, INPUT, sized(90), 100));
    expect(sessionIds(SESSION)).toEqual(ids); // 990 chars ≤ 1000
    expect(ids.every((id) => store.isCached(id))).toBe(true);
  });

  it("evicts the oldest artifacts by creation time once over budget", async () => {
    appConfig.artifact.max_session_bytes = 1000;
    const created = Date.now();
    const now = spyOn(Date, "now");
    const ids = [0, 1, 2, 3].map((i) => {
      now.mockReturnValue(created + i * 60_000);
      return store.store(SESSION, TOOL, INPUT, sized(300), 100);
    });
    // 4 × 300 = 1200 > 1000 → only the oldest goes
    expect(sessionIds(SESSION)).toEqual(ids.slice(1));
    expect(store.isCached(ids[0])).toBe(false);
    expect((await store.query(ids[0], SESSION, ".")).error).toContain("not found");

    // A 700-char store leaves room for only the newest 300 (300 + 700 = 1000)
    now.mockReturnValue(created + 4 * 60_000);
    const big = store.store(SESSION, TOOL, INPUT, sized(700), 100);
    expect(sessionIds(SESSION)).toEqual([ids[3], big]);
    expect(store.isCached(ids[1])).toBe(false);
    expect(store.isCached(ids[2])).toBe(false);
    expect(store.isCached(ids[3])).toBe(true);
  });

  it("orders eviction by created_at, not by last access", async () => {
    appConfig.artifact.max_session_bytes = 700;
    const created = Date.now();
    const now = spyOn(Date, "now").mockReturnValue(created);
    const first = store.store(SESSION, TOOL, INPUT, sized(300), 100);
    now.mockReturnValue(created + 60_000);
    const second = store.store(SESSION, TOOL, INPUT, sized(300), 100);
    now.mockReturnValue(created + 120_000);
    expect(store.get(first, SESSION).status).toBe("ok"); // recently read, still oldest

    const third = store.store(SESSION, TOOL, INPUT, sized(300), 100);
    expect(sessionIds(SESSION)).toEqual([second, third]);
  });

  it("keeps the just-stored artifact even if it alone exceeds the budget", async () => {
    appConfig.artifact.max_session_bytes = 500;
    const older = store.store(SESSION, TOOL, INPUT, sized(200), 100);
    const huge = store.store(SESSION, TOOL, INPUT, sized(800), 100);
    expect(sessionIds(SESSION)).toEqual([huge]);
    expect(store.isCached(older)).toBe(false);
    expect((await store.query(huge, SESSION, ".p | length")).result).toBe(800 - 8);
  });

  it("leaves other sessions untouched when one goes over budget", () => {
    appConfig.artifact.max_session_bytes = 500;
    const other = [0, 1].map(() => store.store(OTHER_SESSION, TOOL, INPUT, sized(200), 100));
    const mine = [0, 1, 2].map(() => store.store(SESSION, TOOL, INPUT, sized(200), 100));
    expect(sessionIds(SESSION)).toEqual(mine.slice(1));
    expect(sessionIds(OTHER_SESSION)).toEqual(other);
    expect(other.every((id) => store.isCached(id))).toBe(true);
  });

  it("still returns an artifact ID when budget eviction fails", () => {
    const evict = spyOn(q.artifactQueries, "evictOverBudget").mockImplementation(() => {
      throw new Error("db locked");
    });
    const id = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    expect(store.isCached(id)).toBe(true);
    expect(sessionIds(SESSION)).toEqual([id]);
    evict.mockRestore();
  });

  it("expires 24h after creation even if read in between", async () => {
    const created = Date.now();
    const now = spyOn(Date, "now").mockReturnValue(created);
    const id = store.store(SESSION, TOOL, INPUT, DATA, 9000);

    now.mockReturnValue(created + 23 * HOUR_MS);
    expect((await store.query(id, SESSION, ".results | length")).result).toBe(2);

    now.mockReturnValue(created + 24 * HOUR_MS);
    expect(store.get(id, SESSION).status).toBe("expired");
  });

  it("returns refresh guidance with tool name and input for an expired artifact", async () => {
    const created = Date.now();
    const now = spyOn(Date, "now").mockReturnValue(created);
    const id = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    now.mockReturnValue(created + 26 * HOUR_MS);
    const expected =
      `Artifact ${id} expired (fetched 26h ago). ` +
      `Re-run \`${TOOL}\` with ${JSON.stringify(INPUT)} for current data.`;

    // Memory copy
    const fromMemory = await store.query(id, SESSION, ".");
    expect(fromMemory.result).toBeNull();
    expect(fromMemory.error).toBe(expected);
    expect(store.isCached(id)).toBe(false);

    // Database row (memory already gone)
    expect((await store.query(id, SESSION, ".")).error).toBe(expected);
    expect(store.isCached(id)).toBe(false);

    // Another session still sees it as missing, not expired
    expect((await store.query(id, OTHER_SESSION, ".")).error).toContain("not found");
  });

  it("sweepExpired() deletes only rows past expires_at", async () => {
    const created = Date.now();
    const old = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    spyOn(Date, "now").mockReturnValue(created + 12 * HOUR_MS);
    const fresh = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    expect(rowCount()).toBe(2);

    expect(store.sweepExpired(created + 23 * HOUR_MS)).toBe(0);
    expect(store.sweepExpired(created + 25 * HOUR_MS)).toBe(1);
    expect(rowCount()).toBe(1);
    expect(q.artifactQueries.findForSession(old, SESSION)).toBeNull();
    expect(q.artifactQueries.findForSession(fresh, SESSION)).not.toBeNull();

    store.clear();
    expect((await store.query(old, SESSION, ".")).error).toContain("not found");
  });

  it("deletes artifacts when their session is deleted", async () => {
    const id = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    store.store(OTHER_SESSION, TOOL, INPUT, DATA, 9000);
    expect(rowCount()).toBe(2);

    q.chatSessionQueries.delete(SESSION);
    expect(rowCount()).toBe(1);
    expect(q.artifactQueries.findForSession(id, SESSION)).toBeNull();

    store.clear();
    expect((await store.query(id, SESSION, ".")).error).toContain("not found");
  });
});

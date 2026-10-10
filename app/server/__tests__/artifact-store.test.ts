/**
 * Artifact store: SQLite rows behind an in-memory read-through cache.
 * Memory hit, miss → DB load → re-warm, expiry with refresh guidance,
 * periodic sweep, and cascade on session delete.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createTestDb, type TestDb } from "../__test-utils__/db";
import { createQueries, type Queries } from "../db/queries";

const app = createTestDb();
mock.module("../db", () => ({ db: app.db, sqlite: app.sqlite, ...createQueries(app.db) }));

const { ArtifactStore } = await import("../orchestration/tools/artifact-store");

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
});

afterAll(() => {
  for (const s of stores) s.destroy();
});

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

  it("keeps the row when the per-session memory cap evicts the cached copy", async () => {
    const ids = Array.from({ length: 11 }, (_, i) => store.store(SESSION, TOOL, INPUT, { i }, 100));
    expect(store.getSessionCount(SESSION)).toBe(10);
    expect(store.isCached(ids[0])).toBe(false);
    expect(rowCount()).toBe(11);

    expect((await store.query(ids[0], SESSION, ".i")).result).toBe(0);
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
    const id = store.store(SESSION, TOOL, INPUT, DATA, 9000);
    spyOn(Date, "now").mockReturnValue(created + 26 * HOUR_MS);
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

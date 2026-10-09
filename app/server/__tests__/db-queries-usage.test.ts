/**
 * Query-layer tests for daily usage, the usage-event ledger, rate limits and
 * FTS5 tool search, run against createTestDb().
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createTestDb, type TestDb } from "../__test-utils__/db";
import { createQueries, type Queries } from "../db/queries";
import type { DbUsageEvent } from "../types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const today = () => new Date().toISOString().slice(0, 10);

let t: TestDb;
let q: Queries;

beforeEach(() => {
  t = createTestDb();
  q = createQueries(t.db);
  q.userQueries.create(USER_ID, "clerk_a", "a@example.com", null, null, "user", null, null);
  q.userQueries.create(OTHER_ID, "clerk_b", "b@example.com", null, null, "user", null, null);
});

describe("dailyUsageQueries", () => {
  it("defaults to zero when there is no row for today", () => {
    expect(q.dailyUsageQueries.getToday(USER_ID)).toBe(0);
    expect(q.dailyUsageQueries.getTodayFull(USER_ID)).toEqual({ query_count: 0, input_tokens: 0, output_tokens: 0 });
  });

  it("incrementAndGet upserts one row per user per day and returns the new count", () => {
    expect(q.dailyUsageQueries.incrementAndGet(USER_ID)).toBe(1);
    expect(q.dailyUsageQueries.incrementAndGet(USER_ID)).toBe(2);
    expect(q.dailyUsageQueries.incrementAndGet(USER_ID)).toBe(3);
    expect(q.dailyUsageQueries.incrementAndGet(OTHER_ID)).toBe(1);
    expect(q.dailyUsageQueries.getToday(USER_ID)).toBe(3);
    expect(t.sqlite.query("SELECT COUNT(*) AS n FROM daily_usage WHERE user_id = ?").get(USER_ID)).toEqual({ n: 1 });
  });

  it("does not count yesterday's row towards today", () => {
    t.sqlite.run("INSERT INTO daily_usage (user_id, date, query_count) VALUES (?, '2000-01-01', 99)", [USER_ID]);
    expect(q.dailyUsageQueries.incrementAndGet(USER_ID)).toBe(1);
    expect(q.dailyUsageQueries.getToday(USER_ID)).toBe(1);
  });

  it("incrementTokens inserts a zero-query row, then accumulates via excluded.*", () => {
    q.dailyUsageQueries.incrementTokens(USER_ID, 100, 200);
    expect(q.dailyUsageQueries.getTodayFull(USER_ID)).toEqual({ query_count: 0, input_tokens: 100, output_tokens: 200 });
    q.dailyUsageQueries.incrementAndGet(USER_ID);
    q.dailyUsageQueries.incrementTokens(USER_ID, 5, 7);
    expect(q.dailyUsageQueries.getTodayFull(USER_ID)).toEqual({ query_count: 1, input_tokens: 105, output_tokens: 207 });
    expect(q.dailyUsageQueries.getTodayFull(OTHER_ID)).toEqual({ query_count: 0, input_tokens: 0, output_tokens: 0 });
  });
});

describe("usageEventQueries", () => {
  let n = 0;
  function event(overrides: Partial<DbUsageEvent> = {}): Omit<DbUsageEvent, "created_at"> {
    n += 1;
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      user_id: USER_ID,
      date: "2026-10-09",
      month: "2026-10",
      operation: "chat",
      provider: "anthropic",
      model: "claude",
      input_tokens: 10,
      output_tokens: 20,
      input_cost_per_mtok_microusd: 3_000_000,
      output_cost_per_mtok_microusd: 15_000_000,
      cost_microusd: 330,
      session_id: null,
      message_id: null,
      ...overrides,
    };
  }

  it("returns numeric zero totals (not null) when there are no events", () => {
    expect(q.usageEventQueries.getTotalsForDate(USER_ID, "2026-10-09")).toEqual({
      cost_microusd: 0,
      input_tokens: 0,
      output_tokens: 0,
      query_count: 0,
    });
    expect(q.usageEventQueries.getTotalsForMonth(USER_ID, "2026-10")).toEqual({
      cost_microusd: 0,
      input_tokens: 0,
      output_tokens: 0,
      query_count: 0,
    });
  });

  it("sums cost and tokens per user for a date and a month", () => {
    q.usageEventQueries.create(event());
    q.usageEventQueries.create(event({ input_tokens: 1, output_tokens: 2, cost_microusd: 70 }));
    q.usageEventQueries.create(event({ date: "2026-10-01", cost_microusd: 1000 }));
    q.usageEventQueries.create(event({ date: "2026-09-30", month: "2026-09", cost_microusd: 5 }));
    q.usageEventQueries.create(event({ user_id: OTHER_ID, cost_microusd: 9999 }));

    expect(q.usageEventQueries.getTotalsForDate(USER_ID, "2026-10-09")).toEqual({
      cost_microusd: 400,
      input_tokens: 11,
      output_tokens: 22,
      query_count: 2,
    });
    expect(q.usageEventQueries.getTotalsForMonth(USER_ID, "2026-10")).toEqual({
      cost_microusd: 1400,
      input_tokens: 21,
      output_tokens: 42,
      query_count: 3,
    });
  });

  it("defaults to the current UTC date and month", () => {
    const d = today();
    q.usageEventQueries.create(event({ date: d, month: d.slice(0, 7), cost_microusd: 42 }));
    expect(q.usageEventQueries.getTotalsForDate(USER_ID).cost_microusd).toBe(42);
    expect(q.usageEventQueries.getTotalsForMonth(USER_ID).cost_microusd).toBe(42);
  });

  it("defaults created_at and enforces the operation CHECK", () => {
    q.usageEventQueries.create(event());
    const row = t.sqlite.query<{ created_at: number }, []>("SELECT created_at FROM usage_events").get()!;
    expect(row.created_at).toBeNumber();
    expect(() => q.usageEventQueries.create(event({ operation: "embed" as "chat" }))).toThrow();
  });
});

describe("rateLimitQueries", () => {
  it("reads the seeded per-role limits", () => {
    expect(q.rateLimitQueries.getForRole("user")).toBe(50);
    expect(q.rateLimitQueries.getForRole("admin")).toBe(-1);
  });

  it("falls back to 50 (user) / -1 (admin) when the row is missing", () => {
    t.sqlite.run("DELETE FROM rate_limits");
    expect(q.rateLimitQueries.getForRole("user")).toBe(50);
    expect(q.rateLimitQueries.getForRole("admin")).toBe(-1);
    expect(q.rateLimitQueries.getForRole("waitlist")).toBe(50);
  });

  it("update upserts and refreshes updated_at", () => {
    t.sqlite.run("UPDATE rate_limits SET updated_at = 1 WHERE role = 'user'");
    q.rateLimitQueries.update("user", 75);
    expect(q.rateLimitQueries.getForRole("user")).toBe(75);
    const row = t.sqlite.query<{ updated_at: number }, []>("SELECT updated_at FROM rate_limits WHERE role = 'user'").get()!;
    expect(row.updated_at).toBeGreaterThan(1);

    t.sqlite.run("DELETE FROM rate_limits WHERE role = 'admin'");
    q.rateLimitQueries.update("admin", 500);
    expect(q.rateLimitQueries.getForRole("admin")).toBe(500);
  });
});

describe("toolSearchQueries (FTS5)", () => {
  beforeEach(() => {
    q.toolSearchQueries.insertTool("uniprot__search", "uniprot", "search", "Search UniProt for protein entries");
    q.toolSearchQueries.insertTool("pubmed__search", "pubmed", "search", "Search PubMed literature articles");
    q.toolSearchQueries.insertTool("chembl__compound", "chembl", "compound", "Look up ChEMBL compound bioactivity");
  });

  it("ranks BM25 matches and returns snake_case rows", () => {
    const rows = q.toolSearchQueries.searchBM25("protein");
    expect(rows.map((r) => r.full_name)).toEqual(["uniprot__search"]);
    expect(Object.keys(rows[0]!).sort()).toEqual(["description", "full_name", "rank", "server", "tool_name"]);
    expect(rows[0]!.rank).toBeNumber();
  });

  it("uses the porter stemmer, OR queries and the limit", () => {
    expect(q.toolSearchQueries.searchBM25("proteins").map((r) => r.full_name)).toEqual(["uniprot__search"]);
    expect(q.toolSearchQueries.searchBM25("search").length).toBe(2);
    expect(q.toolSearchQueries.searchBM25("protein OR compound OR literature", 2).length).toBe(2);
  });

  it("clearAll empties the index", () => {
    q.toolSearchQueries.clearAll();
    expect(q.toolSearchQueries.searchBM25("search")).toEqual([]);
  });
});

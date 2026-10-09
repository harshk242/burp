import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { CURRENT_LEGACY_SQL, OLD_PROD_LEGACY_SQL } from "../__test-utils__/legacy";
import { loadMigrations } from "../db/executor";
import { diffFingerprints, fingerprintSchema } from "../db/introspect";
import { baselineDatabase, baselineDiffs, runCatchUp } from "../db/legacy";
import { MIGRATIONS_FOLDER } from "../db/paths";
import { normalizeExpression } from "../db/sql-tokens";

const baseline = loadMigrations(MIGRATIONS_FOLDER)[0]!;

function db(...statements: string[]): Database {
  const sqlite = new Database(":memory:");
  for (const s of statements) sqlite.run(s);
  return sqlite;
}
const diff = (a: Database, b: Database) => diffFingerprints(fingerprintSchema(a), fingerprintSchema(b));

describe("fingerprint vs the 0000 baseline", () => {
  it("today's legacy schema.sql is semantically identical to 0000", () => {
    const legacy = new Database(":memory:");
    legacy.exec(CURRENT_LEGACY_SQL);
    expect(baselineDiffs(legacy, baseline)).toEqual([]);
  });

  it("the old prod schema matches only after the frozen ALTER catch-up", () => {
    const legacy = new Database(":memory:");
    legacy.exec(OLD_PROD_LEGACY_SQL);
    expect(baselineDiffs(legacy, baseline)).toContain("missing table usage_events");
    expect(baselineDiffs(legacy, baseline)).toContain("users: missing column daily_cost_limit_microusd");
    legacy.transaction(() => runCatchUp(legacy))();
    expect(baselineDiffs(legacy, baseline)).toEqual([]);
  });

  it("covers every column, PK, AUTOINCREMENT, FK, unique set, CHECK and index of the baseline", () => {
    const fp = fingerprintSchema(baselineDatabase(baseline));
    expect(Object.keys(fp.tables).sort()).toEqual([
      "access_requests",
      "chat_sessions",
      "daily_usage",
      "messages",
      "rate_limits",
      "usage_events",
      "users",
    ]);
    expect(fp.tables.daily_usage).toMatchObject({
      primaryKey: ["id"],
      autoincrement: true,
      uniques: ["date,user_id"],
      indexes: ["idx_daily_usage_user_date: (user_id, date)"],
    });
    expect(fp.tables.daily_usage!.columns.id).toEqual({ type: "INTEGER", notnull: true, default: null });
    expect(fp.tables.users!.columns.id).toEqual({ type: "TEXT", notnull: false, default: null });
    expect(fp.tables.users!.columns.created_at!.default).toBe("unixepoch ( )");
    expect(fp.tables.usage_events!.foreignKeys).toEqual([
      "(message_id) -> messages(id) on delete set null on update no action",
      "(session_id) -> chat_sessions(id) on delete set null on update no action",
      "(user_id) -> users(id) on delete cascade on update no action",
    ]);
    expect(fp.tables.rate_limits!.checks).toEqual(["role in ( 'user' , 'admin' )"]);
    expect(fp.others).toEqual([]);
  });
});

describe("normalization", () => {
  it("ignores quoting, qualifiers, case, whitespace, CONSTRAINT names and redundant parens", () => {
    const a = db(`CREATE TABLE t (x TEXT, CONSTRAINT "t_x_check" CHECK(("t"."X" IN ('a','b'))))`);
    const b = db("CREATE TABLE t (x TEXT CHECK (x in ( 'a', 'b' )))");
    expect(diff(a, b)).toEqual([]);
    expect(normalizeExpression("((`t`.[x] <> 1))")).toBe("x != 1");
  });

  it("keeps string literal case and contents (they change what a CHECK accepts)", () => {
    expect(diff(db("CREATE TABLE t (x TEXT CHECK (x = 'A'))"), db("CREATE TABLE t (x TEXT CHECK (x = 'a'))"))).toEqual([
      "t: missing check x = 'a'",
      "t: unexpected check x = 'A'",
    ]);
  });

  it("does not mistake CHECK/AUTOINCREMENT inside strings, comments or quoted names for constraints", () => {
    const sqlite = db(
      `CREATE TABLE t (
        id INTEGER PRIMARY KEY, -- AUTOINCREMENT would go here; CHECK (id > 0)
        "check" TEXT DEFAULT 'CHECK (1)'
      )`,
    );
    expect(fingerprintSchema(sqlite).tables.t).toMatchObject({ autoincrement: false, checks: [] });
  });

  it("compares CHECKs as a multiset", () => {
    expect(
      diff(db("CREATE TABLE t (x INT CHECK (x > 0), CHECK (x > 0))"), db("CREATE TABLE t (x INT CHECK (x > 0))")),
    ).toEqual(["t: unexpected check x > 0"]);
  });

  it("normalizes equivalent defaults", () => {
    expect(diff(db("CREATE TABLE t (x INT DEFAULT (0))"), db("CREATE TABLE t (x INT DEFAULT 0)"))).toEqual([]);
    expect(diff(db("CREATE TABLE t (x INT DEFAULT 1)"), db("CREATE TABLE t (x INT DEFAULT 0)"))).toEqual([
      "t.x: default 1, expected 0",
    ]);
  });

  it("treats unique sets the same regardless of origin and column order", () => {
    const inline = db("CREATE TABLE t (a INT, b INT, UNIQUE (a, b))");
    const named = db("CREATE TABLE t (a INT, b INT)", "CREATE UNIQUE INDEX t_ba ON t (b, a)");
    expect(diff(inline, named)).toEqual([]);
  });

  it("keeps partial unique indexes as indexes (they are not unique constraints)", () => {
    const partial = db("CREATE TABLE t (a INT)", "CREATE UNIQUE INDEX t_a ON t (a) WHERE \"t\".a > 0");
    expect(fingerprintSchema(partial).tables.t).toMatchObject({ uniques: [], indexes: ["t_a: unique (a) where a > 0"] });
  });

  it("compares ordinary index column order and direction", () => {
    const ab = db("CREATE TABLE t (a INT, b INT)", "CREATE INDEX i ON t (a, b)");
    const ba = db("CREATE TABLE t (a INT, b INT)", "CREATE INDEX i ON t (b, a DESC)");
    expect(diff(ab, ba)).toEqual(["t: missing index i: (b, a desc)", "t: unexpected index i: (a, b)"]);
  });

  it("resolves FKs without explicit parent columns to the parent PK", () => {
    const implicit = db("CREATE TABLE p (id TEXT PRIMARY KEY)", "CREATE TABLE c (pid TEXT REFERENCES p ON DELETE CASCADE)");
    const explicit = db("CREATE TABLE p (id TEXT PRIMARY KEY)", "CREATE TABLE c (pid TEXT REFERENCES p(id) ON DELETE CASCADE)");
    expect(diff(implicit, explicit)).toEqual([]);
  });

  it("treats NOT NULL on an INTEGER rowid-alias PK as implied, but not on text PKs", () => {
    expect(diff(db("CREATE TABLE t (id INTEGER PRIMARY KEY)"), db("CREATE TABLE t (id INTEGER PRIMARY KEY NOT NULL)"))).toEqual([]);
    expect(diff(db("CREATE TABLE t (id TEXT PRIMARY KEY)"), db("CREATE TABLE t (id TEXT PRIMARY KEY NOT NULL)"))).toEqual([
      "t.id: nullable, expected NOT NULL",
    ]);
  });

  it("ignores bookkeeping and FTS tables", () => {
    const sqlite = db(
      'CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
      "CREATE VIRTUAL TABLE tool_search_fts USING fts5(full_name, description)",
    );
    expect(fingerprintSchema(sqlite)).toEqual({ tables: {}, others: [] });
  });
});

/**
 * 0003_tighten_not_null: schema shape, drift, backfills, no cascade on recreate
 * (plans/drizzle-orm-migration.md §5, §10). Rollback on NULL PKs and the
 * db:verify report live in db-tighten-rollback.test.ts.
 */
import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { cpSync, readdirSync, rmSync } from "fs";
import { join, relative } from "path";
import { createTestDb } from "../__test-utils__/db";
import { buildLegacyDb, LEGACY_FIXTURES, sequenceOf } from "../__test-utils__/legacy";
import {
  foreignKeysEnabled,
  historyRows,
  makeTempDir,
  migrationsFolderUpTo,
  rowCounts,
  seedRelatedRows,
} from "../__test-utils__/migrations";
import { notNullColumns, seedNullableRows } from "../__test-utils__/tighten";
import { backfillSql, TIGHTEN_BACKFILLS, TIGHTEN_MIGRATION_TAG, TIGHTENED_PRIMARY_KEYS } from "../db/backfills";
import { openDatabase } from "../db/connection";
import { loadMigrations } from "../db/executor";
import { baselineDatabase } from "../db/legacy";
import { runMigrations } from "../db/migrate";
import { MIGRATIONS_FOLDER } from "../db/paths";

const APP_DIR = join(import.meta.dir, "..", "..");
const TABLES = ["access_requests", "chat_sessions", "daily_usage", "messages", "rate_limits", "usage_events", "users"];
const migrations = loadMigrations(MIGRATIONS_FOLDER);
const tighten = migrations.find((m) => m.tag === TIGHTEN_MIGRATION_TAG)!;

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A non-legacy DB migrated through 0002, i.e. with 0003 still pending. */
function pre0003Db(): Database {
  const sqlite = openDatabase(":memory:");
  runMigrations(sqlite, { migrationsFolder: migrationsFolderUpTo("0002_seed_and_data_fixes") });
  return sqlite;
}

const ref = (r: { table: string; column: string }) => `${r.table}.${r.column}`;
const stripComments = (statement: string) => statement.replace(/^\s*--.*$/gm, "").trim();

describe("0003_tighten_not_null — schema", () => {
  it("a fresh DB applies it", () => {
    expect(tighten).toBeDefined();
    const { sqlite } = createTestDb();
    expect(historyRows(sqlite)).toHaveLength(migrations.length);
    expect(historyRows(sqlite).map((r) => r.hash)).toContain(tighten.hash);
    expect(foreignKeysEnabled(sqlite)).toBe(true);
  });

  it("tightens exactly the backfilled columns and the text PKs", () => {
    const baseline = baselineDatabase(migrations[0]!);
    // Later migrations add NOT NULL columns of their own; stop at 0003.
    const sqlite = openDatabase(":memory:");
    runMigrations(sqlite, { migrationsFolder: migrationsFolderUpTo(TIGHTEN_MIGRATION_TAG) });
    const before = new Set(notNullColumns(baseline, TABLES));
    const tightened = notNullColumns(sqlite, TABLES).filter((c) => !before.has(c));
    expect(tightened).toEqual([...TIGHTEN_BACKFILLS.map(ref), ...TIGHTENED_PRIMARY_KEYS.map(ref)].sort());
    // Nothing was loosened.
    for (const c of before) expect(notNullColumns(sqlite, TABLES)).toContain(c);
    baseline.close();
  });

  it("text PKs are column-level PRIMARY KEY NOT NULL; daily_usage.id is unchanged", () => {
    const { sqlite } = createTestDb();
    for (const { table, column } of TIGHTENED_PRIMARY_KEYS) {
      const col = sqlite
        .query<{ name: string; notnull: number; pk: number }, []>(`PRAGMA table_info("${table}")`)
        .all()
        .find((c) => c.name === column)!;
      expect({ table, column, notnull: col.notnull, pk: col.pk }).toEqual({ table, column, notnull: 1, pk: 1 });
      expect(() => sqlite.run(`INSERT INTO ${table} (${column}) VALUES (NULL)`)).toThrow(/NOT NULL constraint failed/);
    }
    const ddl = (db: Database) =>
      db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name = 'daily_usage'").get()!.sql;
    expect(ddl(sqlite)).toContain("`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL");
  });

  it("starts with exactly the TIGHTEN_BACKFILLS statements, one per breakpoint, in order", () => {
    const head = tighten.sql.slice(0, TIGHTEN_BACKFILLS.length).map(stripComments);
    expect(head).toEqual(TIGHTEN_BACKFILLS.map(backfillSql));
    expect(stripComments(tighten.sql[TIGHTEN_BACKFILLS.length]!)).toBe("PRAGMA foreign_keys=OFF;");
    // Never more than one statement per chunk (drizzle-orm would silently drop the rest).
    for (const chunk of tighten.sql) expect(stripComments(chunk).replace(/;\s*$/, "")).not.toContain(";");
  });

  it("drizzle-kit generate produces nothing new (no schema drift)", () => {
    const dir = makeTempDir("burp-drift-");
    tempDirs.push(dir);
    const out = join(dir, "migrations");
    cpSync(MIGRATIONS_FOLDER, out, { recursive: true }); // drizzle-kit diffs against the existing history
    const files = () => readdirSync(out, { recursive: true }).map(String).sort();
    const before = files();
    const proc = Bun.spawnSync(
      ["bunx", "drizzle-kit", "generate", "--dialect", "sqlite", "--schema", "./server/db/schema/index.ts", "--out", relative(APP_DIR, out)],
      { cwd: APP_DIR, stdout: "pipe", stderr: "pipe" },
    );
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("No schema changes");
    expect(files()).toEqual(before);
  }, 30_000);
});

describe("0003_tighten_not_null — backfills", () => {
  function expectBackfilled(sqlite: Database, t0: number, t1: number): void {
    const one = (q: string) => sqlite.query<Record<string, number | string | null>, []>(q).get()!;
    const inWindow = (v: unknown) => typeof v === "number" && v >= t0 && v <= t1;

    const user = one("SELECT role, total_queries, created_at FROM users WHERE id = 'u-null'");
    expect(user).toMatchObject({ role: "user", total_queries: 0 });
    expect(inWindow(user.created_at)).toBe(true);

    const request = one("SELECT status, submitted_at FROM access_requests WHERE id = 'ar-null'");
    expect(request.status).toBe("pending");
    expect(inWindow(request.submitted_at)).toBe(true);

    expect(inWindow(one("SELECT created_at FROM chat_sessions WHERE id = 'c-null'").created_at)).toBe(true);

    const message = one("SELECT created_at, input_tokens, output_tokens, cost_microusd FROM messages WHERE id = 'm-null'");
    expect(message).toMatchObject({ input_tokens: 0, output_tokens: 0, cost_microusd: 0 });
    expect(inWindow(message.created_at)).toBe(true);

    const daily = one("SELECT query_count, created_at, input_tokens, output_tokens FROM daily_usage WHERE date = '2026-03-01'");
    expect(daily).toMatchObject({ query_count: 0, input_tokens: 0, output_tokens: 0 });
    expect(inWindow(daily.created_at)).toBe(true);

    expect(inWindow(one("SELECT created_at FROM usage_events WHERE id = 'e-null'").created_at)).toBe(true);
    expect(inWindow(one("SELECT updated_at FROM rate_limits WHERE role = 'user'").updated_at)).toBe(true);

    for (const b of TIGHTEN_BACKFILLS) {
      const n = one(`SELECT count(*) AS n FROM ${b.table} WHERE ${b.column} IS NULL`).n;
      expect({ column: ref(b), nulls: n }).toEqual({ column: ref(b), nulls: 0 });
    }
  }

  for (const fixture of LEGACY_FIXTURES) {
    it(`fills NULLs with the documented values on the ${fixture} legacy fixture`, () => {
      const sqlite = openDatabase(":memory:");
      buildLegacyDb(sqlite, fixture);
      seedNullableRows(sqlite);
      const untouched = sqlite.query("SELECT * FROM users WHERE id = 'u-admin'").get() as Record<string, unknown>;

      const t0 = Math.floor(Date.now() / 1000);
      const result = runMigrations(sqlite);
      const t1 = Math.ceil(Date.now() / 1000);

      expect(result.adopted).toBe(true);
      expect(result.applied.map((m) => m.tag)).toContain(TIGHTEN_MIGRATION_TAG);
      expectBackfilled(sqlite, t0, t1);
      // Non-NULL values are left alone.
      expect(sqlite.query("SELECT * FROM users WHERE id = 'u-admin'").get()).toEqual(untouched);
    });
  }

  it("fills NULLs on a non-legacy DB migrated through 0002", () => {
    const sqlite = pre0003Db();
    seedNullableRows(sqlite);
    const t0 = Math.floor(Date.now() / 1000);
    const { applied } = runMigrations(sqlite);
    const t1 = Math.ceil(Date.now() / 1000);
    expect(applied.map((m) => m.tag)).toEqual(migrations.slice(migrations.indexOf(tighten)).map((m) => m.tag));
    expectBackfilled(sqlite, t0, t1);
  });
});

describe("0003_tighten_not_null — table recreation", () => {
  it("does not cascade-delete or SET NULL children of recreated tables; FK check passes", () => {
    const sqlite = pre0003Db();
    seedRelatedRows(sqlite);
    const counts = rowCounts(sqlite);
    const links = () =>
      sqlite
        .query("SELECT (SELECT reviewed_by FROM access_requests) AS reviewed_by, session_id, message_id FROM usage_events")
        .get();
    const before = links();
    expect(before).toEqual({ reviewed_by: "u1", session_id: "c1", message_id: "m1" });

    runMigrations(sqlite);

    expect(rowCounts(sqlite)).toEqual(counts);
    expect(links()).toEqual(before);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(foreignKeysEnabled(sqlite)).toBe(true);
    // Cascades still work afterwards (FKs point at the recreated tables).
    sqlite.run("DELETE FROM users WHERE id = 'u1'");
    expect(rowCounts(sqlite)).toMatchObject({ users: 0, chat_sessions: 0, messages: 0, daily_usage: 0, usage_events: 0 });
    expect(sqlite.query("SELECT reviewed_by FROM access_requests").get()).toEqual({ reviewed_by: null });
  });

  it("keeps the daily_usage AUTOINCREMENT high-water mark", () => {
    const sqlite = pre0003Db();
    seedRelatedRows(sqlite);
    sqlite.run("INSERT INTO daily_usage (user_id, date) VALUES ('u1', '2026-01-02'), ('u1', '2026-01-03')");
    sqlite.run("DELETE FROM daily_usage WHERE date = '2026-01-03'");
    expect(sequenceOf(sqlite, "daily_usage")).toBe(3);

    runMigrations(sqlite);

    expect(sequenceOf(sqlite, "daily_usage")).toBe(3);
    expect(sqlite.query("SELECT count(*) AS n FROM sqlite_sequence WHERE name LIKE '%daily_usage'").get()).toEqual({ n: 1 });
    sqlite.run("INSERT INTO daily_usage (user_id, date) VALUES ('u1', '2026-01-04')");
    expect(sqlite.query("SELECT max(id) AS id FROM daily_usage").get()).toEqual({ id: 4 });
  });

  it("keeps an empty daily_usage's sequence (all rows deleted)", () => {
    const sqlite = pre0003Db();
    seedRelatedRows(sqlite);
    sqlite.run("DELETE FROM daily_usage");
    runMigrations(sqlite);
    expect(sequenceOf(sqlite, "daily_usage")).toBe(1);
  });
});

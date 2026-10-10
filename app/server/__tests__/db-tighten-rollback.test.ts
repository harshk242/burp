/**
 * 0003_tighten_not_null failure path and the db:verify tightening report
 * (plans/drizzle-orm-migration.md §5, §6, §10).
 */
import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "fs";
import { join } from "path";
import { buildLegacyDb, dumpRows, type LegacyFixture } from "../__test-utils__/legacy";
import { foreignKeysEnabled, makeTempDir, schemaSnapshot } from "../__test-utils__/migrations";
import { autoindexes, NULL_PK_INSERTS, seedNullableRows } from "../__test-utils__/tighten";
import { previewTightening, TIGHTEN_BACKFILLS, TIGHTEN_MIGRATION_TAG, TIGHTENED_PRIMARY_KEYS } from "../db/backfills";
import { openDatabase } from "../db/connection";
import { hasMigrationsTable } from "../db/executor";
import { isLegacyDatabase, runMigrations } from "../db/migrate";
import { formatVerifyReport, verifyDatabase, verifyPassed } from "../db/verify";

const APP_DIR = join(import.meta.dir, "..", "..");
const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function legacyDb(fixture: LegacyFixture = "current", mutate?: (db: Database) => void): Database {
  const sqlite = openDatabase(":memory:");
  buildLegacyDb(sqlite, fixture);
  mutate?.(sqlite);
  return sqlite;
}

/** A closed legacy file DB, for db:verify. */
function legacyFile(mutate?: (db: Database) => void): string {
  const dir = makeTempDir("burp-tighten-verify-");
  tempDirs.push(dir);
  const path = join(dir, "prod-copy.db");
  const sqlite = openDatabase(path);
  buildLegacyDb(sqlite, "old-prod");
  mutate?.(sqlite);
  sqlite.close();
  return path;
}

const legacyAlterTable = (sqlite: Database) =>
  sqlite.query<{ legacy_alter_table: number }, []>("PRAGMA legacy_alter_table").get()!.legacy_alter_table;

describe("0003_tighten_not_null — NULL text PK rolls everything back", () => {
  for (const { table, column } of TIGHTENED_PRIMARY_KEYS) {
    it(`NULL ${table}.${column} in a legacy DB: migration fails, adoption is undone`, () => {
      const sqlite = legacyDb("current", (db) => db.run(NULL_PK_INSERTS[table]!));
      const before = { schema: schemaSnapshot(sqlite), rows: dumpRows(sqlite), autoindexes: autoindexes(sqlite) };
      expect(before.autoindexes).toContain("sqlite_autoindex_users_2"); // legacy inline UNIQUE(clerk_id)

      expect(() => runMigrations(sqlite)).toThrow(`NOT NULL constraint failed: __new_${table}.${column}`);

      expect(hasMigrationsTable(sqlite)).toBe(false);
      expect(isLegacyDatabase(sqlite)).toBe(true);
      expect({ schema: schemaSnapshot(sqlite), rows: dumpRows(sqlite), autoindexes: autoindexes(sqlite) }).toEqual(before);
      expect(sqlite.inTransaction).toBe(false);
      expect(foreignKeysEnabled(sqlite)).toBe(true);
      expect(legacyAlterTable(sqlite)).toBe(0);
    });
  }

  it("succeeds once the operator fixes the row by hand", () => {
    const sqlite = legacyDb("old-prod", (db) => db.run(NULL_PK_INSERTS.users!));
    expect(() => runMigrations(sqlite)).toThrow(/NOT NULL constraint failed/);
    sqlite.run("DELETE FROM users WHERE id IS NULL");
    expect(runMigrations(sqlite).applied.map((m) => m.tag)).toContain(TIGHTEN_MIGRATION_TAG);
  });
});

describe("previewTightening", () => {
  it("counts NULL cells per backfill, NULL-role users and NULL PKs", () => {
    const sqlite = legacyDb("current", (db) => {
      seedNullableRows(db);
      db.run(NULL_PK_INSERTS.users!);
      db.run(NULL_PK_INSERTS.rate_limits!);
    });
    const preview = previewTightening(sqlite);
    const counts = Object.fromEntries(preview.backfills.map((b) => [`${b.table}.${b.column}`, b.rows]));
    expect(Object.keys(counts)).toHaveLength(TIGHTEN_BACKFILLS.length);
    // seedNullableRows leaves one NULL per backfilled column (the NULL-PK rows only take defaults).
    for (const [column, rows] of Object.entries(counts)) expect({ column, rows }).toEqual({ column, rows: 1 });
    expect(preview.nullRoleUsers).toEqual([{ id: "u-null", email: "null@example.com", created_at: null }]);
    expect(preview.nullPrimaryKeys.map((p) => `${p.table}.${p.column}`)).toEqual(["users.id", "rate_limits.role"]);
  });

  it("treats tables/columns that don't exist yet as zero", () => {
    const sqlite = openDatabase(":memory:");
    sqlite.run("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT)");
    sqlite.run("INSERT INTO users VALUES (NULL, 'x@example.com')");
    const preview = previewTightening(sqlite);
    expect(preview.backfills.every((b) => b.rows === 0)).toBe(true);
    expect(preview.nullRoleUsers).toEqual([]);
    expect(preview.nullPrimaryKeys).toEqual([{ table: "users", column: "id", rowid: 1 }]);
  });
});

describe("db:verify — tightening report", () => {
  it("reports backfill counts and NULL-role users on a fixture copy that migrates", () => {
    const report = verifyDatabase(legacyFile(seedNullableRows));
    expect(verifyPassed(report)).toBe(true);
    expect(report.applied).toContain(TIGHTEN_MIGRATION_TAG);
    expect(report.tightening.backfills.filter((b) => b.rows > 0)).toHaveLength(TIGHTEN_BACKFILLS.length);
    expect(report.tightening.nullRoleUsers).toEqual([{ id: "u-null", email: "null@example.com", created_at: null }]);
    expect(report.tightening.nullPrimaryKeys).toEqual([]);

    const text = formatVerifyReport(report);
    expect(text).toContain(`${TIGHTEN_MIGRATION_TAG} backfills (NULL cells filled):`);
    expect(text).toContain("  - users.role → 'user': 1 row(s)");
    expect(text).toContain("  - messages.cost_microusd → 0: 1 row(s)");
    expect(text).toContain("  - access_requests.submitted_at → unixepoch(): 1 row(s)");
    expect(text).toContain("  - id=u-null email=null@example.com created_at=NULL");
    expect(text).toMatch(/NULL primary keys[^\n]*\n {2}\(none\)/);
  });

  it("reports nothing to fill on a clean fixture", () => {
    const report = verifyDatabase(legacyFile());
    expect(verifyPassed(report)).toBe(true);
    expect(report.tightening.backfills.every((b) => b.rows === 0)).toBe(true);
    expect(formatVerifyReport(report)).toMatch(/backfills \(NULL cells filled\):\n {2}\(none\)/);
  });

  it("says 0003 is already applied on a migrated DB", () => {
    const path = legacyFile((db) => runMigrations(db));
    const report = verifyDatabase(path);
    expect(report.pending).toEqual([]);
    expect(formatVerifyReport(report)).toContain(`${TIGHTEN_MIGRATION_TAG}: already applied`);
  });

  it("lists NULL-PK rows up front and the CLI exits 1 (rolled back)", () => {
    const input = legacyFile((db) => {
      db.run(NULL_PK_INSERTS.messages!);
      db.run("UPDATE users SET role = NULL WHERE id = 'u-user'");
    });
    const report = verifyDatabase(input);
    expect(report.ok).toBe(false);
    expect(report.error).toContain("NOT NULL constraint failed: __new_messages.id");
    expect(report.tightening.nullPrimaryKeys).toEqual([{ table: "messages", column: "id", rowid: 4 }]);
    expect(report.tightening.nullRoleUsers).toEqual([
      { id: "u-user", email: "user@example.com", created_at: 1700000100 },
    ]);

    const cli = Bun.spawnSync(["bun", "run", join("server", "db", "cli", "verify.ts"), input], {
      cwd: APP_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = cli.stdout.toString();
    expect(cli.exitCode).toBe(1);
    expect(stdout).toContain("  - messages.id IS NULL at rowid 4");
    expect(stdout).toContain("  - id=u-user email=user@example.com created_at=1700000100");
    expect(stdout).toContain("  - users.role → 'user': 1 row(s)");
    expect(stdout).toContain("Result:  FAILED — transaction rolled back");
  });
});

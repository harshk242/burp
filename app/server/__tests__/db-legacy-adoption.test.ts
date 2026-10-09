import { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { createTestDb } from "../__test-utils__/db";
import {
  buildLegacyDb,
  dumpRows,
  LEGACY_FIXTURES,
  mutateTable,
  CURRENT_LEGACY_SQL,
  sequenceOf,
  type LegacyFixture,
} from "../__test-utils__/legacy";
import {
  foreignKeysEnabled,
  historyRows,
  makeTempDir,
  migrationsFolderWith,
  schemaSnapshot,
} from "../__test-utils__/migrations";
import { openDatabase } from "../db/connection";
import { loadMigrations } from "../db/executor";
import { diffFingerprints, fingerprintSchema } from "../db/introspect";
import { isLegacyDatabase, runMigrations } from "../db/migrate";
import { MIGRATIONS_FOLDER } from "../db/paths";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = makeTempDir("burp-legacy-");
  tempDirs.push(dir);
  return dir;
};

function legacyDb(fixture: LegacyFixture): Database {
  const sqlite = openDatabase(":memory:");
  buildLegacyDb(sqlite, fixture);
  return sqlite;
}

const autoindexes = (sqlite: Database) =>
  sqlite
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name LIKE 'sqlite_autoindex_%' ORDER BY name")
    .all()
    .map((r) => r.name);

const legacyAlterTable = (sqlite: Database) =>
  sqlite.query<{ legacy_alter_table: number }, []>("PRAGMA legacy_alter_table").get()!.legacy_alter_table;

describe("legacy adoption — happy path", () => {
  const fresh = createTestDb().sqlite;

  for (const fixture of LEGACY_FIXTURES) {
    describe(`${fixture} fixture`, () => {
      it("adopts to exactly the fresh DB's sqlite_master and fingerprint", () => {
        const sqlite = legacyDb(fixture);
        expect(isLegacyDatabase(sqlite)).toBe(true);

        const result = runMigrations(sqlite);
        expect(result.adopted).toBe(true);
        expect(result.applied.map((m) => m.tag)).toEqual(["0001_tool_search_fts", "0002_seed_and_data_fixes"]);
        expect(result.transactionMs).toBeGreaterThan(0);

        expect(schemaSnapshot(sqlite)).toEqual(schemaSnapshot(fresh));
        expect(diffFingerprints(fingerprintSchema(sqlite), fingerprintSchema(fresh))).toEqual([]);
        expect(isLegacyDatabase(sqlite)).toBe(false);
        expect(foreignKeysEnabled(sqlite)).toBe(true);
        expect(legacyAlterTable(sqlite)).toBe(0);
      });

      it("records the same __drizzle_migrations rows as a fresh DB", () => {
        const sqlite = legacyDb(fixture);
        runMigrations(sqlite);
        const migrations = loadMigrations(MIGRATIONS_FOLDER);
        expect(historyRows(sqlite)).toEqual(migrations.map((m) => ({ hash: m.hash, created_at: m.folderMillis })));
        expect(historyRows(sqlite)).toEqual(historyRows(fresh));
      });

      it("replaces anonymous UNIQUE autoindexes with the named baseline indexes", () => {
        const sqlite = legacyDb(fixture);
        expect(autoindexes(sqlite)).toContain("sqlite_autoindex_users_2"); // inline UNIQUE clerk_id
        runMigrations(sqlite);

        // Only the autoindexes backing text PKs remain — same as a fresh DB.
        expect(autoindexes(sqlite)).toEqual(autoindexes(fresh));
        for (const name of autoindexes(sqlite)) {
          const table = sqlite.query<{ tbl_name: string }, [string]>("SELECT tbl_name FROM sqlite_master WHERE name = ?").get(name)!.tbl_name;
          const origin = sqlite
            .query<{ name: string; origin: string }, []>(`PRAGMA index_list("${table}")`)
            .all()
            .find((i) => i.name === name)!.origin;
          expect(origin).toBe("pk");
        }
        const named = sqlite
          .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%_unique' ORDER BY name")
          .all()
          .map((r) => r.name);
        expect(named).toEqual([
          "access_requests_email_unique",
          "daily_usage_user_id_date_unique",
          "users_clerk_id_unique",
          "users_email_unique",
        ]);
      });

      it("keeps every row (by column name), rowids and the AUTOINCREMENT high-water mark", () => {
        const sqlite = legacyDb(fixture);
        const before = dumpRows(sqlite);
        expect(sequenceOf(sqlite, "daily_usage")).toBe(3);
        runMigrations(sqlite);

        const expected = structuredClone(before);
        // Frozen catch-up / 0002 retire the waitlist role.
        for (const u of expected.users!) if (u.role === "waitlist") u.role = "user";
        expect(dumpRows(sqlite)).toEqual(expected);
        expect(expected.users!.some((u) => u.id === "u-wait")).toBe(true);
        expect(sequenceOf(sqlite, "daily_usage")).toBe(3);

        // New rows continue after the old high-water mark, not after max(id).
        sqlite.run("INSERT INTO daily_usage (user_id, date) VALUES ('u-user', '2026-02-01')");
        expect(sqlite.query("SELECT max(id) AS id FROM daily_usage").get()).toEqual({ id: 4 });
        expect(sqlite.query("SELECT count(*) AS n FROM tool_search_fts").get()).toEqual({ n: 1 });
      });

      it("is a no-op the second time", () => {
        const sqlite = legacyDb(fixture);
        runMigrations(sqlite);
        const before = { schema: schemaSnapshot(sqlite), history: historyRows(sqlite), rows: dumpRows(sqlite) };
        expect(runMigrations(sqlite)).toEqual({ applied: [], adopted: false, backupPath: null, transactionMs: null });
        expect({ schema: schemaSnapshot(sqlite), history: historyRows(sqlite), rows: dumpRows(sqlite) }).toEqual(before);
      });
    });
  }

  it("fixtures really differ from each other in representation before adoption", () => {
    const oldProd = legacyDb("old-prod");
    const sql = oldProd.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name = 'daily_usage'").get()!.sql;
    expect(sql).toContain("DEFAULT (unixepoch()), input_tokens INTEGER DEFAULT 0, output_tokens"); // ALTER-appended
    expect(schemaSnapshot(oldProd)).not.toEqual(schemaSnapshot(legacyDb("current")));

    const columns = (db: Database) =>
      db.query<{ name: string }, []>("PRAGMA table_info(users)").all().map((c) => c.name);
    expect(columns(legacyDb("reordered"))).not.toEqual(columns(fresh));
  });

  it("accepts a unique constraint expressed as a named UNIQUE INDEX instead of inline", () => {
    let schemaSql = mutateTable(CURRENT_LEGACY_SQL, "users", "email TEXT UNIQUE NOT NULL", "email TEXT NOT NULL");
    schemaSql += "\nCREATE UNIQUE INDEX legacy_users_email ON users(email);";
    const sqlite = openDatabase(":memory:");
    buildLegacyDb(sqlite, "current", { schemaSql });
    runMigrations(sqlite);
    expect(schemaSnapshot(sqlite)).toEqual(schemaSnapshot(fresh));
  });

  it("enforces constraints after adoption like a fresh DB (FK cascade, CHECK)", () => {
    const sqlite = legacyDb("old-prod");
    runMigrations(sqlite);
    expect(() => sqlite.run("INSERT INTO users (id, clerk_id, email, role) VALUES ('x', 'cx', 'x@e', 'root')")).toThrow(
      /CHECK constraint failed/,
    );
    sqlite.run("DELETE FROM users WHERE id = 'u-user'");
    expect(sqlite.query("SELECT count(*) AS n FROM messages WHERE chat_id = 'c-1'").get()).toEqual({ n: 0 });
  });
});

describe("legacy adoption — file databases", () => {
  it("takes a pre-drizzle backup of the un-adopted DB before adopting", () => {
    const dir = tempDir();
    const dbPath = join(dir, "app.db");
    const sqlite = openDatabase(dbPath);
    buildLegacyDb(sqlite, "old-prod");
    const before = { schema: schemaSnapshot(sqlite), rows: dumpRows(sqlite) };

    const { backupPath, adopted } = runMigrations(sqlite);
    sqlite.close();
    expect(adopted).toBe(true);
    expect(backupPath).toStartWith(join(dir, "backups", "app-pre-drizzle-"));
    expect(existsSync(backupPath!)).toBe(true);

    const backup = new Database(backupPath!, { readonly: true });
    expect(isLegacyDatabase(backup)).toBe(true);
    expect({ schema: schemaSnapshot(backup), rows: dumpRows(backup) }).toEqual(before);
    backup.close();
  });
});

describe("unique-constraint parity (fresh vs adopted)", () => {
  const dropClerkUnique = () => {
    const folder = migrationsFolderWith([
      { tag: "0900_test_drop_clerk_unique", statements: ["DROP INDEX `users_clerk_id_unique`;"] },
    ]);
    tempDirs.push(join(folder, ".."));
    return folder;
  };
  const insertUser = (sqlite: Database, id: string, email: string) =>
    sqlite.query("INSERT INTO users (id, clerk_id, email) VALUES (?, 'dup_clerk', ?)").run(id, email);

  const cases: Array<[string, () => Database]> = [
    ["fresh", () => createTestDb().sqlite],
    [
      "adopted",
      () => {
        const sqlite = legacyDb("current");
        runMigrations(sqlite);
        return sqlite;
      },
    ],
  ];

  for (const [label, make] of cases) {
    it(`${label}: duplicate clerk_id is rejected before the drop and accepted after`, () => {
      const sqlite = make();
      insertUser(sqlite, "p1", "p1@example.com");
      expect(() => insertUser(sqlite, "p2", "p2@example.com")).toThrow(/UNIQUE constraint failed: users\.clerk_id/);

      const { applied } = runMigrations(sqlite, { migrationsFolder: dropClerkUnique() });
      expect(applied.map((m) => m.tag)).toEqual(["0900_test_drop_clerk_unique"]);
      insertUser(sqlite, "p2", "p2@example.com");
      expect(sqlite.query("SELECT count(*) AS n FROM users WHERE clerk_id = 'dup_clerk'").get()).toEqual({ n: 2 });
      // Email uniqueness is untouched.
      expect(() => insertUser(sqlite, "p3", "p1@example.com")).toThrow(/UNIQUE constraint failed: users\.email/);
    });
  }
});

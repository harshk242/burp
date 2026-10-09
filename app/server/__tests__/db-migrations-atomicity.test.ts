import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { createTestDb } from "../__test-utils__/db";
import {
  foreignKeysEnabled,
  historyRows,
  makeTempDir,
  migrationsFolderWith,
  rowCounts,
  schemaSnapshot,
  seedRelatedRows,
  type ExtraMigration,
} from "../__test-utils__/migrations";
import { openDatabase } from "../db/connection";
import { loadMigrations } from "../db/executor";
import { MigrationFkError, runMigrations } from "../db/migrate";

const tempDirs: string[] = [];
const tempFolder = (extra: ExtraMigration[]) => {
  const folder = migrationsFolderWith(extra);
  tempDirs.push(join(folder, ".."));
  return folder;
};
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** drizzle-kit's table-recreation shape for `users` (e.g. tightening a column). */
const RECREATE_USERS: ExtraMigration = {
  tag: "0900_test_recreate_users",
  statements: [
    "PRAGMA foreign_keys=OFF;", // what drizzle-kit emits; a no-op inside the transaction
    `CREATE TABLE \`__new_users\` (
      \`id\` text PRIMARY KEY NOT NULL,
      \`clerk_id\` text NOT NULL,
      \`email\` text NOT NULL,
      \`name\` text,
      \`image_url\` text,
      \`role\` text DEFAULT 'waitlist',
      \`institution\` text,
      \`research_area\` text,
      \`total_queries\` integer DEFAULT 0,
      \`created_at\` integer DEFAULT (unixepoch()),
      \`last_active_at\` integer,
      \`daily_query_limit\` integer,
      \`daily_token_limit\` integer,
      \`daily_cost_limit_microusd\` integer,
      \`monthly_cost_limit_microusd\` integer,
      CONSTRAINT "users_role_check" CHECK(role IN ('waitlist', 'user', 'admin'))
    );`,
    'INSERT INTO `__new_users`("id", "clerk_id", "email", "name", "image_url", "role", "institution", "research_area", "total_queries", "created_at", "last_active_at", "daily_query_limit", "daily_token_limit", "daily_cost_limit_microusd", "monthly_cost_limit_microusd") SELECT "id", "clerk_id", "email", "name", "image_url", "role", "institution", "research_area", "total_queries", "created_at", "last_active_at", "daily_query_limit", "daily_token_limit", "daily_cost_limit_microusd", "monthly_cost_limit_microusd" FROM `users`;',
    "DROP TABLE `users`;",
    "ALTER TABLE `__new_users` RENAME TO `users`;",
    "PRAGMA foreign_keys=ON;",
    "CREATE UNIQUE INDEX `users_clerk_id_unique` ON `users` (`clerk_id`);",
    "CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);",
    "CREATE INDEX `idx_users_clerk_id` ON `users` (`clerk_id`);",
    "CREATE INDEX `idx_users_email` ON `users` (`email`);",
  ],
};

/** Schema change + an orphan row: must roll back as a unit. */
const ORPHAN_SESSION: ExtraMigration = {
  tag: "0901_test_orphan_session",
  statements: [
    "CREATE TABLE `should_not_survive` (`id` integer PRIMARY KEY)",
    "INSERT INTO chat_sessions (id, user_id, title) VALUES ('orphan', 'no-such-user', 'orphan')",
  ],
};

describe("table-recreation migrations", () => {
  it("do not cascade-delete child rows", () => {
    const { sqlite } = createTestDb();
    seedRelatedRows(sqlite);
    const before = rowCounts(sqlite);

    const { applied } = runMigrations(sqlite, { migrationsFolder: tempFolder([RECREATE_USERS]) });

    expect(applied.map((m) => m.tag)).toEqual([RECREATE_USERS.tag]);
    expect(rowCounts(sqlite)).toEqual(before);
    expect(sqlite.query("SELECT reviewed_by FROM access_requests").get()).toEqual({ reviewed_by: "u1" });
    expect(sqlite.query(`SELECT "notnull" FROM pragma_table_info('users') WHERE name = 'id'`).get()).toEqual({
      notnull: 1,
    });
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(foreignKeysEnabled(sqlite)).toBe(true);
  });

  it("would cascade-delete if foreign keys stayed on (control)", () => {
    const { sqlite } = createTestDb();
    seedRelatedRows(sqlite);
    sqlite.transaction(() => {
      for (const statement of RECREATE_USERS.statements) sqlite.prepare(statement).run();
    })();
    expect(rowCounts(sqlite).chat_sessions).toBe(0);
  });
});

describe("foreign key violations", () => {
  it("roll back data, schema and history, and re-enable foreign keys", () => {
    const { sqlite } = createTestDb();
    seedRelatedRows(sqlite);
    const before = { schema: schemaSnapshot(sqlite), history: historyRows(sqlite), counts: rowCounts(sqlite) };
    const folder = tempFolder([ORPHAN_SESSION]);
    const orphanHash = loadMigrations(folder).at(-1)!.hash;

    let error: unknown;
    try {
      runMigrations(sqlite, { migrationsFolder: folder });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(MigrationFkError);
    expect((error as MigrationFkError).violations).toEqual([
      { table: "chat_sessions", rowid: expect.any(Number), parent: "users", fkid: 0 },
    ]);
    expect(sqlite.query("SELECT 1 FROM chat_sessions WHERE id = 'orphan'").get()).toBeNull();
    expect(historyRows(sqlite).map((r) => r.hash)).not.toContain(orphanHash);
    expect({ schema: schemaSnapshot(sqlite), history: historyRows(sqlite), counts: rowCounts(sqlite) }).toEqual(
      before,
    );
    expect(foreignKeysEnabled(sqlite)).toBe(true);
    expect(sqlite.inTransaction).toBe(false);
  });

  it("leave the DB retryable once the migration is fixed", () => {
    const { sqlite } = createTestDb();
    expect(() => runMigrations(sqlite, { migrationsFolder: tempFolder([ORPHAN_SESSION]) })).toThrow(MigrationFkError);
    const fixed: ExtraMigration = { tag: ORPHAN_SESSION.tag, statements: [ORPHAN_SESSION.statements[0]!] };
    expect(runMigrations(sqlite, { migrationsFolder: tempFolder([fixed]) }).applied).toHaveLength(1);
  });
});

describe("pre-migrate backups", () => {
  it("skip empty databases, then VACUUM INTO a copy before applying pending work", () => {
    const dir = makeTempDir("burp-backup-");
    tempDirs.push(dir);
    const sqlite = openDatabase(join(dir, "app.db"));

    expect(runMigrations(sqlite).backupPath).toBeNull(); // fresh file: nothing to back up
    sqlite.run("INSERT INTO users (id, clerk_id, email) VALUES ('u', 'c', 'e')");
    const baseHistory = historyRows(sqlite);

    const { backupPath } = runMigrations(sqlite, { migrationsFolder: tempFolder([RECREATE_USERS]) });
    expect(backupPath).not.toBeNull();
    expect(existsSync(backupPath!)).toBe(true);

    const backup = openDatabase(backupPath!);
    expect(historyRows(backup)).toEqual(baseHistory); // state *before* the new migration
    expect(backup.query("SELECT id FROM users").all()).toEqual([{ id: "u" }]);
    backup.close();

    expect(runMigrations(sqlite).backupPath).toBeNull(); // nothing pending → no backup
    sqlite.close();
  });

  it("keep only the newest N backups", () => {
    const dir = makeTempDir("burp-backup-prune-");
    tempDirs.push(dir);
    const sqlite = openDatabase(join(dir, "app.db"));
    runMigrations(sqlite);

    const extras: ExtraMigration[] = [];
    for (let i = 0; i < 3; i++) {
      extras.push({ tag: `09${10 + i}_test_noop`, statements: [`CREATE TABLE t${i} (x)`] });
      runMigrations(sqlite, { migrationsFolder: tempFolder(extras), keepBackups: 2 });
    }
    expect(readdirSync(join(dir, "backups"))).toHaveLength(2);
    sqlite.close();
  });
});

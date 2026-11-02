import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { readdirSync, rmSync } from "fs";
import { join } from "path";
import { buildLegacyDb, CURRENT_LEGACY_SQL, mutateTable, replaceTable } from "../__test-utils__/legacy";
import { foreignKeysEnabled, makeTempDir, migrationsFolderWith } from "../__test-utils__/migrations";
import { openDatabase } from "../db/connection";
import { hasMigrationsTable } from "../db/executor";
import { LegacyAdoptionError } from "../db/legacy";
import { isLegacyDatabase, MigrationFkError, runMigrations } from "../db/migrate";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

interface NegativeCase {
  name: string;
  schemaSql: string;
  diff: string;
  stage?: LegacyAdoptionError["stage"];
  seed?: boolean;
}

const sql = CURRENT_LEGACY_SQL;
const CASES: NegativeCase[] = [
  {
    name: "role CHECK without 'admin'",
    schemaSql: mutateTable(sql, "users", "('waitlist', 'user', 'admin')", "('waitlist', 'user')"),
    diff: "users: missing check role in ( 'waitlist' , 'user' , 'admin' )",
    seed: false,
  },
  {
    name: "missing operation = 'chat' CHECK",
    schemaSql: mutateTable(sql, "usage_events", " CHECK (operation = 'chat')", ""),
    diff: "usage_events: missing check operation = 'chat'",
  },
  {
    name: "missing idx_messages_chat_id",
    schemaSql: sql.replace("CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);", ""),
    diff: "messages: missing index idx_messages_chat_id: (chat_id)",
  },
  {
    name: "idx_messages_chat_id on the wrong column",
    schemaSql: sql.replace("idx_messages_chat_id ON messages(chat_id)", "idx_messages_chat_id ON messages(role)"),
    diff: "messages: unexpected index idx_messages_chat_id: (role)",
  },
  {
    name: "wrong column type",
    schemaSql: mutateTable(sql, "chat_sessions", "title TEXT", "title INTEGER"),
    diff: "chat_sessions.title: type INTEGER, expected TEXT",
  },
  {
    name: "wrong nullability",
    schemaSql: mutateTable(sql, "access_requests", "name TEXT NOT NULL", "name TEXT"),
    diff: "access_requests.name: nullable, expected NOT NULL",
  },
  {
    name: "missing FK",
    schemaSql: mutateTable(sql, "chat_sessions", "user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE", "user_id TEXT NOT NULL"),
    diff: "chat_sessions: missing foreign key (user_id) -> users(id) on delete cascade",
  },
  {
    name: "wrong ON DELETE",
    schemaSql: mutateTable(sql, "access_requests", "ON DELETE SET NULL", "ON DELETE CASCADE"),
    diff: "access_requests: unexpected foreign key (reviewed_by) -> users(id) on delete cascade",
  },
  {
    name: "missing UNIQUE on users.email",
    schemaSql: mutateTable(sql, "users", "email TEXT UNIQUE NOT NULL", "email TEXT NOT NULL"),
    diff: "users: missing unique email",
  },
  {
    name: "missing AUTOINCREMENT on daily_usage",
    schemaSql: mutateTable(sql, "daily_usage", "PRIMARY KEY AUTOINCREMENT", "PRIMARY KEY"),
    diff: "daily_usage: missing AUTOINCREMENT",
  },
  {
    name: "extra column",
    schemaSql: mutateTable(sql, "chat_sessions", "title TEXT,", "title TEXT, pinned INTEGER,"),
    diff: "chat_sessions: unexpected column pinned",
  },
  {
    name: "extra trigger",
    schemaSql: `${sql}\nCREATE TRIGGER touch_session AFTER INSERT ON messages BEGIN UPDATE chat_sessions SET updated_at = 1 WHERE id = NEW.chat_id; END;`,
    diff: "unexpected object trigger touch_session",
  },
  {
    name: "missing table (catch-up ALTER fails for a reason other than a duplicate column)",
    schemaSql: replaceTable(sql, "daily_usage", "").replace(
      "CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date ON daily_usage(user_id, date);",
      "",
    ),
    diff: "no such table: daily_usage",
    stage: "catch-up",
    seed: false,
  },
];

function state(sqlite: Database) {
  return {
    bytes: Buffer.from(sqlite.serialize()).toString("base64"),
    legacy: isLegacyDatabase(sqlite),
    history: hasMigrationsTable(sqlite),
    foreignKeys: foreignKeysEnabled(sqlite),
    legacyAlterTable: sqlite.query<{ legacy_alter_table: number }, []>("PRAGMA legacy_alter_table").get()!.legacy_alter_table,
    inTransaction: sqlite.inTransaction,
  };
}

describe("legacy adoption — negative cases throw and leave the DB unchanged", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const sqlite = openDatabase(":memory:");
      buildLegacyDb(sqlite, "current", { schemaSql: c.schemaSql, seed: c.seed ?? true });
      const before = state(sqlite);

      let error: unknown;
      try {
        runMigrations(sqlite);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(LegacyAdoptionError);
      const adoption = error as LegacyAdoptionError;
      expect(adoption.stage).toBe(c.stage ?? "fingerprint");
      expect(adoption.diffs.some((d) => d.includes(c.diff))).toBe(true);
      expect(adoption.message).toContain(c.diff);

      expect(state(sqlite)).toEqual(before);
    });
  }

  it("a file DB is unchanged too (and the backup was still taken)", () => {
    const dir = makeTempDir("burp-legacy-neg-");
    tempDirs.push(dir);
    const sqlite = openDatabase(join(dir, "app.db"));
    buildLegacyDb(sqlite, "current", { schemaSql: CASES[2]!.schemaSql });
    const before = state(sqlite);
    expect(() => runMigrations(sqlite)).toThrow(LegacyAdoptionError);
    expect(state(sqlite)).toEqual(before);
    expect(readdirSync(join(dir, "backups")).some((f) => f.startsWith("app-pre-drizzle-"))).toBe(true);
    sqlite.close();
  });

  it("a failure after the rebuild (FK violation in a later migration) rolls back the whole adoption", () => {
    const folder = migrationsFolderWith([
      {
        tag: "0900_test_orphan",
        statements: ["INSERT INTO chat_sessions (id, user_id) VALUES ('orphan', 'no-such-user');"],
      },
    ]);
    tempDirs.push(join(folder, ".."));
    const sqlite = openDatabase(":memory:");
    buildLegacyDb(sqlite, "old-prod");
    const before = state(sqlite);

    expect(() => runMigrations(sqlite, { migrationsFolder: folder })).toThrow(MigrationFkError);
    expect(state(sqlite)).toEqual(before);
    const names = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
    expect(names).toContain("sqlite_autoindex_users_2");
    expect(names).not.toContain("users_clerk_id_unique");
  });
});

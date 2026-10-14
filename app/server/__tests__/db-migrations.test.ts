import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";
import { join } from "path";
import { createTestDb } from "../__test-utils__/db";
import { CURRENT_LEGACY_SQL as LEGACY_SCHEMA_SQL } from "../__test-utils__/legacy";
import { foreignKeysEnabled, historyRows, schemaSnapshot } from "../__test-utils__/migrations";
import { openDatabase } from "../db/connection";
import { applyPendingMigrations, loadMigrations, pendingMigrations } from "../db/executor";
import { baselineDatabase } from "../db/legacy";
import { runMigrations } from "../db/migrate";
import { MIGRATIONS_FOLDER, PROJECT_ROOT, resolveDbPath } from "../db/paths";

const TABLES = ["access_requests", "chat_sessions", "daily_usage", "messages", "rate_limits", "usage_events", "users"];

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
type FkInfo = { table: string; from: string; to: string; on_delete: string; on_update: string };

function describeTable(sqlite: Database, table: string) {
  const columns = sqlite
    .query<ColumnInfo, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => ({
      name: c.name,
      type: c.type.toUpperCase(),
      // INTEGER rowid-alias PKs can never be NULL, so NOT NULL on them is implied.
      notnull: c.notnull === 1 || (c.pk === 1 && c.type.toUpperCase() === "INTEGER"),
      dflt: c.dflt_value,
      pk: c.pk,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const fks = sqlite
    .query<FkInfo, []>(`PRAGMA foreign_key_list(${table})`)
    .all()
    .map((f) => `${f.from}→${f.table}.${f.to} del=${f.on_delete} upd=${f.on_update}`)
    .sort();
  const indexes = sqlite
    .query<{ name: string; unique: number; origin: string; partial: number }, []>(`PRAGMA index_list(${table})`)
    .all()
    .filter((i) => i.origin !== "pk")
    .map((i) => {
      const cols = sqlite
        .query<{ name: string }, []>(`PRAGMA index_info("${i.name}")`)
        .all()
        .map((c) => c.name)
        .join(",");
      return i.unique ? `unique(${cols})` : `${i.name}(${cols}) partial=${i.partial}`;
    })
    .sort();
  return { columns, fks, indexes };
}

function tableNames(sqlite: Database): string[] {
  return sqlite
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);
}

describe("fresh database migrations", () => {
  it("creates all tables, indexes, FTS and seed rows", () => {
    const { sqlite } = createTestDb();
    const names = tableNames(sqlite);
    for (const t of [...TABLES, "tool_search_fts", "__drizzle_migrations"]) expect(names).toContain(t);

    const indexes = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    expect(indexes).toEqual([
      "access_requests_email_unique",
      "daily_usage_user_id_date_unique",
      "idx_access_requests_email",
      "idx_access_requests_status",
      "idx_artifacts_expires_at",
      "idx_artifacts_session_id",
      "idx_chat_sessions_user_id",
      "idx_chat_turns_session_id",
      "idx_daily_usage_user_date",
      "idx_message_feedback_sync_pending",
      "idx_messages_chat_id",
      "idx_model_transcript_turn_id",
      "idx_usage_events_message_id",
      "idx_usage_events_turn_id",
      "idx_usage_events_user_date",
      "idx_usage_events_user_month",
      "idx_users_clerk_id",
      "idx_users_email",
      "uq_message_feedback_message_user",
      "uq_model_transcript_session_seq",
      "users_clerk_id_unique",
      "users_email_unique",
    ]);

    expect(sqlite.query("SELECT role, daily_limit FROM rate_limits ORDER BY role").all()).toEqual([
      { role: "admin", daily_limit: -1 },
      { role: "user", daily_limit: 50 },
    ]);
    expect(historyRows(sqlite)).toHaveLength(loadMigrations(MIGRATIONS_FOLDER).length);
    expect(foreignKeysEnabled(sqlite)).toBe(true);
  });

  it("baseline 0000 matches the legacy schema.sql column-for-column, FK-for-FK and index-for-index", () => {
    const sqlite = baselineDatabase(loadMigrations(MIGRATIONS_FOLDER)[0]!);
    const legacy = new Database(":memory:");
    legacy.exec(LEGACY_SCHEMA_SQL);
    for (const t of TABLES) {
      expect({ table: t, ...describeTable(sqlite, t) }).toEqual({ table: t, ...describeTable(legacy, t) });
    }
    const autoincrement = (db: Database) =>
      /AUTOINCREMENT/i.test(
        db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name = 'daily_usage'").get()!.sql,
      );
    expect(autoincrement(sqlite)).toBe(true);
    expect(autoincrement(legacy)).toBe(true);
  });

  it("enforces the CHECK constraints", () => {
    const { sqlite } = createTestDb();
    expect(() => sqlite.run("INSERT INTO users (id, clerk_id, email, role) VALUES ('u', 'c', 'e', 'root')")).toThrow(
      /CHECK constraint failed/,
    );
    sqlite.run("INSERT INTO users (id, clerk_id, email) VALUES ('u', 'c', 'e')");
    expect(sqlite.query("SELECT role FROM users").get()).toEqual({ role: "waitlist" });
    expect(() =>
      sqlite.run("INSERT INTO access_requests (id, email, name, status) VALUES ('a', 'e', 'n', 'maybe')"),
    ).toThrow(/CHECK constraint failed/);
    sqlite.run("INSERT INTO chat_sessions (id, user_id) VALUES ('c', 'u')");
    expect(() => sqlite.run("INSERT INTO messages (id, chat_id, role) VALUES ('m', 'c', 'system')")).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => sqlite.run("INSERT INTO rate_limits (role, daily_limit) VALUES ('waitlist', 1)")).toThrow(
      /CHECK constraint failed/,
    );
    expect(() =>
      sqlite.run(
        `INSERT INTO usage_events (id, user_id, date, month, operation, provider, model,
           input_cost_per_mtok_microusd, output_cost_per_mtok_microusd)
         VALUES ('e', 'u', 'd', 'm', 'embed', 'p', 'm', 1, 1)`,
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it("enforces foreign keys and cascades like the legacy schema", () => {
    const { sqlite } = createTestDb();
    expect(() => sqlite.run("INSERT INTO chat_sessions (id, user_id) VALUES ('c', 'ghost')")).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    sqlite.run("INSERT INTO users (id, clerk_id, email) VALUES ('u', 'c', 'e')");
    sqlite.run("INSERT INTO chat_sessions (id, user_id) VALUES ('c', 'u')");
    sqlite.run("INSERT INTO messages (id, chat_id, role) VALUES ('m', 'c', 'user')");
    sqlite.run("DELETE FROM users WHERE id = 'u'");
    expect(sqlite.query("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 0 });
  });

  it("creates a working FTS5 table", () => {
    const { sqlite } = createTestDb();
    sqlite.run(
      "INSERT INTO tool_search_fts (full_name, server, tool_name, description) VALUES ('s.t', 's', 't', 'searching proteins')",
    );
    expect(sqlite.query("SELECT full_name FROM tool_search_fts WHERE tool_search_fts MATCH 'protein'").all()).toEqual([
      { full_name: "s.t" },
    ]);
  });

  it("is a no-op when run twice", () => {
    const { sqlite } = createTestDb();
    const before = { schema: schemaSnapshot(sqlite), history: historyRows(sqlite) };
    expect(runMigrations(sqlite)).toEqual({ applied: [], adopted: false, backupPath: null, transactionMs: null });
    expect({ schema: schemaSnapshot(sqlite), history: historyRows(sqlite) }).toEqual(before);
  });

  it("refuses to run inside an existing transaction", () => {
    const sqlite = openDatabase(":memory:");
    sqlite.transaction(() => {
      expect(() => runMigrations(sqlite)).toThrow(/inside a transaction/);
    })();
    expect(() => applyPendingMigrations(sqlite, loadMigrations(MIGRATIONS_FOLDER))).toThrow(/caller-owned/);
  });
});

describe("executor compatibility with drizzle-orm migrate()", () => {
  it("drizzle's migrate() is a no-op after our executor applied everything", () => {
    const { sqlite } = createTestDb();
    const before = { schema: schemaSnapshot(sqlite), history: historyRows(sqlite) };
    drizzleMigrate(drizzle({ client: sqlite }), { migrationsFolder: MIGRATIONS_FOLDER });
    expect({ schema: schemaSnapshot(sqlite), history: historyRows(sqlite) }).toEqual(before);
  });

  it("a DB migrated by drizzle's migrate() has nothing pending for our executor", () => {
    const sqlite = openDatabase(":memory:");
    drizzleMigrate(drizzle({ client: sqlite }), { migrationsFolder: MIGRATIONS_FOLDER });
    expect(pendingMigrations(sqlite, loadMigrations(MIGRATIONS_FOLDER))).toEqual([]);
    expect(runMigrations(sqlite).applied).toEqual([]);

    const ours = createTestDb().sqlite;
    const skip = ["__drizzle_migrations"];
    expect(schemaSnapshot(sqlite, skip)).toEqual(schemaSnapshot(ours, skip));
    expect(historyRows(sqlite)).toEqual(historyRows(ours));
    expect(ours.query("SELECT * FROM rate_limits ORDER BY role").all()).toHaveLength(2);
  });
});

describe("resolveDbPath", () => {
  it("passes :memory: through and resolves relative paths against the repo root", () => {
    expect(resolveDbPath(":memory:")).toBe(":memory:");
    expect(resolveDbPath("/abs/app.db")).toBe("/abs/app.db");
    expect(resolveDbPath("./data/app.db")).toBe(join(PROJECT_ROOT, "data", "app.db"));
  });
});

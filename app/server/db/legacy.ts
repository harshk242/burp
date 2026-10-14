import { Database } from "bun:sqlite";
import { ensureMigrationsTable, recordMigration } from "./executor";
import { diffFingerprints, fingerprintSchema, isFingerprintedTable, quoteIdent } from "./introspect";
import type { MigrationMeta } from "drizzle-orm/migrator";

export const LEGACY_CATCH_UP: readonly string[] = [
  "ALTER TABLE users ADD COLUMN daily_query_limit INTEGER",
  "ALTER TABLE users ADD COLUMN daily_token_limit INTEGER",
  "ALTER TABLE users ADD COLUMN daily_cost_limit_microusd INTEGER",
  "ALTER TABLE users ADD COLUMN monthly_cost_limit_microusd INTEGER",
  "ALTER TABLE daily_usage ADD COLUMN input_tokens INTEGER DEFAULT 0",
  "ALTER TABLE daily_usage ADD COLUMN output_tokens INTEGER DEFAULT 0",
  "ALTER TABLE messages ADD COLUMN input_tokens INTEGER DEFAULT 0",
  "ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT 0",
  "ALTER TABLE messages ADD COLUMN reasoning TEXT",
  "ALTER TABLE messages ADD COLUMN cost_microusd INTEGER DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      month TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'chat' CHECK (operation = 'chat'),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      input_cost_per_mtok_microusd INTEGER NOT NULL,
      output_cost_per_mtok_microusd INTEGER NOT NULL,
      cost_microusd INTEGER NOT NULL DEFAULT 0,
      session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
  "CREATE INDEX IF NOT EXISTS idx_usage_events_user_date ON usage_events(user_id, date)",
  "CREATE INDEX IF NOT EXISTS idx_usage_events_user_month ON usage_events(user_id, month)",
  "CREATE INDEX IF NOT EXISTS idx_usage_events_message_id ON usage_events(message_id)",
  "UPDATE users SET role = 'user' WHERE role = 'waitlist'",
];

export type AdoptionStage = "catch-up" | "fingerprint" | "rebuild";

export class LegacyAdoptionError extends Error {
  constructor(
    readonly stage: AdoptionStage,
    readonly diffs: string[],
  ) {
    const detail = diffs.slice(0, 20).map((d) => `\n  - ${d}`).join("");
    const more = diffs.length > 20 ? `\n  … ${diffs.length - 20} more` : "";
    super(`Legacy database adoption failed at ${stage}; nothing was changed.${detail}${more}`);
    this.name = "LegacyAdoptionError";
  }
}

const LEGACY_PREFIX = "__legacy_";

/** Fresh in-memory DB with only the baseline applied — the adoption target. Caller closes it. */
export function baselineDatabase(baseline: MigrationMeta): Database {
  const reference = new Database(":memory:");
  for (const statement of baseline.sql) reference.prepare(statement).run();
  return reference;
}

/** Fingerprint differences between `sqlite` and the baseline (read-only). */
export function baselineDiffs(sqlite: Database, baseline: MigrationMeta): string[] {
  const reference = baselineDatabase(baseline);
  try {
    return diffFingerprints(fingerprintSchema(sqlite), fingerprintSchema(reference));
  } finally {
    reference.close();
  }
}

/**
 * Adopt a legacy DB: catch-up ALTERs → semantic verify → canonical rebuild →
 * exact verify → record `baseline`. Must run inside the caller's transaction
 * with foreign keys already OFF (so dropping the old tables doesn't cascade).
 */
export function adoptLegacyDatabase(sqlite: Database, baseline: MigrationMeta): void {
  if (!sqlite.inTransaction) throw new Error("adoptLegacyDatabase() must run inside a caller-owned transaction");

  runCatchUp(sqlite);
  const reference = baselineDatabase(baseline);
  try {
    const diffs = diffFingerprints(fingerprintSchema(sqlite), fingerprintSchema(reference));
    if (diffs.length > 0) throw new LegacyAdoptionError("fingerprint", diffs);

    rebuildTables(sqlite, baseline, reference);

    const post = diffMultiset(schemaRows(sqlite), schemaRows(reference));
    if (post.length > 0) throw new LegacyAdoptionError("rebuild", post);
  } finally {
    reference.close();
  }

  ensureMigrationsTable(sqlite);
  recordMigration(sqlite, baseline);
}

/** Frozen ALTER catch-up; caller owns the transaction. */
export function runCatchUp(sqlite: Database): void {
  for (const statement of LEGACY_CATCH_UP) {
    try {
      sqlite.run(statement);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/^\s*ALTER\s+TABLE\b.*\bADD\s+COLUMN\b/is.test(statement) && /duplicate column name/i.test(message)) continue;
      throw new LegacyAdoptionError("catch-up", [`${statement.split("\n")[0]}: ${message}`]);
    }
  }
}

/**
 * SQLite's table-rebuild procedure for every baseline table, done so the
 * result's sqlite_master text equals a fresh `0000` DB's exactly:
 *
 * the old tables are renamed away (with `legacy_alter_table` ON, so FK
 * references in other tables keep pointing at the canonical names) and the
 * canonical tables are created under their real names with the verbatim `0000`
 * DDL. The textbook order — create `__new_x`, then rename it to `x` — would make
 * SQLite rewrite the header to `CREATE TABLE "x"`, which differs from a fresh
 * DB. Views/triggers that would be affected by the legacy rename mode are
 * already rejected by the fingerprint.
 */
function rebuildTables(sqlite: Database, baseline: MigrationMeta, reference: Database): void {
  const createTables: string[] = [];
  const createIndexes: string[] = [];
  for (const statement of baseline.sql) {
    if (/^\s*CREATE\s+TABLE\b/i.test(statement)) createTables.push(statement);
    else if (/^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(statement)) createIndexes.push(statement);
    else throw new Error(`Baseline migration contains a non-DDL statement: ${statement.slice(0, 80)}`);
  }

  const tables = reference
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name)
    .filter(isFingerprintedTable);
  const sequences = savedSequences(sqlite, tables);

  const named = sqlite
    .query<{ name: string; tbl_name: string }, []>("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
    .all()
    .filter((r) => tables.includes(r.tbl_name));
  for (const idx of named) sqlite.run(`DROP INDEX ${quoteIdent(idx.name)}`);

  const legacyAlter = sqlite.query<{ legacy_alter_table: number }, []>("PRAGMA legacy_alter_table").get()!.legacy_alter_table;
  sqlite.run("PRAGMA legacy_alter_table = ON"); // connection flag, not rolled back → restored below
  try {
    for (const t of tables) sqlite.run(`ALTER TABLE ${quoteIdent(t)} RENAME TO ${quoteIdent(LEGACY_PREFIX + t)}`);
  } finally {
    sqlite.run(`PRAGMA legacy_alter_table = ${legacyAlter ? "ON" : "OFF"}`);
  }

  for (const statement of createTables) sqlite.prepare(statement).run();

  for (const t of tables) {
    const info = reference
      .query<{ name: string; type: string; pk: number }, []>(`PRAGMA table_info(${quoteIdent(t)})`)
      .all();
    const pk = info.filter((c) => c.pk > 0);
    const rowidAlias = pk.length === 1 && pk[0]!.type.toUpperCase() === "INTEGER";
    const cols = [...(rowidAlias ? [] : ["rowid"]), ...info.map((c) => quoteIdent(c.name))].join(", ");
    sqlite.run(`INSERT INTO ${quoteIdent(t)} (${cols}) SELECT ${cols} FROM ${quoteIdent(LEGACY_PREFIX + t)}`);
  }

  for (const t of tables) sqlite.run(`DROP TABLE ${quoteIdent(LEGACY_PREFIX + t)}`);
  restoreSequences(sqlite, sequences);

  for (const statement of createIndexes) sqlite.prepare(statement).run();
}

/** AUTOINCREMENT high-water marks; rebuilding would otherwise reset them to max(id). */
function savedSequences(sqlite: Database, tables: string[]): Array<{ name: string; seq: number }> {
  const hasSequenceTable = sqlite.query("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").get() !== null;
  if (!hasSequenceTable) return [];
  return sqlite
    .query<{ name: string; seq: number }, []>("SELECT name, seq FROM sqlite_sequence")
    .all()
    .filter((r) => tables.includes(r.name));
}

function restoreSequences(sqlite: Database, sequences: Array<{ name: string; seq: number }>): void {
  for (const { name, seq } of sequences) {
    sqlite.query("DELETE FROM sqlite_sequence WHERE name = ?").run(name);
    sqlite.query("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(name, seq);
  }
}

/** sqlite_master rows outside bookkeeping/FTS, verbatim (`type|name|tbl_name|sql`). */
export function schemaRows(sqlite: Database): string[] {
  return sqlite
    .query<{ type: string; name: string; tbl_name: string; sql: string | null }, []>(
      "SELECT type, name, tbl_name, sql FROM sqlite_master",
    )
    .all()
    .filter((r) => r.tbl_name === "sqlite_sequence" || isFingerprintedTable(r.tbl_name))
    .map((r) => `${r.type}|${r.name}|${r.tbl_name}|${r.sql ?? ""}`)
    .sort();
}

function diffMultiset(actual: string[], expected: string[]): string[] {
  const missing = expected.filter((r) => !actual.includes(r)).map((r) => `missing schema object ${r}`);
  const unexpected = actual.filter((r) => !expected.includes(r)).map((r) => `unexpected schema object ${r}`);
  return [...missing, ...unexpected];
}

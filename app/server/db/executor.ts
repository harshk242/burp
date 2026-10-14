/**
 * Migration executor: applies drizzle-kit migration files inside a transaction
 * owned by the caller.
 *
 * Bookkeeping mirrors drizzle-orm 0.45.4 `SQLiteSyncDialect.migrate`
 * (sqlite-core/dialect.ts) exactly, so a DB is interchangeable between this
 * executor and Drizzle's own `migrate()`:
 * - same `__drizzle_migrations` table DDL (`id SERIAL PRIMARY KEY` — not a rowid
 *   alias, so `id` stays NULL; that is Drizzle's behaviour, kept on purpose);
 * - "pending" = `folderMillis` greater than the `created_at` of the newest row,
 *   read once before applying anything;
 * - statements split on `--> statement-breakpoint` (by `readMigrationFiles`), each
 *   chunk prepared and run on its own — like Drizzle, only the first statement of
 *   a chunk executes, so custom migrations need one statement per breakpoint;
 * - one `(hash, created_at)` history row per migration.
 *
 * Unlike Drizzle we never BEGIN/COMMIT here: the caller wraps the work in its own
 * transaction so it can run `PRAGMA foreign_key_check` before committing (§7).
 * drizzle-orm is exact-pinned; the compatibility test guards upgrades.
 */
import type { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

export const MIGRATIONS_TABLE = "__drizzle_migrations";

export interface Migration extends MigrationMeta {
  /** Journal tag, e.g. `0000_baseline` (for logs; bookkeeping only uses hash + folderMillis). */
  tag: string;
}

interface HistoryRow {
  id: number | null;
  hash: string;
  created_at: number | string | null;
}

export function loadMigrations(migrationsFolder: string): Migration[] {
  const metas = readMigrationFiles({ migrationsFolder });
  const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf-8")) as {
    entries: Array<{ tag: string }>;
  };
  return metas.map((meta, i) => ({ ...meta, tag: journal.entries[i]!.tag }));
}

export function hasMigrationsTable(sqlite: Database): boolean {
  return (
    sqlite
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(MIGRATIONS_TABLE) !== null
  );
}

export function ensureMigrationsTable(sqlite: Database): void {
  sqlite.run(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`,
  );
}

/** Newest history row, or undefined when nothing has been recorded. Read-only. */
export function lastAppliedMigration(sqlite: Database): HistoryRow | undefined {
  if (!hasMigrationsTable(sqlite)) return undefined;
  const row = sqlite
    .query<HistoryRow, []>(
      `SELECT id, hash, created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`,
    )
    .get();
  return row ?? undefined;
}

/** Drizzle's pending rule: everything newer than the newest recorded migration. */
export function pendingMigrations<M extends MigrationMeta>(sqlite: Database, migrations: M[]): M[] {
  const last = lastAppliedMigration(sqlite);
  if (!last) return migrations;
  const lastMillis = Number(last.created_at);
  return migrations.filter((m) => lastMillis < m.folderMillis);
}

export function recordMigration(sqlite: Database, migration: MigrationMeta): void {
  sqlite
    .query(`INSERT INTO "${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES (?, ?)`)
    .run(migration.hash, migration.folderMillis);
}

/** Run one migration's statements and record it. Caller owns the transaction. */
export function applyMigration(sqlite: Database, migration: MigrationMeta): void {
  for (const statement of migration.sql) {
    sqlite.prepare(statement).run();
  }
  recordMigration(sqlite, migration);
}

/**
 * Apply every pending migration in order and return what was applied.
 * Must run inside a transaction so the caller decides whether it commits.
 */
export function applyPendingMigrations<M extends MigrationMeta>(sqlite: Database, migrations: M[]): M[] {
  if (!sqlite.inTransaction) {
    throw new Error("applyPendingMigrations() must run inside a caller-owned transaction");
  }
  ensureMigrationsTable(sqlite);
  const pending = pendingMigrations(sqlite, migrations);
  for (const migration of pending) applyMigration(sqlite, migration);
  return pending;
}

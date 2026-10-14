/**
 * FKs must be switched off *outside* the transaction (the pragma is a no-op
 * inside one), otherwise a drizzle-kit table recreation (`DROP TABLE x`) would
 * cascade-delete child rows.
 */
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { basename, dirname, extname, join } from "path";
import { applyPendingMigrations, hasMigrationsTable, loadMigrations, pendingMigrations, type Migration } from "./executor";
import { adoptLegacyDatabase } from "./legacy";
import { isMemoryDbPath, MIGRATIONS_FOLDER } from "./paths";

export interface ForeignKeyViolation {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

export class MigrationFkError extends Error {
  constructor(readonly violations: ForeignKeyViolation[]) {
    const sample = violations
      .slice(0, 5)
      .map((v) => `${v.table}(rowid ${v.rowid}) → ${v.parent}`)
      .join(", ");
    super(`Migration rolled back: ${violations.length} foreign key violation(s): ${sample}`);
    this.name = "MigrationFkError";
  }
}

export interface RunMigrationsOptions {
  migrationsFolder?: string;
  backupDir?: string;
  keepBackups?: number;
  backup?: boolean;
}

export interface RunMigrationsResult {
  applied: Migration[];
  adopted: boolean;
  backupPath: string | null;
  transactionMs: number | null;
}

export function runMigrations(sqlite: Database, options: RunMigrationsOptions = {}): RunMigrationsResult {
  if (sqlite.inTransaction) {
    // PRAGMA foreign_keys can't change inside a transaction
    throw new Error("runMigrations() must not be called inside a transaction");
  }

  const migrations = loadMigrations(options.migrationsFolder ?? MIGRATIONS_FOLDER);
  const legacy = isLegacyDatabase(sqlite);
  if (!legacy && pendingMigrations(sqlite, migrations).length === 0) {
    return { applied: [], adopted: false, backupPath: null, transactionMs: null };
  }

  const backupPath =
    options.backup === false ? null : backupBeforeMigrate(sqlite, options, legacy ? "pre-drizzle" : "pre-migrate");

  sqlite.run("PRAGMA foreign_keys = OFF");
  const started = performance.now();
  try {
    const result = sqlite.transaction(() => {
      const adopted = isLegacyDatabase(sqlite);
      if (adopted) adoptLegacyDatabase(sqlite, migrations[0]!);
      const applied = applyPendingMigrations(sqlite, migrations);
      const violations = sqlite.query<ForeignKeyViolation, []>("PRAGMA foreign_key_check").all();
      if (violations.length > 0) throw new MigrationFkError(violations);
      return { applied, adopted };
    }).immediate();
    return { ...result, backupPath, transactionMs: performance.now() - started };
  } finally {
    sqlite.run("PRAGMA foreign_keys = ON");
  }
}

export function isLegacyDatabase(sqlite: Database): boolean {
  const users = sqlite.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  return users !== null && !hasMigrationsTable(sqlite);
}

function hasUserTables(sqlite: Database): boolean {
  return (
    sqlite.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get() !==
    null
  );
}

/**
 * `VACUUM INTO` a consistent copy (includes WAL content).
 */
function backupBeforeMigrate(sqlite: Database, options: RunMigrationsOptions, label: string): string | null {
  const dbPath = sqlite.filename;
  if (isMemoryDbPath(dbPath) || !hasUserTables(sqlite)) return null;

  const dir = options.backupDir ?? join(dirname(dbPath), "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const prefix = `${basename(dbPath, extname(dbPath))}-${label}-`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `${prefix}${stamp}.db`);
  sqlite.query("VACUUM INTO ?").run(target);

  pruneBackups(dir, prefix, options.keepBackups ?? 5);
  return target;
}

function pruneBackups(dir: string, prefix: string, keep: number): void {
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".db"))
    .sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
    unlinkSync(join(dir, old));
  }
}

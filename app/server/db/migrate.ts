/**
 * runMigrations(): backup → PRAGMA foreign_keys=OFF → one transaction
 * { apply pending, PRAGMA foreign_key_check } → commit → foreign_keys=ON.
 *
 * FKs must be switched off *outside* the transaction (the pragma is a no-op
 * inside one), otherwise a drizzle-kit table recreation (`DROP TABLE x`) would
 * cascade-delete child rows. With FKs off nothing enforces integrity, so the
 * check runs before COMMIT: a violation rolls back the data *and* the history
 * rows, leaving the DB exactly as it was (plans/drizzle-orm-migration.md §5, §7).
 */
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { basename, dirname, extname, join } from "path";
import { applyPendingMigrations, hasMigrationsTable, loadMigrations, pendingMigrations, type Migration } from "./executor";
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

/** A pre-Drizzle DB (built by schema.sql) that has not been adopted yet. */
export class LegacyDatabaseError extends Error {
  constructor() {
    super(
      "Database has legacy tables but no __drizzle_migrations history; legacy adoption is not available yet. " +
        "Keep using initializeSchema() for this database.",
    );
    this.name = "LegacyDatabaseError";
  }
}

export interface RunMigrationsOptions {
  /** Defaults to server/db/migrations. Tests point this at fixture folders. */
  migrationsFolder?: string;
  /** Defaults to `<db dir>/backups`. */
  backupDir?: string;
  /** Pre-migrate backups to keep per DB file (oldest are pruned). Default 5. */
  keepBackups?: number;
}

export interface RunMigrationsResult {
  applied: Migration[];
  backupPath: string | null;
}

export function runMigrations(sqlite: Database, options: RunMigrationsOptions = {}): RunMigrationsResult {
  if (sqlite.inTransaction) {
    // PRAGMA foreign_keys can't change inside a transaction, so we must own it.
    throw new Error("runMigrations() must not be called inside a transaction");
  }
  if (isLegacyDatabase(sqlite)) throw new LegacyDatabaseError();

  const migrations = loadMigrations(options.migrationsFolder ?? MIGRATIONS_FOLDER);
  if (pendingMigrations(sqlite, migrations).length === 0) return { applied: [], backupPath: null };

  const backupPath = backupBeforeMigrate(sqlite, options);

  sqlite.run("PRAGMA foreign_keys = OFF");
  try {
    const applied = sqlite.transaction(() => {
      const applied = applyPendingMigrations(sqlite, migrations);
      const violations = sqlite.query<ForeignKeyViolation, []>("PRAGMA foreign_key_check").all();
      if (violations.length > 0) throw new MigrationFkError(violations); // → ROLLBACK
      return applied;
    }).immediate();
    return { applied, backupPath };
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
 * `VACUUM INTO` a consistent copy (includes WAL content). Skipped for in-memory
 * DBs and for empty DBs, which have nothing to lose.
 */
function backupBeforeMigrate(sqlite: Database, options: RunMigrationsOptions): string | null {
  const dbPath = sqlite.filename;
  if (isMemoryDbPath(dbPath) || !hasUserTables(sqlite)) return null;

  const dir = options.backupDir ?? join(dirname(dbPath), "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const prefix = `${basename(dbPath, extname(dbPath))}-pre-migrate-`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `${prefix}${stamp}.db`);
  sqlite.query("VACUUM INTO ?").run(target);

  pruneBackups(dir, prefix, options.keepBackups ?? 5);
  return target;
}

function pruneBackups(dir: string, prefix: string, keep: number): void {
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".db"))
    .sort(); // ISO timestamps sort chronologically
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
    unlinkSync(join(dir, old));
  }
}

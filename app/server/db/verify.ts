import type { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import {
  emptyTighteningPreview,
  previewTightening,
  TIGHTEN_MIGRATION_TAG,
  type TighteningPreview,
} from "./backfills";
import { openDatabase } from "./connection";
import { loadMigrations, pendingMigrations } from "./executor";
import { diffFingerprints, fingerprintSchema } from "./introspect";
import { baselineDiffs, LegacyAdoptionError, runCatchUp } from "./legacy";
import { isLegacyDatabase, MigrationFkError, runMigrations, type ForeignKeyViolation } from "./migrate";
import { MEMORY_DB_PATH, MIGRATIONS_FOLDER } from "./paths";

export interface VerifyOptions {
  migrationsFolder?: string;
  /** Keep the scratch copy (its path is in the report). Default false. */
  keepCopy?: boolean;
}

export interface VerifyReport {
  input: string;
  copy: string;
  legacy: boolean;
  /** Migration tags pending before the run (all of them for a legacy DB). */
  pending: string[];
  /** Legacy only: fingerprint vs the `0000` baseline after the frozen ALTER catch-up. */
  baselineDiffs: string[];
  /**
   * What `0003_tighten_not_null` will backfill / reject, measured before the run
   * (legacy: after the ALTER catch-up). Empty when 0003 isn't pending.
   */
  tightening: TighteningPreview;
  /** Orphans already present in the input. */
  existingFkViolations: ForeignKeyViolation[];
  ok: boolean;
  adopted: boolean;
  applied: string[];
  /** Failure message, if the transaction rolled back. */
  error: string | null;
  /** FK violations that made the transaction roll back. */
  fkViolations: ForeignKeyViolation[];
  /** After a successful run: fingerprint vs a fresh DB with every migration applied. */
  finalDiffs: string[];
  /** Wall-clock time of the migration transaction = how long first boot holds the write lock. */
  transactionMs: number;
}

export function verifyDatabase(input: string, options: VerifyOptions = {}): VerifyReport {
  if (!existsSync(input)) throw new Error(`Database not found: ${input}`);
  const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_FOLDER;
  const migrations = loadMigrations(migrationsFolder);

  const dir = mkdtempSync(join(tmpdir(), "burp-db-verify-"));
  const copy = join(dir, basename(input));
  copyFileSync(input, copy);
  // Committed pages may still sit in the WAL; SQLite replays it when the copy is opened.
  if (existsSync(`${input}-wal`)) copyFileSync(`${input}-wal`, `${copy}-wal`);

  const sqlite = openDatabase(copy);
  try {
    const legacy = isLegacyDatabase(sqlite);
    const pending = (legacy ? migrations : pendingMigrations(sqlite, migrations)).map((m) => m.tag);
    const tighten = pending.includes(TIGHTEN_MIGRATION_TAG);
    const preflight = legacy
      ? inspectAfterCatchUp(sqlite, migrations[0]!, tighten)
      : { baselineDiffs: [], tightening: tighten ? previewTightening(sqlite) : emptyTighteningPreview() };
    const report: VerifyReport = {
      input,
      copy,
      legacy,
      pending,
      ...preflight,
      existingFkViolations: sqlite.query<ForeignKeyViolation, []>("PRAGMA foreign_key_check").all(),
      ok: false,
      adopted: false,
      applied: [],
      error: null,
      fkViolations: [],
      finalDiffs: [],
      transactionMs: 0,
    };

    const started = performance.now();
    try {
      const result = runMigrations(sqlite, { migrationsFolder, backup: false });
      report.transactionMs = result.transactionMs ?? 0;
      report.ok = true;
      report.adopted = result.adopted;
      report.applied = result.applied.map((m) => m.tag);
      report.finalDiffs = diffAgainstFresh(sqlite, migrationsFolder);
    } catch (err) {
      report.transactionMs = performance.now() - started;
      report.error = err instanceof Error ? err.message : String(err);
      if (err instanceof MigrationFkError) report.fkViolations = err.violations;
      if (err instanceof LegacyAdoptionError && report.baselineDiffs.length === 0) report.baselineDiffs = err.diffs;
    }
    return report;
  } finally {
    sqlite.close();
    if (!options.keepCopy) rmSync(dir, { recursive: true, force: true });
  }
}

function inspectAfterCatchUp(
  sqlite: Database,
  baseline: Parameters<typeof baselineDiffs>[1],
  tighten: boolean,
): Pick<VerifyReport, "baselineDiffs" | "tightening"> {
  sqlite.run("BEGIN");
  try {
    runCatchUp(sqlite);
    return {
      baselineDiffs: baselineDiffs(sqlite, baseline),
      tightening: tighten ? previewTightening(sqlite) : emptyTighteningPreview(),
    };
  } catch (err) {
    const diffs = err instanceof LegacyAdoptionError ? err.diffs : [String(err)];
    return { baselineDiffs: diffs, tightening: emptyTighteningPreview() };
  } finally {
    sqlite.run("ROLLBACK");
  }
}

function diffAgainstFresh(sqlite: Database, migrationsFolder: string): string[] {
  const fresh = openDatabase(MEMORY_DB_PATH);
  try {
    runMigrations(fresh, { migrationsFolder });
    return diffFingerprints(fingerprintSchema(sqlite), fingerprintSchema(fresh));
  } finally {
    fresh.close();
  }
}

export function formatVerifyReport(r: VerifyReport): string {
  const lines: string[] = [];
  const list = (items: string[]) => (items.length === 0 ? ["  (none)"] : items.map((i) => `  - ${i}`));
  const fk = (v: ForeignKeyViolation[]) => list(v.map((x) => `${x.table} rowid ${x.rowid} → ${x.parent} (fk ${x.fkid})`));

  lines.push(`Input:   ${r.input} (not modified)`);
  lines.push(`Copy:    ${r.copy}`);
  lines.push(`Legacy:  ${r.legacy ? "yes — will be adopted" : "no"}`);
  lines.push(`Pending: ${r.pending.length === 0 ? "(none)" : r.pending.join(", ")}`);
  if (r.legacy) lines.push("Fingerprint diffs vs baseline (after ALTER catch-up):", ...list(r.baselineDiffs));
  lines.push(...formatTightening(r));
  lines.push("Existing FK violations:", ...fk(r.existingFkViolations));
  lines.push("");
  if (r.ok) {
    lines.push(`Result:  OK${r.adopted ? " — adopted" : ""}; applied ${r.applied.length === 0 ? "nothing" : r.applied.join(", ")}`);
    lines.push("Fingerprint diffs vs fresh DB (after migrating):", ...list(r.finalDiffs));
  } else {
    lines.push("Result:  FAILED — transaction rolled back", `  ${r.error}`);
    if (r.fkViolations.length > 0) lines.push("FK violations at commit:", ...fk(r.fkViolations));
  }
  lines.push(`Transaction wall-clock (write lock held at first boot): ${r.transactionMs.toFixed(1)} ms`);
  return lines.join("\n");
}

function formatTightening(r: VerifyReport): string[] {
  if (!r.pending.includes(TIGHTEN_MIGRATION_TAG)) return [`${TIGHTEN_MIGRATION_TAG}: already applied`];
  const list = (items: string[], empty: string) => (items.length === 0 ? [`  (${empty})`] : items.map((i) => `  - ${i}`));
  const { backfills, nullRoleUsers, nullPrimaryKeys } = r.tightening;
  const filled = backfills.filter((b) => b.rows > 0);
  return [
    `${TIGHTEN_MIGRATION_TAG} backfills (NULL cells filled):`,
    ...list(filled.map((b) => `${b.table}.${b.column} → ${b.value}: ${b.rows} row(s)`), "none"),
    "Users with NULL role (become 'user' — fix by hand first if one must stay blocked):",
    ...list(
      nullRoleUsers.map((u) => `id=${u.id ?? "NULL"} email=${u.email} created_at=${u.created_at ?? "NULL"}`),
      "none",
    ),
    "NULL primary keys (not backfilled — 0003 fails and rolls back until fixed by hand):",
    ...list(nullPrimaryKeys.map((p) => `${p.table}.${p.column} IS NULL at rowid ${p.rowid}`), "none"),
  ];
}

/** Healthy = migrates cleanly and ends up identical to a fresh DB, with no orphans. */
export function verifyPassed(r: VerifyReport): boolean {
  return r.ok && r.finalDiffs.length === 0 && r.existingFkViolations.length === 0;
}

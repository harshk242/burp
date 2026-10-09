/**
 * Schema fingerprint: a representation-agnostic but semantically complete view
 * of a SQLite schema (plans/drizzle-orm-migration.md §6 step 3).
 *
 * Two DBs with equal fingerprints accept and reject the same rows, whatever DDL
 * text built them (inline vs. named UNIQUEs, ALTER-appended columns, quoting).
 * Used by legacy adoption (legacy.ts) and `db:verify`.
 */
import type { Database } from "bun:sqlite";
import { balancedParens, isKeyword, normalizeExpression, tokenize } from "./sql-tokens";

export interface ColumnFingerprint {
  /** Declared type, upper-cased. */
  type: string;
  /** INTEGER rowid-alias PKs count as NOT NULL (they can never hold NULL). */
  notnull: boolean;
  /** Normalized DEFAULT expression, or null. */
  default: string | null;
}

export interface TableFingerprint {
  /** Keyed by column name (lower-case), so column order is irrelevant. */
  columns: Record<string, ColumnFingerprint>;
  /** PK columns in key order. */
  primaryKey: string[];
  autoincrement: boolean;
  /** `(from) -> parent(to) on delete X on update Y`, sorted. */
  foreignKeys: string[];
  /** Column sets with a full (non-partial) UNIQUE index of any origin, sorted. */
  uniques: string[];
  /** Normalized CHECK bodies, sorted (a multiset: duplicates are kept). */
  checks: string[];
  /** Every other index: name, ordered key columns, unique flag, partial WHERE. */
  indexes: string[];
}

export interface SchemaFingerprint {
  tables: Record<string, TableFingerprint>;
  /** Views and triggers (`type name`); the baseline has none. */
  others: string[];
}

/** Bookkeeping and FTS5 objects are managed by migrations 0001+, not part of the fingerprint. */
export function isFingerprintedTable(name: string): boolean {
  const n = name.toLowerCase();
  return (
    !n.startsWith("sqlite_") &&
    n !== "__drizzle_migrations" &&
    n !== "tool_search_fts" &&
    !n.startsWith("tool_search_fts_")
  );
}

interface MasterRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

export function fingerprintSchema(sqlite: Database): SchemaFingerprint {
  const master = sqlite.query<MasterRow, []>("SELECT type, name, tbl_name, sql FROM sqlite_master").all();
  const tables: Record<string, TableFingerprint> = {};
  for (const row of master) {
    if (row.type === "table" && isFingerprintedTable(row.name)) {
      tables[row.name.toLowerCase()] = fingerprintTable(sqlite, row.name, row.sql ?? "", master);
    }
  }
  const others = master
    .filter((r) => r.type === "view" || r.type === "trigger")
    .map((r) => `${r.type} ${r.name.toLowerCase()}`)
    .sort();
  return { tables, others };
}

function fingerprintTable(sqlite: Database, table: string, sql: string, master: MasterRow[]): TableFingerprint {
  const info = sqlite
    .query<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }, []>(
      `PRAGMA table_info(${quoteIdent(table)})`,
    )
    .all();
  const pkCols = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
  const rowidAlias = pkCols.length === 1 && pkCols[0]!.type.toUpperCase() === "INTEGER" ? pkCols[0]!.name : null;

  const columns: Record<string, ColumnFingerprint> = {};
  for (const c of info) {
    columns[c.name.toLowerCase()] = {
      type: c.type.toUpperCase().replace(/\s+/g, " ").trim(),
      notnull: c.notnull === 1 || c.name === rowidAlias,
      default: c.dflt_value === null ? null : normalizeExpression(c.dflt_value),
    };
  }

  const tokens = tokenize(sql);
  const checks: string[] = [];
  tokens.forEach((t, i) => {
    if (isKeyword(t, "CHECK") && tokens[i + 1]?.text === "(") checks.push(normalizeExpression(balancedParens(tokens, i + 1)[0]));
  });

  return {
    columns,
    primaryKey: pkCols.map((c) => c.name.toLowerCase()),
    autoincrement: tokens.some((t) => isKeyword(t, "AUTOINCREMENT")),
    foreignKeys: foreignKeys(sqlite, table),
    ...indexes(sqlite, table, master),
    checks: checks.sort(),
  };
}

function foreignKeys(sqlite: Database, table: string): string[] {
  const rows = sqlite
    .query<{ id: number; seq: number; table: string; from: string; to: string | null; on_update: string; on_delete: string }, []>(
      `PRAGMA foreign_key_list(${quoteIdent(table)})`,
    )
    .all();
  const byId = new Map<number, typeof rows>();
  for (const r of rows) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  return [...byId.values()]
    .map((group) => {
      group.sort((a, b) => a.seq - b.seq);
      const parent = group[0]!.table;
      // `REFERENCES users` without columns targets the parent's PK.
      const parentPk = () =>
        sqlite
          .query<{ name: string; pk: number }, []>(`PRAGMA table_info(${quoteIdent(parent)})`)
          .all()
          .filter((c) => c.pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .map((c) => c.name);
      const to = group.every((r) => r.to !== null) ? group.map((r) => r.to!) : parentPk();
      const from = group.map((r) => r.from.toLowerCase()).join(",");
      const g = group[0]!;
      return `(${from}) -> ${parent.toLowerCase()}(${to.map((c) => c.toLowerCase()).join(",")}) on delete ${g.on_delete.toLowerCase()} on update ${g.on_update.toLowerCase()}`;
    })
    .sort();
}

function indexes(sqlite: Database, table: string, master: MasterRow[]): Pick<TableFingerprint, "uniques" | "indexes"> {
  const list = sqlite
    .query<{ name: string; unique: number; origin: string; partial: number }, []>(`PRAGMA index_list(${quoteIdent(table)})`)
    .all();
  const uniques: string[] = [];
  const ordinary: string[] = [];
  for (const idx of list) {
    if (idx.origin === "pk") continue;
    const keys = sqlite
      .query<{ name: string | null; desc: number; coll: string; key: number }, []>(
        `PRAGMA index_xinfo(${quoteIdent(idx.name)})`,
      )
      .all()
      .filter((k) => k.key === 1);
    if (idx.unique === 1 && idx.partial === 0) {
      // A unique constraint is a column set: name, origin and key order don't change what it rejects.
      uniques.push(keys.map((k) => (k.name ?? "<expr>").toLowerCase()).sort().join(","));
      continue;
    }
    const cols = keys.map(
      (k) =>
        (k.name ?? "<expr>").toLowerCase() +
        (k.desc ? " desc" : "") +
        (k.coll.toUpperCase() === "BINARY" ? "" : ` collate ${k.coll.toLowerCase()}`),
    );
    const sql = master.find((r) => r.type === "index" && r.name === idx.name)?.sql ?? "";
    const where = partialWhere(sql);
    ordinary.push(
      `${idx.name.toLowerCase()}: ${idx.unique ? "unique " : ""}(${cols.join(", ")})${where ? ` where ${where}` : ""}`,
    );
  }
  return { uniques: uniques.sort(), indexes: ordinary.sort() };
}

/** Normalized WHERE clause of a partial `CREATE INDEX`, or null. */
function partialWhere(sql: string): string | null {
  const tokens = tokenize(sql);
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === "punct" && t.text === "(") depth++;
    else if (t.kind === "punct" && t.text === ")") depth--;
    else if (depth === 0 && isKeyword(t, "WHERE")) return normalizeExpression(tokens.slice(i + 1));
  }
  return null;
}

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Human-readable differences, `actual` (DB under test) vs `expected` (baseline).
 * Empty array = semantically identical.
 */
export function diffFingerprints(actual: SchemaFingerprint, expected: SchemaFingerprint): string[] {
  const diffs: string[] = [];
  const tableNames = [...new Set([...Object.keys(actual.tables), ...Object.keys(expected.tables)])].sort();
  for (const name of tableNames) {
    const a = actual.tables[name];
    const e = expected.tables[name];
    if (!a) diffs.push(`missing table ${name}`);
    else if (!e) diffs.push(`unexpected table ${name}`);
    else diffs.push(...diffTable(name, a, e));
  }
  diffs.push(...diffMultiset("", "object", actual.others, expected.others));
  return diffs;
}

function diffTable(table: string, a: TableFingerprint, e: TableFingerprint): string[] {
  const diffs: string[] = [];
  const cols = [...new Set([...Object.keys(a.columns), ...Object.keys(e.columns)])].sort();
  for (const col of cols) {
    const ac = a.columns[col];
    const ec = e.columns[col];
    if (!ac) diffs.push(`${table}: missing column ${col}`);
    else if (!ec) diffs.push(`${table}: unexpected column ${col}`);
    else {
      if (ac.type !== ec.type) diffs.push(`${table}.${col}: type ${ac.type}, expected ${ec.type}`);
      if (ac.notnull !== ec.notnull) {
        diffs.push(`${table}.${col}: ${ac.notnull ? "NOT NULL" : "nullable"}, expected ${ec.notnull ? "NOT NULL" : "nullable"}`);
      }
      if (ac.default !== ec.default) diffs.push(`${table}.${col}: default ${ac.default}, expected ${ec.default}`);
    }
  }
  if (a.primaryKey.join(",") !== e.primaryKey.join(",")) {
    diffs.push(`${table}: primary key (${a.primaryKey.join(",")}), expected (${e.primaryKey.join(",")})`);
  }
  if (a.autoincrement !== e.autoincrement) {
    diffs.push(`${table}: ${a.autoincrement ? "has" : "missing"} AUTOINCREMENT`);
  }
  diffs.push(...diffMultiset(table, "foreign key", a.foreignKeys, e.foreignKeys));
  diffs.push(...diffMultiset(table, "unique", a.uniques, e.uniques));
  diffs.push(...diffMultiset(table, "check", a.checks, e.checks));
  diffs.push(...diffMultiset(table, "index", a.indexes, e.indexes));
  return diffs;
}

function diffMultiset(table: string, what: string, actual: string[], expected: string[]): string[] {
  const prefix = table ? `${table}: ` : "";
  const remaining = [...expected];
  const unexpected: string[] = [];
  for (const item of actual) {
    const i = remaining.indexOf(item);
    if (i === -1) unexpected.push(item);
    else remaining.splice(i, 1);
  }
  return [
    ...remaining.map((item) => `${prefix}missing ${what} ${item}`),
    ...unexpected.map((item) => `${prefix}unexpected ${what} ${item}`),
  ];
}

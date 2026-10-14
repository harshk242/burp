import type { Database } from "bun:sqlite";
import { quoteIdent } from "./introspect";

export const TIGHTEN_MIGRATION_TAG = "0003_tighten_not_null";

export interface ColumnRef {
  table: string;
  column: string;
}

export interface Backfill extends ColumnRef {
  /** SQL expression written into NULL cells. */
  value: string;
}

export const TIGHTEN_BACKFILLS: readonly Backfill[] = [
  { table: "users", column: "role", value: "'user'" },
  { table: "users", column: "total_queries", value: "0" },
  { table: "users", column: "created_at", value: "unixepoch()" },
  { table: "access_requests", column: "status", value: "'pending'" },
  { table: "access_requests", column: "submitted_at", value: "unixepoch()" },
  { table: "chat_sessions", column: "created_at", value: "unixepoch()" },
  { table: "messages", column: "created_at", value: "unixepoch()" },
  { table: "messages", column: "input_tokens", value: "0" },
  { table: "messages", column: "output_tokens", value: "0" },
  { table: "messages", column: "cost_microusd", value: "0" },
  { table: "usage_events", column: "created_at", value: "unixepoch()" },
  { table: "daily_usage", column: "query_count", value: "0" },
  { table: "daily_usage", column: "created_at", value: "unixepoch()" },
  { table: "daily_usage", column: "input_tokens", value: "0" },
  { table: "daily_usage", column: "output_tokens", value: "0" },
  { table: "rate_limits", column: "updated_at", value: "unixepoch()" },
];

/** Text PKs that become NOT NULL. Deliberately not backfilled: a NULL makes 0003 fail and roll back. */
export const TIGHTENED_PRIMARY_KEYS: readonly ColumnRef[] = [
  { table: "users", column: "id" },
  { table: "access_requests", column: "id" },
  { table: "chat_sessions", column: "id" },
  { table: "messages", column: "id" },
  { table: "usage_events", column: "id" },
  { table: "rate_limits", column: "role" },
];

export function backfillSql(b: Backfill): string {
  return `UPDATE \`${b.table}\` SET \`${b.column}\` = ${b.value} WHERE \`${b.column}\` IS NULL;`;
}

export interface BackfillCount extends Backfill {
  rows: number;
}

export interface NullRoleUser {
  id: string | null;
  email: string;
  created_at: number | null;
}

export interface NullPrimaryKeyRow extends ColumnRef {
  rowid: number;
}

export interface TighteningPreview {
  /** Every backfill with the number of NULL cells it will fill. */
  backfills: BackfillCount[];
  /** Users whose NULL role becomes `'user'` — review in case one was meant to stay blocked. */
  nullRoleUsers: NullRoleUser[];
  /** Rows that make 0003 fail (must be fixed by hand before deploy). */
  nullPrimaryKeys: NullPrimaryKeyRow[];
}

export function emptyTighteningPreview(): TighteningPreview {
  return { backfills: [], nullRoleUsers: [], nullPrimaryKeys: [] };
}

/**
 * What 0003 would do to `sqlite` as it is now. Read-only. Tables/columns that
 * don't exist (yet) count as zero, so this is safe on any pre-0003 DB.
 */
export function previewTightening(sqlite: Database): TighteningPreview {
  const has = (ref: ColumnRef) =>
    sqlite
      .query<{ name: string }, []>(`PRAGMA table_info(${quoteIdent(ref.table)})`)
      .all()
      .some((c) => c.name === ref.column);
  const nullsIn = (ref: ColumnRef) => `FROM ${quoteIdent(ref.table)} WHERE ${quoteIdent(ref.column)} IS NULL`;

  const backfills = TIGHTEN_BACKFILLS.map((b) => ({
    ...b,
    rows: has(b) ? sqlite.query<{ n: number }, []>(`SELECT count(*) AS n ${nullsIn(b)}`).get()!.n : 0,
  }));
  const nullRoleUsers = has({ table: "users", column: "role" })
    ? sqlite
        .query<NullRoleUser, []>("SELECT id, email, created_at FROM users WHERE role IS NULL ORDER BY rowid")
        .all()
    : [];
  const nullPrimaryKeys = TIGHTENED_PRIMARY_KEYS.filter(has).flatMap((ref) =>
    sqlite
      .query<{ rowid: number }, []>(`SELECT rowid ${nullsIn(ref)} ORDER BY rowid`)
      .all()
      .map(({ rowid }) => ({ ...ref, rowid })),
  );
  return { backfills, nullRoleUsers, nullPrimaryKeys };
}

import type { Database } from "bun:sqlite";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MIGRATIONS_FOLDER } from "../db/paths";

export interface ExtraMigration {
  tag: string;
  statements: string[];
}

interface Journal {
  entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
}

export function makeTempDir(prefix = "burp-migrations-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function migrationsFolderWith(extra: ExtraMigration[]): string {
  const folder = join(makeTempDir(), "migrations");
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });

  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as Journal;
  let when = journal.entries.at(-1)!.when;
  for (const m of extra) {
    when += 1000;
    journal.entries.push({ idx: journal.entries.length, version: "6", when, tag: m.tag, breakpoints: true });
    writeFileSync(join(folder, `${m.tag}.sql`), m.statements.join("\n--> statement-breakpoint\n"));
  }
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return folder;
}

export function migrationsFolderUpTo(lastTag: string): string {
  const folder = join(makeTempDir(), "migrations");
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });

  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as Journal;
  const last = journal.entries.findIndex((e) => e.tag === lastTag);
  if (last < 0) throw new Error(`migration ${lastTag} not found`);
  journal.entries = journal.entries.slice(0, last + 1);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return folder;
}

export function schemaSnapshot(sqlite: Database, skip: string[] = []): string[] {
  return sqlite
    .query<{ type: string; name: string; tbl_name: string; sql: string | null }, []>(
      "SELECT type, name, tbl_name, sql FROM sqlite_master",
    )
    .all()
    .filter((r) => !skip.includes(r.tbl_name))
    .map((r) => `${r.type}|${r.name}|${r.tbl_name}|${(r.sql ?? "").replace(/\s+/g, " ")}`)
    .sort();
}

export function historyRows(sqlite: Database): Array<{ hash: string; created_at: number }> {
  return sqlite
    .query<{ hash: string; created_at: number }, []>(
      'SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at',
    )
    .all();
}

export function foreignKeysEnabled(sqlite: Database): boolean {
  return sqlite.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()!.foreign_keys === 1;
}

export function seedRelatedRows(sqlite: Database): void {
  sqlite.run("INSERT INTO users (id, clerk_id, email, role) VALUES ('u1', 'clerk_1', 'a@example.com', 'user')");
  sqlite.run(
    "INSERT INTO access_requests (id, email, name, reviewed_by) VALUES ('ar1', 'b@example.com', 'B', 'u1')",
  );
  sqlite.run("INSERT INTO chat_sessions (id, user_id, title) VALUES ('c1', 'u1', 'hello')");
  sqlite.run("INSERT INTO messages (id, chat_id, role, content) VALUES ('m1', 'c1', 'user', 'hi')");
  sqlite.run("INSERT INTO daily_usage (user_id, date) VALUES ('u1', '2026-01-01')");
  sqlite.run(
    `INSERT INTO usage_events (id, user_id, date, month, provider, model,
       input_cost_per_mtok_microusd, output_cost_per_mtok_microusd, session_id, message_id)
     VALUES ('e1', 'u1', '2026-01-01', '2026-01', 'anthropic', 'm', 1, 1, 'c1', 'm1')`,
  );
}

export function rowCounts(sqlite: Database): Record<string, number> {
  const tables = ["users", "access_requests", "chat_sessions", "messages", "daily_usage", "usage_events"];
  return Object.fromEntries(
    tables.map((t) => [t, sqlite.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${t}`).get()!.n]),
  );
}

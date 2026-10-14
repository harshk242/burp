/**
 * `VACUUM INTO` reads one consistent snapshot including committed pages still in
 * the -wal file, unlike copying `app.db` alone (plans/drizzle-orm-migration.md §6).
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

export function snapshotDatabase(source: string, out: string): void {
  if (!existsSync(source)) throw new Error(`Source database not found: ${source}`);
  if (existsSync(out)) throw new Error(`Refusing to overwrite existing file: ${out}`);
  mkdirSync(dirname(out), { recursive: true });

  const sqlite = new Database(source, { readonly: true });
  try {
    sqlite.query("VACUUM INTO ?").run(out);
  } finally {
    sqlite.close();
  }
}

if (import.meta.main) {
  const [outArg, sourceArg] = process.argv.slice(2);
  const sourceRaw = sourceArg ?? process.env.DATABASE_URL;
  if (!outArg || !sourceRaw) {
    console.error("Usage: bun run db:snapshot <out> [source]   (source defaults to $DATABASE_URL)");
    process.exit(2);
  }
  const source = resolve(sourceRaw);
  const out = resolve(outArg);
  try {
    snapshotDatabase(source, out);
    console.log(`Snapshot of ${source} written to ${out}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

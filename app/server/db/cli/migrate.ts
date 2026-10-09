/**
 * Apply pending Drizzle migrations to the configured database.
 *
 *   bun run db:migrate              # DATABASE_URL / config.yaml database_url
 *   bun run db:migrate ./some.db    # explicit path (relative to the repo root, or absolute)
 */
import { appConfig } from "../../config";
import { openDatabase } from "../connection";
import { runMigrations } from "../migrate";
import { resolveDbPath } from "../paths";

const dbPath = resolveDbPath(process.argv[2] ?? appConfig.server.database_url);
const sqlite = openDatabase(dbPath);

try {
  const { applied, adopted, backupPath } = runMigrations(sqlite);
  if (backupPath) console.log(`Backup written to ${backupPath}`);
  if (adopted) console.log(`Adopted legacy database ${dbPath} (rebuilt to and recorded the baseline)`);
  if (applied.length === 0) {
    console.log(`No pending migrations for ${dbPath}`);
  } else {
    console.log(`Applied ${applied.length} migration(s) to ${dbPath}:`);
    for (const m of applied) console.log(`  ${m.tag}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  sqlite.close();
}

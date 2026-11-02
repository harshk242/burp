import type { Database } from "bun:sqlite";
import { createDrizzle, openDatabase } from "../app/server/db/connection";
import { hasMigrationsTable, loadMigrations, pendingMigrations } from "../app/server/db/executor";
import { MIGRATIONS_FOLDER } from "../app/server/db/paths";
import { createAccessRequestQueries } from "../app/server/db/queries/access-requests";

function assertMigrated(sqlite: Database): void {
  if (!hasMigrationsTable(sqlite)) throw new Error("Database has no migration history; start the server once to migrate it");
  const pending = pendingMigrations(sqlite, loadMigrations(MIGRATIONS_FOLDER));
  if (pending.length > 0) throw new Error(`Database is missing migrations: ${pending.map((m) => m.tag).join(", ")}`);
}

export function approveAccess(email: string, path: string): boolean {
  const sqlite = openDatabase(path, { existing: true });
  try {
    assertMigrated(sqlite);
    const queries = createAccessRequestQueries(createDrizzle(sqlite));
    const request = queries.findByEmail(email);
    if (!request) {
      console.log(`❌ No access request found for ${email}`);
      return false;
    }
    console.log("Found request:", request);
    queries.approve(request.id, null);
    console.log("✅ Approved:", queries.findById(request.id));
    return true;
  } finally {
    sqlite.close();
  }
}

if (import.meta.main) {
  const email = process.argv[2];
  if (!email) {
    console.error("❌ Usage: bun scripts/approve-access.ts <email>");
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = approveAccess(email, process.env.DATABASE_URL || "/app/data/app.db") ? 0 : 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

import type { Database } from "bun:sqlite";
import { createDrizzle, openDatabase, type DrizzleDb } from "../db/connection";
import { runMigrations, type RunMigrationsOptions } from "../db/migrate";
import { MEMORY_DB_PATH } from "../db/paths";

export interface TestDb {
  sqlite: Database;
  db: DrizzleDb;
}

export function createTestDb(options: RunMigrationsOptions = {}): TestDb {
  const sqlite = openDatabase(MEMORY_DB_PATH);
  runMigrations(sqlite, options);
  return { sqlite, db: createDrizzle(sqlite) };
}

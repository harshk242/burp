import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { isMemoryDbPath } from "./paths";
import * as schema from "./schema";

export type DrizzleDb = BunSQLiteDatabase<typeof schema>;

export function openDatabase(path: string): Database {
  const memory = isMemoryDbPath(path);
  if (!memory) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(path, { create: true });
  // Foreign key enforcement is per-connection and off by default in SQLite.
  sqlite.run("PRAGMA foreign_keys = ON");
  if (!memory) sqlite.run("PRAGMA journal_mode = WAL");
  return sqlite;
}

export function createDrizzle(sqlite: Database): DrizzleDb {
  return drizzle({ client: sqlite, schema });
}

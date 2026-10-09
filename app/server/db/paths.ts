/**
 * Database path resolution.
 *
 * Kept free of `bun:sqlite` and Bun-only globals so drizzle-kit (which loads
 * drizzle.config.ts under Node) can import it.
 */
import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";
import { appConfig } from "../config";

export const MEMORY_DB_PATH = ":memory:";

/** Repo root (app/server/db → ../../..). Relative DATABASE_URLs resolve against it. */
export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Folder holding drizzle-kit output (SQL files + meta/_journal.json). */
export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function isMemoryDbPath(path: string): boolean {
  return path === MEMORY_DB_PATH || path === "";
}

/**
 * Resolve a configured database URL to a filesystem path.
 * `:memory:` passes through untouched; relative paths resolve against the repo root.
 */
export function resolveDbPath(url: string = appConfig.server.database_url): string {
  if (isMemoryDbPath(url)) return MEMORY_DB_PATH;
  return isAbsolute(url) ? url : join(PROJECT_ROOT, url);
}

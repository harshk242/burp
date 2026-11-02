import { isAbsolute, join } from "path";
import { APP_DIR } from "../app-dir";

export const MEMORY_DB_PATH = ":memory:";

export const PROJECT_ROOT = join(APP_DIR, "..");

export const MIGRATIONS_FOLDER = join(APP_DIR, "server", "db", "migrations");

export function isMemoryDbPath(path: string): boolean {
  return path === MEMORY_DB_PATH || path === "";
}

export function resolveDbPath(url: string): string {
  if (isMemoryDbPath(url)) return MEMORY_DB_PATH;
  return isAbsolute(url) ? url : join(PROJECT_ROOT, url);
}

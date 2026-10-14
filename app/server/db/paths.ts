import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";

export const MEMORY_DB_PATH = ":memory:";

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function isMemoryDbPath(path: string): boolean {
  return path === MEMORY_DB_PATH || path === "";
}

export function resolveDbPath(url: string): string {
  if (isMemoryDbPath(url)) return MEMORY_DB_PATH;
  return isAbsolute(url) ? url : join(PROJECT_ROOT, url);
}

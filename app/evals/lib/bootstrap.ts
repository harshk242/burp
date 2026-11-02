import type { Database } from "bun:sqlite";
import type { DrizzleDb } from "../../server/db/client";
import { resolveDbPath } from "../../server/db/paths";
import type { LLMConfig } from "../../server/llm/config";

export interface RunDependencies {
  sqlite: Database;
  db: DrizzleDb;
  config: LLMConfig;
  dbPath: string;
}

export class RunBootstrapError extends Error {}

export async function initializeRunDependencies(dbPath: string): Promise<RunDependencies> {
  const path = resolveDbPath(dbPath);
  process.env.DATABASE_URL = path;
  const { DB_PATH, db, sqlite } = await import("../../server/db/client");
  if (DB_PATH !== path) {
    throw new RunBootstrapError(`server database was opened at ${DB_PATH} before the run bootstrap; expected ${path}`);
  }
  const { loadLLMConfig } = await import("../../server/llm/config");
  return { sqlite, db, config: loadLLMConfig(), dbPath: path };
}

/**
 * The app's single SQLite connection (opened on import) and its Drizzle wrapper.
 */
import { createDrizzle, openDatabase } from "./connection";
import { resolveDbPath } from "./paths";

export type { DrizzleDb } from "./connection";

export const DB_PATH = resolveDbPath();
export const sqlite = openDatabase(DB_PATH);
export const db = createDrizzle(sqlite);

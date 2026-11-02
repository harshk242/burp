import { expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import * as executor from "../db/executor";

it("exposes only a transaction-required apply-and-record operation", () => {
  expect("applyMigration" in executor).toBe(false);
  const sqlite = new Database(":memory:");
  const migration = { sql: ["CREATE TABLE first_step (id INTEGER)", "INSERT INTO absent VALUES (1)"], hash: "test", folderMillis: 1, bps: true };
  try {
    expect(() => executor.applyPendingMigrations(sqlite, [migration])).toThrow(/transaction/);
    expect(() => sqlite.transaction(() => executor.applyPendingMigrations(sqlite, [migration]))()).toThrow();
    expect(sqlite.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  } finally { sqlite.close(); }
});

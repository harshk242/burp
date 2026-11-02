import { Database } from "bun:sqlite";
import { expect, it } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../server/db/connection";
import { runMigrations } from "../../server/db/migrate";
import { approveAccess } from "../../../scripts/approve-access";

it("refuses to create a missing approval database or its directory", () => {
  const dir = join(tmpdir(), `approval-missing-${crypto.randomUUID()}`);
  expect(() => approveAccess("user@localhost", join(dir, "missing.db"))).toThrow("Existing database required");
  expect(existsSync(dir)).toBe(false);
  expect(() => openDatabase(":memory:", { existing: true })).toThrow("Existing database required");
});

it("rejects unmigrated databases without enabling WAL or modifying rows", () => {
  const path = join(mkdtempSync(join(tmpdir(), "approval-invalid-")), "app.db");
  const db = new Database(path, { create: true });
  db.run("CREATE TABLE access_requests (id TEXT PRIMARY KEY, email TEXT, status TEXT)");
  db.run("INSERT INTO access_requests VALUES ('id', 'user@localhost', 'pending')");
  db.close();
  expect(() => approveAccess("user@localhost", path)).toThrow("no migration history");
  const check = openDatabase(path, { existing: true });
  try {
    expect(check.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
    expect(check.query("SELECT status FROM access_requests").get()).toEqual({ status: "pending" });
    expect(existsSync(`${path}-wal`)).toBe(false);
  } finally { check.close(); }
});

it("approves a request in a valid existing database", () => {
  const path = join(mkdtempSync(join(tmpdir(), "approval-valid-")), "app.db");
  const db = new Database(path, { create: true });
  runMigrations(db);
  db.run("INSERT INTO access_requests (id, email, name) VALUES ('id', 'user@localhost', 'User')");
  db.close();
  expect(approveAccess("user@localhost", path)).toBe(true);
  expect(approveAccess("missing@localhost", path)).toBe(false);
  const check = openDatabase(path, { existing: true });
  try { expect(check.query("SELECT status FROM access_requests").get()).toEqual({ status: "approved" }); }
  finally { check.close(); }
});

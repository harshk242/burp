import { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { buildLegacyDb, CURRENT_LEGACY_SQL, dumpRows } from "../__test-utils__/legacy";
import { makeTempDir } from "../__test-utils__/migrations";
import { snapshotDatabase } from "../db/cli/snapshot";
import { openDatabase } from "../db/connection";
import { isLegacyDatabase } from "../db/migrate";
import { formatVerifyReport, verifyDatabase, verifyPassed } from "../db/verify";

const APP_DIR = join(import.meta.dir, "..", "..");
const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = makeTempDir("burp-verify-");
  tempDirs.push(dir);
  return dir;
};

const hash = (path: string) => (existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null);
const fileHashes = (path: string) => ({ db: hash(path), wal: hash(`${path}-wal`), shm: hash(`${path}-shm`) });

/** A closed legacy file DB (old-prod fixture unless `schemaSql` is given). */
function legacyFile(schemaSql?: string, mutate?: (db: Database) => void): string {
  const path = join(tempDir(), "prod-copy.db");
  const sqlite = openDatabase(path);
  buildLegacyDb(sqlite, schemaSql ? "current" : "old-prod", { schemaSql });
  mutate?.(sqlite);
  sqlite.close();
  return path;
}

describe("db:snapshot", () => {
  it("copies a WAL-mode DB including uncheckpointed writes, while the writer is still open", () => {
    const dir = tempDir();
    const source = join(dir, "app.db");
    const writer = openDatabase(source);
    writer.run("PRAGMA wal_autocheckpoint = 0");
    buildLegacyDb(writer, "current");
    writer.run("INSERT INTO users (id, clerk_id, email) VALUES ('late', 'clerk_late', 'late@example.com')");

    // The rows really are only in the WAL: the main file alone doesn't have them.
    expect(statSync(`${source}-wal`).size).toBeGreaterThan(0);
    const mainOnlyPath = join(dir, "main-only.db");
    copyFileSync(source, mainOnlyPath);
    const mainOnly = new Database(mainOnlyPath);
    expect(mainOnly.query("SELECT count(*) AS n FROM sqlite_master").get()).toEqual({ n: 0 });
    mainOnly.close();

    const before = fileHashes(source);
    const out = join(dir, "snap", "copy.db");
    snapshotDatabase(source, out);
    expect(fileHashes(source).db).toBe(before.db);

    const copy = new Database(out, { readonly: true });
    expect(copy.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(dumpRows(copy)).toEqual(dumpRows(writer));
    expect(isLegacyDatabase(copy)).toBe(true);
    copy.close();
    writer.close();

    expect(() => snapshotDatabase(source, out)).toThrow(/Refusing to overwrite/);
  });

  it("is standalone: imports nothing from the app (no config, client or migrations)", () => {
    const src = readFileSync(join(APP_DIR, "server", "db", "cli", "snapshot.ts"), "utf-8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["bun:sqlite", "fs", "path"]);
  });
});

describe("db:verify", () => {
  it("adopts + migrates a legacy copy and leaves the input untouched", () => {
    const input = legacyFile();
    const before = fileHashes(input);
    const report = verifyDatabase(input);

    expect(fileHashes(input)).toEqual(before);
    expect(report).toMatchObject({
      legacy: true,
      ok: true,
      adopted: true,
      applied: ["0001_tool_search_fts", "0002_seed_and_data_fixes", "0003_tighten_not_null", "0004_usage_cache_columns", "0005_usage_status_estimated", "0006_artifacts", "0007_chat_turns", "0008_model_transcript", "0009_chat_turns_last_prompt_tokens", "0010_chat_turns_trace_id"],
      baselineDiffs: [],
      existingFkViolations: [],
      fkViolations: [],
      finalDiffs: [],
      error: null,
    });
    expect(report.pending).toHaveLength(11);
    expect(report.transactionMs).toBeGreaterThan(0);
    expect(existsSync(report.copy)).toBe(false); // scratch copy cleaned up
    expect(verifyPassed(report)).toBe(true);

    const text = formatVerifyReport(report);
    expect(text).toContain("Result:  OK — adopted");
    expect(text).toMatch(/Transaction wall-clock .*: \d+\.\d ms/);
  });

  it("reports fingerprint diffs without touching the input", () => {
    const input = legacyFile(CURRENT_LEGACY_SQL.replace("CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);", ""));
    const before = fileHashes(input);
    const report = verifyDatabase(input);

    expect(fileHashes(input)).toEqual(before);
    expect(report.ok).toBe(false);
    expect(report.baselineDiffs).toEqual(["messages: missing index idx_messages_chat_id: (chat_id)"]);
    expect(report.error).toContain("adoption failed at fingerprint");
    expect(verifyPassed(report)).toBe(false);
    expect(formatVerifyReport(report)).toContain("  - messages: missing index idx_messages_chat_id: (chat_id)");
  });

  it("reports FK violations", () => {
    const input = legacyFile(undefined, (db) => {
      db.run("PRAGMA foreign_keys = OFF");
      db.run("INSERT INTO messages (id, chat_id, role) VALUES ('m-orphan', 'no-such-chat', 'user')");
    });
    const report = verifyDatabase(input);
    expect(report.ok).toBe(false);
    expect(report.existingFkViolations).toEqual([expect.objectContaining({ table: "messages", parent: "chat_sessions" })]);
    expect(report.fkViolations).toEqual(report.existingFkViolations);
    expect(formatVerifyReport(report)).toContain("FK violations at commit:");
  });

  it("copies uncheckpointed WAL content and still never modifies the live files", () => {
    const dir = tempDir();
    const source = join(dir, "app.db");
    const writer = openDatabase(source);
    writer.run("PRAGMA wal_autocheckpoint = 0");
    buildLegacyDb(writer, "current");
    const before = fileHashes(source);

    const report = verifyDatabase(source);
    expect(report).toMatchObject({ legacy: true, ok: true, adopted: true, finalDiffs: [] });
    expect(fileHashes(source)).toEqual(before);
    expect(isLegacyDatabase(writer)).toBe(true);
    writer.close();
  });
});

describe("CLI", () => {
  const run = (script: string, args: string[]) =>
    Bun.spawnSync(["bun", "run", join("server", "db", "cli", script), ...args], { cwd: APP_DIR, env: process.env });

  it("db:snapshot then db:verify end to end", () => {
    const source = legacyFile();
    const out = join(tempDir(), "snap.db");
    const snap = run("snapshot.ts", [out, source]);
    expect(snap.exitCode).toBe(0);
    expect(snap.stdout.toString()).toContain(`written to ${out}`);

    const before = fileHashes(out);
    const verify = run("verify.ts", [out]);
    const stdout = verify.stdout.toString();
    expect(verify.exitCode).toBe(0);
    expect(stdout).toContain("Legacy:  yes — will be adopted");
    expect(stdout).toContain("Result:  OK — adopted; applied 0001_tool_search_fts, 0002_seed_and_data_fixes, 0003_tighten_not_null");
    expect(stdout).toContain("Transaction wall-clock");
    expect(fileHashes(out)).toEqual(before);
  });

  it("db:verify exits 1 on a DB that would not adopt", () => {
    const input = legacyFile(CURRENT_LEGACY_SQL.replace("ON DELETE SET NULL\n);", "ON DELETE CASCADE\n);"));
    const verify = run("verify.ts", [input]);
    expect(verify.exitCode).toBe(1);
    expect(verify.stdout.toString()).toContain("unexpected foreign key (reviewed_by) -> users(id) on delete cascade");
  });
});

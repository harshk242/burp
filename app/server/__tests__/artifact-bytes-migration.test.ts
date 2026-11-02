import { expect, it } from "bun:test";
import { createTestDb } from "../__test-utils__/db";
import { migrationsFolderUpTo, seedRelatedRows } from "../__test-utils__/migrations";
import { runMigrations } from "../db/migrate";

it("0016 backfills UTF-8 payload bytes from existing gzip rows without changing their JSON data", () => {
  const { sqlite } = createTestDb({ migrationsFolder: migrationsFolderUpTo("0015_feedback_sync_outbox") });
  try {
    seedRelatedRows(sqlite);
    const values = [{ p: "ascii" }, { p: "🧬漢é".repeat(10000) }, { p: "" }];
    const insert = sqlite.prepare("INSERT INTO artifacts (id, session_id, tool_name, tool_input_json, data, raw_size_chars, stored_size_chars, created_at, expires_at) VALUES (?, 'c1', 'demo__tool', '{}', ?, ?, ?, 1, 9999999999)");
    values.forEach((value, i) => {
      const json = JSON.stringify(value);
      insert.run(String(i), Buffer.from(Bun.gzipSync(json)), json.length, json.length);
    });
    const migration = runMigrations(sqlite);
    expect(migration.applied.map((m) => m.tag)).toEqual(["0016_artifact_utf8_bytes", "0017_turn_usage_identity", "0018_drop_redundant_user_indexes"]);
    const rows = sqlite.query<{ artifact_type: string; stored_size_bytes: number; data: Buffer }, []>("SELECT artifact_type, stored_size_bytes, data FROM artifacts ORDER BY id").all();
    rows.forEach((row, i) => {
      const json = JSON.stringify(values[i]);
      expect(row.artifact_type).toBe("json");
      expect(row.stored_size_bytes).toBe(Buffer.byteLength(json, "utf8"));
      expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(row.data)))).toBe(json);
    });
  } finally {
    sqlite.close();
  }
});

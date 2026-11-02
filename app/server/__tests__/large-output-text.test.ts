import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));
const { handleLargeOutput } = await import("../orchestration/large-output");
const { ArtifactStore, artifactStore, MAX_TEXT_RANGE_CHARS } = await import("../orchestration/tools/artifact-store");
const { createInspectArtifactTool } = await import("../orchestration/tools/artifact-inspector");
const { appConfig } = await import("../config");
q.userQueries.create("text-user", "text-clerk", "text@example.com", "Text", null, "user", null, null);
q.chatSessionQueries.create("text-session", "text-user", null);
const store = new ArtifactStore(q.artifactQueries);
spyOn(artifactStore, "store").mockImplementation(store.store.bind(store));
spyOn(artifactStore, "query").mockImplementation(store.query.bind(store));
spyOn(artifactStore, "readText").mockImplementation(store.readText.bind(store));
afterAll(() => { mock.restore(); store.destroy(); t.sqlite.close(); });

const inspect = createInspectArtifactTool("text-session");
const options = { toolCallId: "inspect", messages: [], context: undefined };

describe("large text artifacts", () => {
  it("preserves multi-document MCP output across DB reload and bounded range inspection", async () => {
    const text = '{"document":1}\n{"document":2}\n' + "🧬漢é\n".repeat(appConfig.artifact.inline_max_chars) + "FINAL RECORD";
    const result = await handleLargeOutput("demo__documents", {}, text, "text-session", {});
    expect(result.handling).toBe("artifact");
    const preview = JSON.parse(result.output);
    expect(preview._meta).toMatchObject({ artifact_id: result.artifactId, artifact_type: "text", total_chars: text.length });
    expect(result.output.length).toBeLessThan(appConfig.artifact.inline_max_chars);
    const row = q.artifactQueries.findForSession(result.artifactId!, "text-session")!;
    expect(row.artifact_type).toBe("text");
    expect(row.stored_size_bytes).toBe(Buffer.byteLength(text, "utf8"));
    store.clear();
    let reconstructed = "";
    let start = 0;
    for (;;) {
      const output = await inspect.execute!({ artifact_id: result.artifactId!, text_range: { start, length: MAX_TEXT_RANGE_CHARS } }, options as never);
      const range = JSON.parse(output as string);
      expect(range.text.length).toBeLessThanOrEqual(MAX_TEXT_RANGE_CHARS);
      reconstructed += range.text;
      if (range.next_start === null) break;
      start = range.next_start;
    }
    expect(reconstructed).toBe(text);
    expect(artifactStore.readText(result.artifactId!, "other-session", 0, 1).error).toContain("not found");
    expect(artifactStore.readText(result.artifactId!, "text-session", 0, MAX_TEXT_RANGE_CHARS + 1).error).toBeDefined();
    expect(artifactStore.readText(result.artifactId!, "text-session", -1, 1).error).toBeDefined();
    expect((await artifactStore.query(result.artifactId!, "text-session", ".")).error).toContain("text_range");
  });

  it("retains jq inspection for JSON and rejects mismatched or ambiguous selectors", async () => {
    const id = artifactStore.store("text-session", "demo__json", {}, { value: "retained" }, 20);
    expect(await inspect.execute!({ artifact_id: id, jq_filter: ".value" }, options as never)).toBe("retained");
    expect(artifactStore.readText(id, "text-session", 0, 1).error).toContain("jq_filter");
    const ambiguous = await inspect.execute!({ artifact_id: id, jq_filter: ".", text_range: { start: 0, length: 1 } }, options as never);
    expect(JSON.parse(ambiguous as string).error).toContain("exactly one");
    const absent = await inspect.execute!({ artifact_id: id }, options as never);
    expect(JSON.parse(absent as string).error).toContain("exactly one");
  });
});

import { expect, it } from "bun:test";
import { mkdtemp, rmdir, writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { inspectToolEmbeddings } from "../embeddings/index-file";
import { syncToolEmbeddings } from "../embeddings/sync-index";
import type { Embedder } from "../embeddings/types";

it("distinguishes missing, malformed and unreadable files and preserves the fs cause", async () => {
  const path = await mkdtemp(join(tmpdir(), "m6-index-"));
  const malformed = join(path, "bad.json");
  try {
    expect(await inspectToolEmbeddings(join(path, "absent"), "test")).toEqual({ ok: false, reason: "file_missing" });
    await writeFile(malformed, "{invalid");
    expect(await inspectToolEmbeddings(malformed, "test")).toEqual({ ok: false, reason: "malformed_json" });
    const result = await inspectToolEmbeddings(path, "test");
    expect(result).toMatchObject({ ok: false, reason: "read_failed" });
    if (!result.ok && result.reason === "read_failed") expect(result.cause).toMatchObject({ code: "EISDIR" });
    let embedded = false;
    let rejection: unknown;
    const embedder: Embedder = {
      id: "test", spec: { provider: "openai", model: "test", dimensions: 1 },
      embedQuery: async () => new Float32Array([1]),
      embedDocuments: async () => { embedded = true; return [new Float32Array([1])]; },
    };
    await expect(syncToolEmbeddings({
      embedder, path, tools: [{ fullName: "test__one", server: "test", description: "one" }],
      timeoutMs: 1000, onReady: () => {}, onIndexRejected: (result) => { rejection = result; },
    })).rejects.toMatchObject({ code: "EISDIR" });
    expect(rejection).toMatchObject({ reason: "read_failed", cause: { code: "EISDIR" } });
    expect(embedded).toBe(false);
  } finally { await unlink(malformed); await rmdir(path); }
});

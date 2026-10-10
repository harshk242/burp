/**
 * Index file v2: accepted only when it matches the expected embedder and every
 * vector is valid; writes are atomic and leave no temp files behind.
 */
import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readToolEmbeddings, toolEmbeddingText, writeToolEmbeddings, type ToolEmbeddingEntry } from "../embeddings/index-file";
import { logger } from "../logger";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { HybridToolSearch } from "../search/hybrid-search";
import { attachStoredEmbeddings } from "../search/reindex";

const ID = "openai:text-embedding-3-small@3";
const root = mkdtempSync(join(tmpdir(), "burp-emb-index-"));
let n = 0;
const freshDir = () => {
  const dir = join(root, String(n++));
  mkdirSync(dir);
  return dir;
};

afterAll(() => rmSync(root, { recursive: true, force: true }));

let warnSpy: ReturnType<typeof spyOn<typeof logger, "warn">> | null = null;
afterEach(() => warnSpy?.mockRestore());

const entry = (fullName: string, vector: number[]): ToolEmbeddingEntry => ({
  fullName,
  text: toolEmbeddingText(fullName, `${fullName} description`),
  vector: new Float32Array(vector),
});

function writeRaw(doc: unknown): string {
  const path = join(freshDir(), "tool-embeddings.json");
  writeFileSync(path, typeof doc === "string" ? doc : JSON.stringify(doc));
  return path;
}

const validDoc = () => ({
  version: 2,
  embedder: ID,
  dimension: 3,
  generated_at: "2026-10-09T00:00:00.000Z",
  tools: [
    { full_name: "chembl__get_admet", text: "chembl__get_admet: ADMET", embedding: [0.1, 0.2, 0.3] },
    { full_name: "pubchem__get_toxicity_info", text: "pubchem__get_toxicity_info: tox", embedding: [0.3, 0.2, 0.1] },
  ],
});

function rejectReasons(): unknown[] {
  return warnSpy!.mock.calls.filter((c) => c[1] === "embeddings_index_rejected").map((c) => c[2]?.data?.reason);
}

describe("readToolEmbeddings", () => {
  it("accepts a valid v2 file from the expected embedder", async () => {
    const index = await readToolEmbeddings(writeRaw(validDoc()), ID);
    expect(index).toMatchObject({ embedder: ID, dimension: 3 });
    expect(index!.entries.map((e) => e.fullName)).toEqual(["chembl__get_admet", "pubchem__get_toxicity_info"]);
    expect(index!.entries[0].text).toBe("chembl__get_admet: ADMET");
    expect(index!.entries[0].vector).toBeInstanceOf(Float32Array);
  });

  const v1 = { model: "gemini-embedding-001", dimension: 3, tools: [{ full_name: "a__b", text: "t", embedding: [1, 2, 3] }] };
  const cases: Array<[string, unknown, string]> = [
    ["malformed JSON", "{not json", "malformed_json"],
    ["a v1 file", v1, "version_mismatch"],
    ["another model's file", { ...validDoc(), embedder: "google:gemini-embedding-001@3" }, "embedder_mismatch"],
    ["a wrong-length vector", { ...validDoc(), tools: [...validDoc().tools, { full_name: "x__y", text: "t", embedding: [1, 2] }] }, "bad_vector"],
    ["a non-numeric vector value", { ...validDoc(), tools: [{ full_name: "x__y", text: "t", embedding: [1, null, 3] }] }, "bad_vector"],
    ["a missing text", { ...validDoc(), tools: [{ full_name: "x__y", embedding: [1, 2, 3] }] }, "malformed_json"],
  ];

  it.each(cases)("rejects %s with one warning", async (_label, doc, reason) => {
    warnSpy = spyOn(logger, "warn");
    expect(await readToolEmbeddings(writeRaw(doc), ID)).toBeNull();
    expect(rejectReasons()).toEqual([reason]);
  });

  it("rejects a missing file", async () => {
    warnSpy = spyOn(logger, "warn");
    expect(await readToolEmbeddings(join(freshDir(), "nope.json"), ID)).toBeNull();
    expect(rejectReasons()).toEqual(["file_missing"]);
  });
});

describe("attachStoredEmbeddings", () => {
  it("leaves search keyword-only with one warning when the file is from another model", async () => {
    warnSpy = spyOn(logger, "warn");
    const search = new HybridToolSearch(createQueries(createTestDb().db).toolSearchQueries);
    search.indexTools([{ fullName: "chembl__get_admet", server: "chembl", toolName: "get_admet", description: "ADMET properties" }]);
    let queried = 0;
    const embedder = { id: "openai:text-embedding-3-large@3", embedQuery: async () => (queried++, new Float32Array([1, 0, 0])) };

    expect(await attachStoredEmbeddings(search, embedder, writeRaw(validDoc()))).toBe(false);
    expect(search.embeddingsLoaded).toBe(false);
    expect(rejectReasons()).toEqual(["embedder_mismatch"]);

    const results = await search.search("ADMET properties");
    expect(results.map((r) => r.fullName)).toEqual(["chembl__get_admet"]);
    expect(results[0].semanticRank).toBeUndefined();
    expect(queried).toBe(0);
  });

  it("attaches vectors from a matching file", async () => {
    const search = new HybridToolSearch(createQueries(createTestDb().db).toolSearchQueries);
    const embedder = { id: ID, embedQuery: async () => new Float32Array([1, 0, 0]) };
    expect(await attachStoredEmbeddings(search, embedder, writeRaw(validDoc()))).toBe(true);
    expect(search.embeddingsLoaded).toBe(true);
  });
});

describe("writeToolEmbeddings", () => {
  it("round-trips through readToolEmbeddings", async () => {
    const path = join(freshDir(), "nested", "tool-embeddings.json");
    await writeToolEmbeddings(path, { embedder: ID, dimension: 3 }, [entry("a__x", [0.5, 0.25, 1])]);

    const index = await readToolEmbeddings(path, ID);
    expect(index!.entries).toEqual([entry("a__x", [0.5, 0.25, 1])]);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toMatchObject({ version: 2, embedder: ID, dimension: 3 });
  });

  it("refuses invalid vectors and writes nothing", async () => {
    const dir = freshDir();
    const path = join(dir, "tool-embeddings.json");
    await expect(writeToolEmbeddings(path, { embedder: ID, dimension: 3 }, [entry("a__x", [1, 2])])).rejects.toThrow();
    await expect(writeToolEmbeddings(path, { embedder: ID, dimension: 3 }, [entry("a__x", [1, NaN, 2])])).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("leaves one complete file and no temp files after concurrent writes", async () => {
    const dir = freshDir();
    const path = join(dir, "tool-embeddings.json");
    const many = (seed: number) => Array.from({ length: 200 }, (_, i) => entry(`p__t${i}`, [seed, i, 1]));

    await Promise.all([
      writeToolEmbeddings(path, { embedder: ID, dimension: 3 }, many(1)),
      writeToolEmbeddings(path, { embedder: ID, dimension: 3 }, many(2)),
      writeToolEmbeddings(path, { embedder: ID, dimension: 3 }, many(3)),
    ]);

    expect(readdirSync(dir)).toEqual(["tool-embeddings.json"]);
    const index = await readToolEmbeddings(path, ID);
    expect(index!.entries).toHaveLength(200);
    const seeds = new Set(index!.entries.map((e) => e.vector[0]));
    expect(seeds.size).toBe(1); // all entries from a single writer
  });

  it("removes its temp file and rethrows when the rename fails", async () => {
    const dir = freshDir();
    const path = join(dir, "tool-embeddings.json");
    mkdirSync(join(path, "occupied"), { recursive: true }); // a non-empty directory can't be renamed over

    await expect(writeToolEmbeddings(path, { embedder: ID, dimension: 3 }, [entry("a__x", [1, 2, 3])])).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["tool-embeddings.json"]);
  });
});

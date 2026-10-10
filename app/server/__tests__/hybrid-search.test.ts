/**
 * HybridToolSearch follows the live tool set: reindexing replaces the tool map,
 * semantic search only scores indexed tools, and each search uses one
 * embedder + vectors snapshot even if it is swapped mid-search.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { HybridToolSearch, type QueryEmbedder, type ToolInfo } from "../search/hybrid-search";
import { reindexToolSearch } from "../search/reindex";

function tool(fullName: string, description: string): ToolInfo {
  const [server, toolName] = fullName.split("__");
  return { fullName, server, toolName, description };
}

const ALPHA = tool("alpha__lookup", "Look up protein records");
const BETA = tool("beta__lookup", "Look up protein structures");

/** Embeds every query as `vector`; `release` resolves pending queries when deferred. */
function fakeEmbedder(id: string, vector: number[], deferred = false) {
  const pending: Array<() => void> = [];
  let calls = 0;
  const embedder: QueryEmbedder = {
    id,
    embedQuery() {
      calls++;
      const result = new Float32Array(vector);
      if (!deferred) return Promise.resolve(result);
      return new Promise((resolve) => pending.push(() => resolve(result)));
    },
  };
  return {
    embedder,
    get calls() {
      return calls;
    },
    release: () => pending.splice(0).forEach((fn) => fn()),
  };
}

const vectors = (entries: Record<string, number[]>) =>
  new Map(Object.entries(entries).map(([name, v]) => [name, new Float32Array(v)]));

// No BM25 match, so results come from the semantic half only.
const SEMANTIC_ONLY_QUERY = "zzqx";

let search: HybridToolSearch;

beforeEach(() => {
  search = new HybridToolSearch(createQueries(createTestDb().db).toolSearchQueries);
});

describe("indexTools", () => {
  it("drops tools missing from a later pass from keyword and semantic results", async () => {
    search.attachEmbeddings(fakeEmbedder("fake", [1, 0]).embedder, vectors({ [ALPHA.fullName]: [1, 0], [BETA.fullName]: [0.9, 0.1] }));

    search.indexTools([ALPHA, BETA]);
    const before = await search.search("protein");
    expect(before.map((r) => r.fullName).sort()).toEqual([ALPHA.fullName, BETA.fullName]);
    expect(before.find((r) => r.fullName === BETA.fullName)).toMatchObject({ bm25Rank: expect.any(Number), semanticRank: expect.any(Number) });

    search.indexTools([ALPHA]);
    const after = await search.search("protein");
    expect(after.map((r) => r.fullName)).toEqual([ALPHA.fullName]);
    expect((await search.search(SEMANTIC_ONLY_QUERY)).map((r) => r.fullName)).toEqual([ALPHA.fullName]);
  });

  it("reindexToolSearch indexes only the registry's available tools", () => {
    const registry = {
      getAll: (includeUnavailable = true) =>
        [
          { server: "alpha", name: "lookup", description: "a", inputSchema: {}, available: true },
          { server: "beta", name: "lookup", description: "b", inputSchema: {}, available: false },
        ].filter((t) => includeUnavailable || t.available),
    };
    expect(reindexToolSearch(registry, search).map((t) => t.fullName)).toEqual(["alpha__lookup"]);
  });
});

describe("semantic search", () => {
  it("never returns stored vectors for tools that aren't indexed", async () => {
    search.indexTools([ALPHA]);
    // The orphan vector matches the query best, but its tool isn't registered.
    search.attachEmbeddings(fakeEmbedder("fake", [1, 0]).embedder, vectors({ [ALPHA.fullName]: [0, 1], "ghost__tool": [1, 0] }));

    const results = await search.search(SEMANTIC_ONLY_QUERY);
    expect(results.map((r) => r.fullName)).toEqual([ALPHA.fullName]);
    expect(results.every((r) => r.server !== "")).toBe(true);
  });

  it("uses the snapshot read at search start when embeddings are swapped mid-query", async () => {
    search.indexTools([ALPHA, BETA]);
    const oldEmb = fakeEmbedder("old", [1, 0], true);
    const newEmb = fakeEmbedder("new", [1, 0]);
    // Old snapshot ranks ALPHA first. The new vectors rank BETA first for the
    // old query vector too, so any mixing of snapshots would flip the order.
    search.attachEmbeddings(oldEmb.embedder, vectors({ [ALPHA.fullName]: [1, 0], [BETA.fullName]: [0.5, 0.5] }));

    const pending = search.search(SEMANTIC_ONLY_QUERY);
    search.attachEmbeddings(newEmb.embedder, vectors({ [ALPHA.fullName]: [0, 1], [BETA.fullName]: [1, 0] }));
    oldEmb.release();

    const results = await pending;
    expect(results.map((r) => r.fullName)).toEqual([ALPHA.fullName, BETA.fullName]);
    expect(newEmb.calls).toBe(0);

    // The next search picks up the new snapshot.
    expect((await search.search(SEMANTIC_ONLY_QUERY)).map((r) => r.fullName)).toEqual([BETA.fullName, ALPHA.fullName]);
    expect(newEmb.calls).toBe(1);
  });
});

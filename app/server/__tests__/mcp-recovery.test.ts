import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { MCPManager } from "../mcp/manager";
import { toolRegistry } from "../mcp/registry";
import { ToolEmbeddingSync } from "../embeddings/sync-queue";
import type { Embedder } from "../embeddings/types";
import { HybridToolSearch } from "../search/hybrid-search";
import { createSearchReindexer, reindexToolSearch } from "../search/reindex";

const FIXTURE = join(import.meta.dir, "fixtures", "flaky-mcp-server.ts");
const dir = mkdtempSync(join(tmpdir(), "burp-mcp-recovery-"));
const marker = join(dir, "fail");

let manager: MCPManager | null = null;

afterEach(async () => {
  await manager?.stopAll();
  toolRegistry.clear();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("MCP recovery", () => {
  it("reindexes hybrid search when a server that failed at boot recovers", async () => {
    writeFileSync(marker, "");
    manager = new MCPManager();
    manager.register({ name: "flaky", command: process.execPath, args: [FIXTURE], env: { FLAKY_FAIL_MARKER: marker } });

    const search = new HybridToolSearch(createQueries(createTestDb().db).toolSearchQueries);
    let changes = 0;
    manager.onToolsChanged = () => {
      changes++;
      reindexToolSearch(toolRegistry, search);
    };

    await manager.start("flaky");
    expect(manager.getStatus("flaky")?.status).toBe("error");
    reindexToolSearch(toolRegistry, search);
    expect(await search.search("frobnicate widgets")).toEqual([]);

    rmSync(marker);
    await manager.retryDueServers(new Date(Date.now() + 120_000));

    expect(manager.getStatus("flaky")?.status).toBe("running");
    expect(changes).toBe(1);
    const results = await search.search("frobnicate widgets");
    expect(results.map((r) => r.fullName)).toEqual(["demo__frobnicate_widgets"]);
    expect(results[0].server).toBe("demo");
  }, 20_000);

  it("syncs embeddings for the recovered tools and attaches them", async () => {
    writeFileSync(marker, "");
    manager = new MCPManager();
    manager.register({ name: "flaky", command: process.execPath, args: [FIXTURE], env: { FLAKY_FAIL_MARKER: marker } });

    const embedded: string[][] = [];
    const embedder: Embedder = {
      id: "fake:model@2",
      spec: { provider: "openai", model: "fake", dimensions: 2 },
      embedQuery: async () => new Float32Array([1, 0]),
      embedDocuments: async (texts) => {
        embedded.push(texts);
        return texts.map(() => new Float32Array([1, 0]));
      },
    };
    const search = new HybridToolSearch(createQueries(createTestDb().db).toolSearchQueries);
    const path = join(dir, "tool-embeddings.json");
    const sync = new ToolEmbeddingSync({ embedder, path, timeoutMs: 5000, onReady: (e, v) => search.attachEmbeddings(e, v) });
    const reindex = createSearchReindexer(toolRegistry, search, sync);
    manager.onToolsChanged = reindex;

    await manager.start("flaky");
    reindex();
    await sync.idle();
    expect(embedded).toEqual([]);
    expect(search.embeddingsLoaded).toBe(false);

    rmSync(marker);
    await manager.retryDueServers(new Date(Date.now() + 120_000));
    await sync.idle();

    expect(embedded).toHaveLength(1);
    expect(embedded[0]).toEqual([expect.stringMatching(/^demo__frobnicate_widgets: /)]);
    const results = await search.search("frobnicate widgets");
    expect(results[0]).toMatchObject({ fullName: "demo__frobnicate_widgets", semanticRank: 1 });
  }, 20_000);

  it("drops a crashed server's tools from search, notifies once, and restores them on recovery", async () => {
    manager = new MCPManager();
    manager.register({ name: "flaky", command: process.execPath, args: [FIXTURE], env: { FLAKY_FAIL_MARKER: marker } });

    const embedded: string[][] = [];
    const embedder: Embedder = {
      id: "fake:model@2",
      spec: { provider: "openai", model: "fake", dimensions: 2 },
      embedQuery: async () => new Float32Array([1, 0]),
      embedDocuments: async (texts) => {
        embedded.push(texts);
        return texts.map(() => new Float32Array([1, 0]));
      },
    };
    const search = new HybridToolSearch(createQueries(createTestDb().db).toolSearchQueries);
    const path = join(dir, "crash-tool-embeddings.json");
    const sync = new ToolEmbeddingSync({ embedder, path, timeoutMs: 5000, onReady: (e, v) => search.attachEmbeddings(e, v) });
    const reindex = createSearchReindexer(toolRegistry, search, sync);
    let changes = 0;
    manager.onToolsChanged = () => {
      changes++;
      reindex();
    };

    await manager.start("flaky");
    await toolRegistry.discoverTools(manager);
    reindex();
    await sync.idle();
    expect((await search.search("frobnicate widgets"))[0]).toMatchObject({ fullName: "demo__frobnicate_widgets", semanticRank: 1 });
    const file = readFileSync(path, "utf-8");

    writeFileSync(marker, "");
    process.kill(manager.getStatus("flaky")!.transport!.pid!, "SIGKILL");
    while (manager.getStatus("flaky")?.status !== "error") await Bun.sleep(10);
    await sync.idle();

    expect(changes).toBe(1);
    expect(toolRegistry.availableCount).toBe(0);
    expect(await search.search("frobnicate widgets")).toEqual([]);
    expect(embedded).toHaveLength(1);
    expect(readFileSync(path, "utf-8")).toBe(file);

    await manager.retryDueServers(new Date(Date.now() + 120_000));
    expect(manager.getStatus("flaky")?.status).toBe("error");
    expect(changes).toBe(1);

    rmSync(marker);
    await manager.retryDueServers(new Date(Date.now() + 120_000));
    await sync.idle();

    expect(changes).toBe(2);
    expect((await search.search("frobnicate widgets"))[0]).toMatchObject({ fullName: "demo__frobnicate_widgets", semanticRank: 1 });
    expect(embedded).toHaveLength(1);
  }, 20_000);
});

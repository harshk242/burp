/**
 * An MCP server that fails at boot and later recovers fires onToolsChanged,
 * and the reindex wired to it makes the recovered tools searchable.
 */
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { MCPManager } from "../mcp/manager";
import { toolRegistry } from "../mcp/registry";
import { HybridToolSearch } from "../search/hybrid-search";
import { reindexToolSearch } from "../search/reindex";

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
    reindexToolSearch(toolRegistry, search); // boot indexing, with nothing discovered
    expect(await search.search("frobnicate widgets")).toEqual([]);

    rmSync(marker);
    await manager.retryDueServers(new Date(Date.now() + 120_000));

    expect(manager.getStatus("flaky")?.status).toBe("running");
    expect(changes).toBe(1);
    const results = await search.search("frobnicate widgets");
    expect(results.map((r) => r.fullName)).toEqual(["demo__frobnicate_widgets"]);
    expect(results[0].server).toBe("demo");
  }, 20_000);
});

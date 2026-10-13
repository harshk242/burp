/**
 * MCPManager.callTool deadlines: a timed-out or aborted call is cancelled in
 * the MCP client (the server sees notifications/cancelled and its handler's
 * signal aborts), and a call that answers in time leaves no timer behind. The
 * deadline is sent as `_meta.deadline_ms` and the result's `_meta` is kept.
 *
 * The manager's "unified" server is wired to a real McpServer over the SDK's
 * in-memory transport.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCPManager } from "../mcp/manager";

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

/** A manager whose unified server has `demo__hang` (never answers until cancelled), `demo__ok` and `demo__meta`. */
async function connectedManager() {
  const cancelled: AbortSignal[] = [];
  const requestMeta: unknown[] = [];
  const server = new McpServer({ name: "test", version: "1.0.0" });
  server.registerTool("demo__hang", { description: "never answers" }, (extra) => {
    cancelled.push(extra.signal);
    return new Promise(() => {});
  });
  server.registerTool("demo__ok", { description: "answers" }, async () => ({
    content: [{ type: "text", text: "ok" }],
  }));
  server.registerTool("demo__meta", { description: "answers with _meta" }, async (extra) => {
    requestMeta.push(extra._meta);
    return { content: [{ type: "text", text: "failed" }], isError: true, _meta: { retry: { attempts: 3 } } };
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanup = async () => {
    await client.close();
    await server.close();
  };

  const manager = new MCPManager();
  manager.register({ name: "unified", command: "unused", args: [] });
  const unified = manager.getStatus("unified")!;
  unified.client = client;
  unified.status = "running";
  return { manager, serverSignals: cancelled, requestMeta };
}

async function waitFor(check: () => boolean, ms = 1_000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
}

describe("MCPManager.callTool deadlines", () => {
  it("cancels the request on the server when the timeout passes", async () => {
    const { manager, serverSignals } = await connectedManager();

    await expect(manager.callTool("demo", "hang", {}, 20)).rejects.toThrow("Tool call timed out after 20ms");

    await waitFor(() => serverSignals[0]?.aborted === true);
    expect(serverSignals).toHaveLength(1);
    expect(serverSignals[0].aborted).toBe(true);
  });

  it("cancels the request on the server when the caller aborts, without reporting a timeout", async () => {
    const { manager, serverSignals } = await connectedManager();
    const controller = new AbortController();

    const call = manager.callTool("demo", "hang", {}, 30_000, controller.signal);
    await waitFor(() => serverSignals.length === 1);
    controller.abort();

    const error = await call.then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("Tool call timed out");
    await waitFor(() => serverSignals[0]?.aborted === true);
    expect(serverSignals[0].aborted).toBe(true);
  });

  it("sends the deadline as _meta.deadline_ms and keeps the result's _meta", async () => {
    const { manager, requestMeta } = await connectedManager();

    const result = await manager.callTool("demo", "meta", {}, 12_345);

    expect(requestMeta[0]).toMatchObject({ deadline_ms: 12_345 });
    expect(result).toEqual({ content: "failed", isError: true, meta: { retry: { attempts: 3 } } });
  });

  it("leaves no deadline timer pending when the call answers in time", async () => {
    const { manager } = await connectedManager();
    const TIMEOUT_MS = 54_321;
    const pending = new Set<unknown>();
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      const id = realSetTimeout(fn, ms, ...rest);
      if (ms === TIMEOUT_MS) pending.add(id);
      return id;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id?: Parameters<typeof clearTimeout>[0]) => {
      pending.delete(id);
      realClearTimeout(id);
    }) as typeof clearTimeout;
    try {
      const result = await manager.callTool("demo", "ok", {}, TIMEOUT_MS);
      expect(result).toEqual({ content: "ok", isError: false });
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
    expect(pending.size).toBe(0);
  });
});

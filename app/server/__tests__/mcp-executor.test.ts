import { afterEach, describe, expect, it, spyOn, mock } from "bun:test";
import { mcpManager } from "../mcp/manager";
import {
  McpToolError,
  createMcpToolExecutor,
  executeMcpTool,
  upstreamTraceMetadata,
} from "../orchestration/tools/mcp-executor";

const TOOL = "ensembl__lookup_gene";
const retry = { attempts: 3, outcome: "failed", platforms: ["ensembl"] };
const errorJson = '{"error":"upstream_unavailable","attempts":3}';

afterEach(() => mock.restore());

describe("executeMcpTool", () => {
  it("returns text, isError and meta without throwing on a tool error", async () => {
    const call = spyOn(mcpManager, "callTool").mockResolvedValue({ content: JSON.parse(errorJson), isError: true, meta: { retry } });

    expect(await executeMcpTool(TOOL, { symbol: "BRCA1" })).toEqual({ text: errorJson, isError: true, meta: { retry } });
    expect(call).toHaveBeenCalledWith("ensembl", "lookup_gene", { symbol: "BRCA1" }, undefined, undefined);
  });

  it("omits meta when the server sent none", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue({ content: "ok", isError: false });
    expect(await executeMcpTool(TOOL, {})).toEqual({ text: "ok", isError: false });
  });

  it("throws transport errors and timeouts as-is", async () => {
    spyOn(mcpManager, "callTool").mockRejectedValue(new Error("Tool call timed out after 60000ms"));
    await expect(executeMcpTool(TOOL, {})).rejects.toThrow("Tool call timed out after 60000ms");
  });

  it("drops a result that lands after an abort", async () => {
    const turn = new AbortController();
    spyOn(mcpManager, "callTool").mockImplementation(async () => {
      turn.abort();
      return { content: "late", isError: false };
    });
    await expect(executeMcpTool(TOOL, {}, turn.signal)).rejects.toBe(turn.signal.reason);
  });
});

describe("createMcpToolExecutor (SDK execute)", () => {
  it("returns the plain string on success", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue({ content: { ok: true }, isError: false, meta: { retry } });
    expect(await createMcpToolExecutor(TOOL)({})).toBe('{"ok":true}');
  });

  it("throws McpToolError with the tool text as message and the meta attached", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue({ content: JSON.parse(errorJson), isError: true, meta: { retry } });

    const error = await createMcpToolExecutor(TOOL)({}).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(McpToolError);
    expect(error).toBeInstanceOf(Error);
    expect((error as McpToolError).message).toBe(errorJson);
    expect((error as McpToolError).meta).toEqual({ retry });
  });
});

describe("upstreamTraceMetadata", () => {
  it("lifts attempts and outcome next to the full summary", () => {
    expect(upstreamTraceMetadata({ retry })).toEqual({ upstream_retry: retry, upstream_attempts: 3, upstream_outcome: "failed" });
  });

  it("is undefined without a retry summary", () => {
    expect(upstreamTraceMetadata(undefined)).toBeUndefined();
    expect(upstreamTraceMetadata({ other: 1 })).toBeUndefined();
  });
});

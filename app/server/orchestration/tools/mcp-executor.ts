/**
 * Wraps mcpManager.callTool() for the chat pipeline and as Vercel AI SDK
 * execute functions.
 */

import { mcpManager } from "../../mcp/manager";
import { toolRegistry } from "../../mcp/registry";

/** One MCP tool call: its text, whether the tool reported an error, and the server's `_meta`. */
export interface McpExecution {
  text: string;
  isError: boolean;
  meta?: Record<string, unknown>;
}

/** A tool that returned `isError`: the message is the tool's text, `meta` its `_meta`. */
export class McpToolError extends Error {
  constructor(message: string, readonly meta?: Record<string, unknown>) {
    super(message);
    this.name = "McpToolError";
  }
}

/**
 * Runs an MCP tool. An `isError` result is returned, not thrown; this throws
 * only for transport errors, timeouts and aborts. `signal` cancels the
 * in-flight call; a result that lands after an abort is dropped.
 */
export async function executeMcpTool(
  fullName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<McpExecution> {
  const { server, name } = toolRegistry.parseToolName(fullName);
  signal?.throwIfAborted();
  const result = await mcpManager.callTool(server, name, args, undefined, signal);
  signal?.throwIfAborted();

  const text = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
  return { text, isError: result.isError, ...(result.meta && { meta: result.meta }) };
}

/** String-in/string-out executor for SDK tool registrations; an `isError` result throws `McpToolError`. */
export function createMcpToolExecutor(fullName: string, signal?: AbortSignal) {
  return async (args: Record<string, unknown>): Promise<string> => {
    const { text, isError, meta } = await executeMcpTool(fullName, args, signal);
    if (isError) throw new McpToolError(text, meta);
    return text;
  };
}

/**
 * Trace span metadata from the server's `_meta.retry` (upstream retry summary):
 * the whole summary plus its attempts and outcome as top-level keys for
 * filtering. Undefined when the call made no upstream request.
 */
export function upstreamTraceMetadata(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  const retry = meta?.retry;
  if (!retry || typeof retry !== "object") return undefined;
  const { attempts, outcome } = retry as { attempts?: unknown; outcome?: unknown };
  return { upstream_retry: retry, upstream_attempts: attempts, upstream_outcome: outcome };
}

import { mcpManager } from "../../mcp/manager";
import { toolRegistry } from "../../mcp/registry";

export interface McpExecution {
  text: string;
  isError: boolean;
  meta?: Record<string, unknown>;
}

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

export function upstreamTraceMetadata(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  const retry = meta?.retry;
  if (!retry || typeof retry !== "object") return undefined;
  const { attempts, outcome } = retry as { attempts?: unknown; outcome?: unknown };
  return { upstream_retry: retry, upstream_attempts: attempts, upstream_outcome: outcome };
}

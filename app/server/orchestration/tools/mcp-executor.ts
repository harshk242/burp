/**
 * Wraps mcpManager.callTool() as Vercel AI SDK execute functions.
 */

import { mcpManager } from "../../mcp/manager";
import { toolRegistry } from "../../mcp/registry";

/** `signal` cancels the in-flight MCP call; a result that lands after an abort is dropped. */
export function createMcpToolExecutor(fullName: string, signal?: AbortSignal) {
  return async (args: Record<string, unknown>): Promise<string> => {
    const { server, name } = toolRegistry.parseToolName(fullName);
    signal?.throwIfAborted();
    const result = await mcpManager.callTool(server, name, args, undefined, signal);
    signal?.throwIfAborted();

    if (result.isError) {
      throw new Error(
        typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content)
      );
    }

    return typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content);
  };
}

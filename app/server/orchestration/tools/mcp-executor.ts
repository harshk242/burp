/**
 * Wraps mcpManager.callTool() as Vercel AI SDK execute functions.
 */

import { mcpManager } from "../../mcp/manager";
import { toolRegistry } from "../../mcp/registry";

export function createMcpToolExecutor(fullName: string) {
  return async (args: Record<string, unknown>): Promise<string> => {
    const { server, name } = toolRegistry.parseToolName(fullName);
    const result = await mcpManager.callTool(server, name, args);

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

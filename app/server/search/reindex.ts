/**
 * Keeps hybrid search in step with the tool registry. Used at boot and
 * whenever the MCP manager reports that the tool set changed.
 */

import type { MCPTool, toolRegistry as ToolRegistryType } from "../mcp/registry";
import type { HybridToolSearch, ToolInfo } from "./hybrid-search";

export function toToolInfo(tool: MCPTool): ToolInfo {
  return {
    fullName: `${tool.server}__${tool.name}`,
    server: tool.server,
    toolName: tool.name,
    description: tool.description,
  };
}

/** Rebuild the search index from the registry's available tools; returns the indexed snapshot. */
export function reindexToolSearch(
  registry: Pick<typeof ToolRegistryType, "getAll">,
  search: Pick<HybridToolSearch, "indexTools">
): ToolInfo[] {
  const tools = registry.getAll(false).map(toToolInfo);
  search.indexTools(tools);
  return tools;
}

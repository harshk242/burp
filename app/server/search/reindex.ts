/**
 * Keeps hybrid search in step with the tool registry (at boot and whenever the
 * MCP manager reports that the tool set changed) and with the embeddings index.
 */

import { readToolEmbeddings, toVectorMap } from "../embeddings/index-file";
import type { QueryEmbedder } from "../embeddings/types";
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

/**
 * Attach vectors from the index file if it was made by `embedder`. Returns
 * whether anything was attached; otherwise search stays keyword-only and the
 * reader has logged why.
 */
export async function attachStoredEmbeddings(
  search: Pick<HybridToolSearch, "attachEmbeddings">,
  embedder: QueryEmbedder,
  indexPath: string
): Promise<boolean> {
  const index = await readToolEmbeddings(indexPath, embedder.id);
  if (!index || index.entries.length === 0) return false;
  search.attachEmbeddings(embedder, toVectorMap(index.entries));
  return true;
}

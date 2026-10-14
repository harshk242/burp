import { readToolEmbeddings, toVectorMap } from "../embeddings/index-file";
import type { ToolEmbeddingSync } from "../embeddings/sync-queue";
import type { Embedder, QueryEmbedder } from "../embeddings/types";
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

export function reindexToolSearch(
  registry: Pick<typeof ToolRegistryType, "getAll">,
  search: Pick<HybridToolSearch, "indexTools">
): ToolInfo[] {
  const tools = registry.getAll(false).map(toToolInfo);
  search.indexTools(tools);
  return tools;
}

export function createSearchReindexer(
  registry: Pick<typeof ToolRegistryType, "getAll">,
  search: Pick<HybridToolSearch, "indexTools">,
  sync: Pick<ToolEmbeddingSync, "request"> | null
): () => void {
  return () => {
    const tools = reindexToolSearch(registry, search);
    sync?.request(tools);
  };
}

export async function attachStoredEmbeddings(
  search: Pick<HybridToolSearch, "attachEmbeddings">,
  embedder: QueryEmbedder & Partial<Pick<Embedder, "spec">>,
  indexPath: string
): Promise<boolean> {
  const index = await readToolEmbeddings(indexPath, embedder.id, embedder.spec?.dimensions);
  if (!index || index.entries.length === 0) return false;
  search.attachEmbeddings(embedder, toVectorMap(index.entries));
  return true;
}

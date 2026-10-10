export { HybridToolSearch, type SearchResult, type ToolInfo, type HybridSearchConfig, type QueryEmbedder } from "./hybrid-search";
export { loadEmbeddingsFile, aiSdkQueryEmbedder } from "./embeddings-file";
export { reindexToolSearch, toToolInfo } from "./reindex";
import { HybridToolSearch } from "./hybrid-search";
import { toolSearchQueries } from "../db";

export const hybridSearch = new HybridToolSearch(toolSearchQueries);

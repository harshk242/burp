export { HybridToolSearch, type SearchResult, type ToolInfo, type HybridSearchConfig } from "./hybrid-search";
export { attachStoredEmbeddings, createSearchReindexer, reindexToolSearch, toToolInfo } from "./reindex";
import { HybridToolSearch } from "./hybrid-search";
import { toolSearchQueries } from "../db";

export const hybridSearch = new HybridToolSearch(toolSearchQueries);

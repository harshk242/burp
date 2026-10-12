/**
 * Tool boot shared by the server, the prompt-cache gate and the eval runner:
 * start the MCP servers, discover their tools, index tool search, and attach
 * embeddings (background sync, or the stored index file when sync is off).
 *
 * The keyword index is rebuilt whenever an MCP server recovers
 * (`mcpManager.onToolsChanged`), so recovered tools are searchable without a
 * restart.
 */

import { appConfig } from "../config";
import { createEmbedder, ToolEmbeddingSync, type Embedder } from "../embeddings";
import { logger, startTimer } from "../logger";
import { mcpManager } from "../mcp/manager";
import { toolRegistry } from "../mcp/registry";
import { attachStoredEmbeddings, createSearchReindexer, hybridSearch } from "../search";

export interface ToolsReport {
  toolsAvailable: number;
  toolsTotal: number;
  searchIndexed: boolean;
  embeddingsLoaded: boolean;
  /** Embedder id, null without an embedding key. */
  embedder: string | null;
}

export interface ToolsBoot {
  /** Null when the embedding provider's key is missing: search stays keyword-only. */
  embedder: Embedder | null;
  /** Background embeddings sync; null without an embedder or when embedding.sync_on_boot is false. */
  embeddingSync: ToolEmbeddingSync | null;
  /** Resolves once servers started, tools are discovered and search is indexed. */
  ready: Promise<ToolsReport>;
}

/** Current state of tool search (also after the embedding sync attached its vectors). */
export function toolsReport(embedder: Embedder | null): ToolsReport {
  return {
    toolsAvailable: toolRegistry.availableCount,
    toolsTotal: toolRegistry.count,
    searchIndexed: hybridSearch.indexed,
    embeddingsLoaded: hybridSearch.embeddingsLoaded,
    embedder: embedder?.id ?? null,
  };
}

/** Starts the tool boot; `ready` never resolves before search is indexed. Call once per process. */
export function initializeTools(): ToolsBoot {
  const embedder = createEmbedder(appConfig.embedding, { queryTimeoutMs: appConfig.embedding.query_timeout_ms });

  // Keeps the embeddings index in step with the tool set in the background and
  // attaches its vectors (latest snapshot wins).
  const embeddingSync =
    embedder && appConfig.embedding.sync_on_boot
      ? new ToolEmbeddingSync({
          embedder,
          path: appConfig.tool_search.embeddings_path,
          timeoutMs: appConfig.embedding.sync_timeout_ms,
          onReady: (e, vectors) => hybridSearch.attachEmbeddings(e, vectors),
        })
      : null;

  const reindexSearch = createSearchReindexer(toolRegistry, hybridSearch, embeddingSync);
  mcpManager.onToolsChanged = reindexSearch;

  const ready = (async (): Promise<ToolsReport> => {
    const elapsed = startTimer();
    logger.info("STARTUP", "mcp_init_start");
    mcpManager.registerAll();

    logger.info("STARTUP", "mcp_servers_starting");
    const { succeeded, failed } = await mcpManager.startAll();
    logger.info("STARTUP", "mcp_servers_started", { data: { succeeded, failed, total: succeeded + failed } });

    logger.info("STARTUP", "tool_discovery_start");
    await toolRegistry.discoverTools(mcpManager);

    reindexSearch();

    // Without sync, attach whatever the index file holds for this embedder
    // (optional — BM25 works without it). With sync, the sync attaches.
    if (embedder && !embeddingSync) await attachStoredEmbeddings(hybridSearch, embedder, appConfig.tool_search.embeddings_path);

    const report = toolsReport(embedder);
    logger.info("STARTUP", "mcp_init_complete", {
      duration_ms: elapsed(),
      data: {
        tools_available: report.toolsAvailable,
        tools_total: report.toolsTotal,
        search_indexed: report.searchIndexed,
        embeddings_loaded: report.embeddingsLoaded,
        embedder: report.embedder ?? undefined,
        embeddings_sync: embeddingSync ? "background" : "off",
      },
    });
    return report;
  })();

  return { embedder, embeddingSync, ready };
}

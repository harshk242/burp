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
  embedder: string | null;
}

export interface ToolsBoot {
  embedder: Embedder | null;
  embeddingSync: ToolEmbeddingSync | null;
  ready: Promise<ToolsReport>;
}

let bootReady: Promise<unknown> | null = null;

/** Resolves true once `work` settles (either way), false on timeout or abort. */
export async function settlesWithin(work: Promise<unknown>, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const giveUp = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    onAbort = () => resolve(false);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work.then(() => true, () => true), giveUp]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

/** Records the in-flight tool boot that `waitForTools` gates on; null clears it. */
export function trackToolsBoot(ready: Promise<unknown> | null): void {
  bootReady = ready;
}

/** Lets a turn that arrives during a cold start wait for the tool catalog; true at once when boot never ran. */
export function waitForTools(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  return bootReady ? settlesWithin(bootReady, timeoutMs, signal) : Promise.resolve(true);
}

export function toolsReport(embedder: Embedder | null): ToolsReport {
  return {
    toolsAvailable: toolRegistry.availableCount,
    toolsTotal: toolRegistry.count,
    searchIndexed: hybridSearch.indexed,
    embeddingsLoaded: hybridSearch.embeddingsLoaded,
    embedder: embedder?.id ?? null,
  };
}

export function initializeTools(): ToolsBoot {
  const embedder = createEmbedder(appConfig.embedding, { queryTimeoutMs: appConfig.embedding.query_timeout_ms });

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

  trackToolsBoot(ready);
  return { embedder, embeddingSync, ready };
}

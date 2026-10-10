/**
 * Hybrid Tool Search Engine
 * Combines FTS5 BM25 text search with embedding cosine similarity,
 * fused via Reciprocal Rank Fusion (RRF).
 */

import type { createToolSearchQueries } from "../db/queries/tool-search";
import { logger, startTimer } from "../logger";
import { appConfig } from "../config";

type ToolSearchQueries = ReturnType<typeof createToolSearchQueries>;

/** Embeds search queries. `id` names the model so logs show what ranked results. */
export interface QueryEmbedder {
  readonly id: string;
  embedQuery(text: string): Promise<Float32Array>;
}

/**
 * Embedder and the tool vectors it produced, swapped as one unit so a search
 * never compares a query from one model against vectors from another.
 */
interface EmbeddingSnapshot {
  readonly embedder: QueryEmbedder;
  readonly vectors: ReadonlyMap<string, Float32Array>;
}

export interface SearchResult {
  fullName: string;
  server: string;
  toolName: string;
  description: string;
  score: number;
  bm25Rank?: number;
  semanticRank?: number;
}

export interface ToolInfo {
  fullName: string;
  server: string;
  toolName: string;
  description: string;
}

export interface HybridSearchConfig {
  bm25Weight: number;
  semanticWeight: number;
  shortQueryTokenThreshold: number;
  shortQueryBm25Weight: number;
  topK: number;
  rrfK: number;
}

function loadConfig(): HybridSearchConfig {
  const ts = appConfig.tool_search;
  return {
    bm25Weight: ts.bm25_weight,
    semanticWeight: ts.semantic_weight,
    shortQueryTokenThreshold: ts.short_query_threshold,
    shortQueryBm25Weight: ts.short_query_bm25_weight,
    topK: ts.top_k,
    rrfK: 60,
  };
}

export class HybridToolSearch {
  private embeddings: EmbeddingSnapshot | null = null;
  // Replaced wholesale on reindex (never mutated), so a search can hold a stable reference.
  private toolIndex: ReadonlyMap<string, ToolInfo> = new Map();
  private config: HybridSearchConfig;

  constructor(private readonly queries: ToolSearchQueries) {
    this.config = loadConfig();
  }

  /** Replace the embedder and tool vectors together. */
  attachEmbeddings(embedder: QueryEmbedder, vectors: ReadonlyMap<string, Float32Array>): void {
    this.embeddings = { embedder, vectors: new Map(vectors) };
    logger.info("SEARCH", "embeddings_attached", {
      data: { embedder: embedder.id, tool_count: vectors.size },
    });
  }

  /** Rebuild the keyword index and tool map from the full set of live tools. */
  indexTools(tools: ToolInfo[]): void {
    const elapsed = startTimer();
    const toolIndex = new Map<string, ToolInfo>();
    this.queries.clearAll();

    for (const tool of tools) {
      this.queries.insertTool(tool.fullName, tool.server, tool.toolName, tool.description);
      toolIndex.set(tool.fullName, tool);
    }
    this.toolIndex = toolIndex;

    logger.info("SEARCH", "fts_indexed", {
      duration_ms: elapsed(),
      data: { tool_count: tools.length },
    });
  }

  async search(query: string): Promise<SearchResult[]> {
    const elapsed = startTimer();
    const snapshot = this.embeddings;
    const toolIndex = this.toolIndex;
    const bm25Results = this.searchBM25(query);
    const semanticResults = await this.searchSemantic(query, snapshot, toolIndex);
    const fused = this.fuseRRF(bm25Results, semanticResults, query);

    logger.info("SEARCH", "hybrid_search_complete", {
      duration_ms: elapsed(),
      data: {
        query,
        embedder: snapshot?.embedder.id,
        bm25_hits: bm25Results.length,
        semantic_hits: semanticResults.length,
        fused_hits: fused.length,
      },
    });

    return fused.slice(0, this.config.topK);
  }

  private searchBM25(query: string): SearchResult[] {
    try {
      const ftsQuery = query
        .replace(/[^\w\s]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .join(" OR ");

      if (!ftsQuery) return [];

      const rows = this.queries.searchBM25(ftsQuery, this.config.topK * 2);
      return rows.map((r, i) => ({
        fullName: r.full_name,
        server: r.server,
        toolName: r.tool_name,
        description: r.description,
        score: 0,
        bm25Rank: i + 1,
      }));
    } catch (err) {
      logger.warn("SEARCH", "bm25_search_failed", {
        error: err instanceof Error ? err : String(err),
        data: { query },
      });
      return [];
    }
  }

  /**
   * Rank tools in `toolIndex` against the query using `snapshot`. Both are read
   * by the caller before any await, so a concurrent swap or reindex can't mix
   * models or score tools that aren't registered.
   */
  private async searchSemantic(
    query: string,
    snapshot: EmbeddingSnapshot | null,
    toolIndex: ReadonlyMap<string, ToolInfo>
  ): Promise<SearchResult[]> {
    if (!snapshot || snapshot.vectors.size === 0) return [];

    try {
      const queryEmb = await snapshot.embedder.embedQuery(query);
      const scored: Array<{ tool: ToolInfo; sim: number }> = [];

      for (const tool of toolIndex.values()) {
        const toolEmb = snapshot.vectors.get(tool.fullName);
        if (toolEmb) scored.push({ tool, sim: this.cosineSimilarity(queryEmb, toolEmb) });
      }

      scored.sort((a, b) => b.sim - a.sim);

      return scored.slice(0, this.config.topK * 2).map(({ tool, sim }, i) => ({
        fullName: tool.fullName,
        server: tool.server,
        toolName: tool.toolName,
        description: tool.description,
        score: sim,
        semanticRank: i + 1,
      }));
    } catch (err) {
      logger.warn("SEARCH", "semantic_search_failed", {
        error: err instanceof Error ? err : String(err),
        data: { query },
      });
      return [];
    }
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private fuseRRF(
    bm25: SearchResult[],
    semantic: SearchResult[],
    query: string
  ): SearchResult[] {
    const wordCount = query.trim().split(/\s+/).length;
    const isShortQuery = wordCount <= this.config.shortQueryTokenThreshold;
    const bm25W = isShortQuery ? this.config.shortQueryBm25Weight : this.config.bm25Weight;
    const semW = this.config.semanticWeight;
    const k = this.config.rrfK;

    const scoreMap = new Map<string, { result: SearchResult; score: number }>();

    for (const r of bm25) {
      const existing = scoreMap.get(r.fullName);
      const rrfScore = bm25W / (k + (r.bm25Rank ?? Infinity));
      if (existing) {
        existing.score += rrfScore;
        existing.result.bm25Rank = r.bm25Rank;
      } else {
        scoreMap.set(r.fullName, { result: { ...r }, score: rrfScore });
      }
    }

    for (const r of semantic) {
      const existing = scoreMap.get(r.fullName);
      const rrfScore = semW / (k + (r.semanticRank ?? Infinity));
      if (existing) {
        existing.score += rrfScore;
        existing.result.semanticRank = r.semanticRank;
      } else {
        scoreMap.set(r.fullName, { result: { ...r }, score: rrfScore });
      }
    }

    const results = Array.from(scoreMap.values());
    results.sort((a, b) => b.score - a.score);

    return results.map(({ result, score }) => ({ ...result, score }));
  }

  get indexed(): boolean {
    return this.toolIndex.size > 0;
  }

  get embeddingsLoaded(): boolean {
    return (this.embeddings?.vectors.size ?? 0) > 0;
  }
}

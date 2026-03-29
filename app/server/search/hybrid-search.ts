/**
 * Hybrid Tool Search Engine
 * Combines FTS5 BM25 text search with embedding cosine similarity,
 * fused via Reciprocal Rank Fusion (RRF).
 */

import { embed } from "ai";
import { toolSearchQueries } from "../db";
import { logger, startTimer } from "../logger";
import { appConfig } from "../config";

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
  private embeddings = new Map<string, Float32Array>();
  private toolIndex = new Map<string, ToolInfo>();
  private config: HybridSearchConfig;
  private embeddingModel: Parameters<typeof embed>[0]["model"] | null = null;

  constructor() {
    this.config = loadConfig();
  }

  loadEmbeddings(filePath: string): void {
    const elapsed = startTimer();
    const raw = JSON.parse(require("fs").readFileSync(filePath, "utf-8"));

    for (const entry of raw.tools) {
      this.embeddings.set(entry.full_name, new Float32Array(entry.embedding));
    }

    logger.info("SEARCH", "embeddings_loaded", {
      duration_ms: elapsed(),
      data: {
        model: raw.model,
        dimension: raw.dimension,
        tool_count: raw.tools.length,
      },
    });
  }

  indexTools(tools: ToolInfo[]): void {
    const elapsed = startTimer();
    toolSearchQueries.clearAll();

    for (const tool of tools) {
      toolSearchQueries.insertTool(tool.fullName, tool.server, tool.toolName, tool.description);
      this.toolIndex.set(tool.fullName, tool);
    }

    logger.info("SEARCH", "fts_indexed", {
      duration_ms: elapsed(),
      data: { tool_count: tools.length },
    });
  }

  /**
   * Set the embedding model for query-time embedding.
   * Called after AI SDK dependencies are available.
   */
  setEmbeddingModel(model: Parameters<typeof embed>[0]["model"]): void {
    this.embeddingModel = model;
  }

  async search(query: string): Promise<SearchResult[]> {
    const elapsed = startTimer();
    const bm25Results = this.searchBM25(query);
    const semanticResults = await this.searchSemantic(query);
    const fused = this.fuseRRF(bm25Results, semanticResults, query);

    logger.info("SEARCH", "hybrid_search_complete", {
      duration_ms: elapsed(),
      data: {
        query,
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

      const rows = toolSearchQueries.searchBM25(ftsQuery, this.config.topK * 2);
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

  private async searchSemantic(query: string): Promise<SearchResult[]> {
    if (this.embeddings.size === 0 || !this.embeddingModel) return [];

    try {
      const queryEmb = await this.getQueryEmbedding(query);
      if (!queryEmb) return [];

      const scored: Array<{ fullName: string; sim: number }> = [];

      for (const [name, toolEmb] of this.embeddings) {
        scored.push({ fullName: name, sim: this.cosineSimilarity(queryEmb, toolEmb) });
      }

      scored.sort((a, b) => b.sim - a.sim);

      return scored.slice(0, this.config.topK * 2).map((s, i) => {
        const tool = this.toolIndex.get(s.fullName);
        return {
          fullName: s.fullName,
          server: tool?.server ?? "",
          toolName: tool?.toolName ?? "",
          description: tool?.description ?? "",
          score: s.sim,
          semanticRank: i + 1,
        };
      });
    } catch (err) {
      logger.warn("SEARCH", "semantic_search_failed", {
        error: err instanceof Error ? err : String(err),
        data: { query },
      });
      return [];
    }
  }

  private async getQueryEmbedding(query: string): Promise<Float32Array | null> {
    if (!this.embeddingModel) return null;

    const { embedding } = await embed({
      model: this.embeddingModel,
      value: query,
    });

    return new Float32Array(embedding);
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
    return this.embeddings.size > 0;
  }
}

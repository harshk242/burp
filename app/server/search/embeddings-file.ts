/**
 * Loads precomputed tool embeddings and wraps an AI SDK embedding model as a
 * QueryEmbedder for hybrid search.
 */

import { readFileSync } from "fs";
import { embed, type EmbeddingModel } from "ai";
import { logger, startTimer } from "../logger";
import type { QueryEmbedder } from "./hybrid-search";

/** Read `{ model, dimension, tools: [{ full_name, embedding }] }` into a name → vector map. */
export function loadEmbeddingsFile(filePath: string): Map<string, Float32Array> {
  const elapsed = startTimer();
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  const vectors = new Map<string, Float32Array>();

  for (const entry of raw.tools) {
    vectors.set(entry.full_name, new Float32Array(entry.embedding));
  }

  logger.info("SEARCH", "embeddings_loaded", {
    duration_ms: elapsed(),
    data: {
      model: raw.model,
      dimension: raw.dimension,
      tool_count: raw.tools.length,
    },
  });

  return vectors;
}

export function aiSdkQueryEmbedder(model: EmbeddingModel): QueryEmbedder {
  return {
    id: typeof model === "string" ? model : `${model.provider}:${model.modelId}`,
    async embedQuery(text) {
      const { embedding } = await embed({ model, value: text });
      return new Float32Array(embedding);
    },
  };
}

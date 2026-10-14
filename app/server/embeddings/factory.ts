import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany, type EmbeddingModel } from "ai";
import { logger } from "../logger";
import { withDeadline } from "./deadline";
import {
  EmbeddingResponseError,
  EmbeddingTimeoutError,
  embedderId,
  isValidVector,
  type Embedder,
  type EmbeddingProviderName,
  type EmbeddingSpec,
} from "./types";

export const DEFAULT_QUERY_TIMEOUT_MS = 2000;

type Env = Record<string, string | undefined>;
type ProviderOptions = Parameters<typeof embed>[0]["providerOptions"];

export interface EmbedderOptions {
  /** Deadline for one query embedding. */
  queryTimeoutMs?: number;
  /** Where API keys are read from. Defaults to process.env. */
  env?: Env;
  /** HTTP override, used by tests to stub provider calls. */
  fetch?: typeof globalThis.fetch;
}

interface ProviderAdapter {
  keyEnv: readonly string[];
  model(modelId: string, apiKey: string, fetch?: typeof globalThis.fetch): EmbeddingModel;
  queryOptions?: ProviderOptions;
  documentOptions?: ProviderOptions;
}

const ADAPTERS: Record<EmbeddingProviderName, ProviderAdapter> = {
  openai: {
    keyEnv: ["OPENAI_API_KEY"],
    model: (modelId, apiKey, fetch) => createOpenAI({ apiKey, fetch }).embedding(modelId),
  },
  google: {
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    model: (modelId, apiKey, fetch) => createGoogle({ apiKey, fetch }).embedding(modelId),
    queryOptions: { google: { taskType: "RETRIEVAL_QUERY" } },
    documentOptions: { google: { taskType: "RETRIEVAL_DOCUMENT" } },
  },
};

/**
 * Create the configured embedder, or null (logged once) when the provider's
 * API key is missing, so search never makes calls that are bound to fail.
 */
export function createEmbedder(spec: EmbeddingSpec, options: EmbedderOptions = {}): Embedder | null {
  const adapter = ADAPTERS[spec.provider];
  const env = options.env ?? process.env;
  const apiKey = adapter.keyEnv.map((name) => env[name]).find(Boolean);
  const id = embedderId(spec);

  if (!apiKey) {
    logger.warn("SEARCH", "embedder_unavailable", {
      data: { embedder: id, reason: "missing_api_key", key_env: adapter.keyEnv.join("|") },
    });
    return null;
  }

  const model = adapter.model(spec.model, apiKey, options.fetch);
  const queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const frozenSpec: EmbeddingSpec = Object.freeze({
    provider: spec.provider,
    model: spec.model,
    ...(spec.dimensions !== undefined && { dimensions: spec.dimensions }),
  });

  return {
    id,
    spec: frozenSpec,

    embedQuery(text, signal) {
      const timeoutError = () => new EmbeddingTimeoutError(`query embedding exceeded ${queryTimeoutMs}ms`);
      return withDeadline(queryTimeoutMs, async (abortSignal) => {
        const { embedding } = await embed({
          model,
          value: text,
          dimensions: spec.dimensions,
          providerOptions: adapter.queryOptions,
          abortSignal,
          maxRetries: 0,
        });
        return validateVectors([embedding], 1, spec.dimensions)[0];
      }, { signal, timeoutError });
    },

    async embedDocuments(texts, signal) {
      if (texts.length === 0) return [];
      const { embeddings } = await embedMany({
        model,
        values: texts,
        dimensions: spec.dimensions,
        providerOptions: adapter.documentOptions,
        abortSignal: signal,
        maxParallelCalls: 2,
      });
      return validateVectors(embeddings, texts.length, spec.dimensions);
    },
  };
}

function validateVectors(vectors: unknown[], count: number, dimensions?: number): Float32Array[] {
  if (vectors.length !== count) {
    throw new EmbeddingResponseError(`expected ${count} embeddings, got ${vectors.length}`);
  }
  const first = vectors[0];
  const expected = dimensions ?? (Array.isArray(first) ? first.length : 0);
  if (expected <= 0) throw new EmbeddingResponseError("embedding response contained an empty vector");

  return vectors.map((vector, i) => {
    if (!isValidVector(vector, expected)) {
      const length = Array.isArray(vector) ? vector.length : typeof vector;
      throw new EmbeddingResponseError(
        `embedding ${i} is invalid: expected ${expected} finite values, got length ${length}`
      );
    }
    return new Float32Array(vector);
  });
}

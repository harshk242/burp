/**
 * Provider-neutral embedding types. Kept free of runtime imports so config.ts
 * can use the provider list without pulling in the AI SDK.
 */

export const EMBEDDING_PROVIDERS = ["openai", "google"] as const;
export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

export interface EmbeddingSpec {
  provider: EmbeddingProviderName;
  model: string;
  /** Output size. Omit to use the model's native size. */
  dimensions?: number;
}

export interface Embedder {
  /** Stable identity, e.g. "openai:text-embedding-3-small@1536". Written to and checked against the index file. */
  readonly id: string;
  readonly spec: EmbeddingSpec;
  /** Embed a search query. Rejects once the configured query deadline passes; never retries. */
  embedQuery(text: string, signal?: AbortSignal): Promise<Float32Array>;
  /** Embed tool texts for the index. The SDK batches and retries transient failures. */
  embedDocuments(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

/** The part of an Embedder that query-time search needs. */
export type QueryEmbedder = Pick<Embedder, "id" | "embedQuery">;

/** The provider returned vectors of the wrong count, length, or with non-finite values. */
export class EmbeddingResponseError extends Error {
  override readonly name = "EmbeddingResponseError";
}

/** The query embedding didn't finish before its deadline. */
export class EmbeddingTimeoutError extends Error {
  override readonly name = "EmbeddingTimeoutError";
}

/** "openai:text-embedding-3-small@1536"; "@native" when no size is requested. */
export function embedderId(spec: EmbeddingSpec): string {
  return `${spec.provider}:${spec.model}@${spec.dimensions ?? "native"}`;
}

/**
 * True when `values` has exactly `dimension` entries and all stay finite as
 * float32, the type vectors are stored in (1e100 is a finite number but
 * becomes Infinity in a Float32Array).
 */
export function isValidVector(values: unknown, dimension: number): values is ArrayLike<number> {
  if (!Array.isArray(values) && !(values instanceof Float32Array)) return false;
  if (values.length !== dimension) return false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== "number" || !Number.isFinite(Math.fround(v))) return false;
  }
  return true;
}

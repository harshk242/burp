export const EMBEDDING_PROVIDERS = ["openai", "google"] as const;
export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

export interface EmbeddingSpec {
  provider: EmbeddingProviderName;
  model: string;
  dimensions?: number;
}

export interface Embedder {
  readonly id: string;
  readonly spec: EmbeddingSpec;
  embedQuery(text: string, signal?: AbortSignal): Promise<Float32Array>;
  embedDocuments(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

export type QueryEmbedder = Pick<Embedder, "id" | "embedQuery">;

export class EmbeddingResponseError extends Error {
  override readonly name = "EmbeddingResponseError";
}

export class EmbeddingTimeoutError extends Error {
  override readonly name = "EmbeddingTimeoutError";
}

export function embedderId(spec: EmbeddingSpec): string {
  return `${spec.provider}:${spec.model}@${spec.dimensions ?? "native"}`;
}

export function isValidVector(values: unknown, dimension: number): values is ArrayLike<number> {
  if (!Array.isArray(values) && !(values instanceof Float32Array)) return false;
  if (values.length !== dimension) return false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== "number" || !Number.isFinite(Math.fround(v))) return false;
  }
  return true;
}

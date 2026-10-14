import { randomUUID } from "crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { dirname } from "path";
import { logger, startTimer } from "../logger";
import { isValidVector } from "./types";

export const INDEX_FILE_VERSION = 2;

export interface ToolEmbeddingEntry {
  fullName: string;
  text: string;
  vector: Float32Array;
}

export interface ToolEmbeddingsIndex {
  embedder: string;
  dimension: number;
  generatedAt: string;
  entries: ToolEmbeddingEntry[];
}

export type IndexRejectReason =
  | "file_missing"
  | "malformed_json"
  | "version_mismatch"
  | "embedder_mismatch"
  | "dimension_mismatch"
  | "bad_vector";

export type IndexReadResult =
  | { ok: true; index: ToolEmbeddingsIndex }
  | { ok: false; reason: IndexRejectReason; detail?: Record<string, unknown> };

export function toolEmbeddingText(fullName: string, description: string): string {
  return `${fullName}: ${description}`;
}

export function toVectorMap(entries: readonly ToolEmbeddingEntry[]): Map<string, Float32Array> {
  return new Map(entries.map((e) => [e.fullName, e.vector]));
}

export async function inspectToolEmbeddings(
  path: string,
  expectedEmbedder: string,
  expectedDimension?: number
): Promise<IndexReadResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, reason: "file_missing" };
    return { ok: false, reason: "malformed_json", detail: { error: String(err) } };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed_json" };
  }
  if (!isRecord(doc) || !Array.isArray(doc.tools)) return { ok: false, reason: "malformed_json" };

  if (doc.version !== INDEX_FILE_VERSION) {
    return { ok: false, reason: "version_mismatch", detail: { found: doc.version ?? null, expected: INDEX_FILE_VERSION } };
  }
  if (doc.embedder !== expectedEmbedder) {
    return { ok: false, reason: "embedder_mismatch", detail: { found: doc.embedder ?? null, expected: expectedEmbedder } };
  }

  const dimension = doc.dimension;
  if (typeof dimension !== "number" || !Number.isInteger(dimension) || dimension <= 0) {
    return { ok: false, reason: "malformed_json", detail: { dimension: dimension ?? null } };
  }
  if (expectedDimension !== undefined && dimension !== expectedDimension) {
    return { ok: false, reason: "dimension_mismatch", detail: { found: dimension, expected: expectedDimension } };
  }

  const entries: ToolEmbeddingEntry[] = [];
  for (const [i, tool] of doc.tools.entries()) {
    if (!isRecord(tool) || typeof tool.full_name !== "string" || typeof tool.text !== "string") {
      return { ok: false, reason: "malformed_json", detail: { entry: i } };
    }
    if (!isValidVector(tool.embedding, dimension)) {
      return { ok: false, reason: "bad_vector", detail: { tool: tool.full_name, dimension } };
    }
    entries.push({ fullName: tool.full_name, text: tool.text, vector: new Float32Array(tool.embedding) });
  }

  return {
    ok: true,
    index: {
      embedder: doc.embedder,
      dimension,
      generatedAt: typeof doc.generated_at === "string" ? doc.generated_at : "",
      entries,
    },
  };
}

export function logIndexRejected(path: string, result: Extract<IndexReadResult, { ok: false }>): void {
  logger.warn("SEARCH", "embeddings_index_rejected", {
    data: { path, reason: result.reason, ...result.detail },
  });
}

export async function readToolEmbeddings(
  path: string,
  expectedEmbedder: string,
  expectedDimension?: number
): Promise<ToolEmbeddingsIndex | null> {
  const elapsed = startTimer();
  const result = await inspectToolEmbeddings(path, expectedEmbedder, expectedDimension);

  if (!result.ok) {
    logIndexRejected(path, result);
    return null;
  }

  logger.info("SEARCH", "embeddings_loaded", {
    duration_ms: elapsed(),
    data: { path, embedder: result.index.embedder, dimension: result.index.dimension, tool_count: result.index.entries.length },
  });
  return result.index;
}

export async function writeToolEmbeddings(
  path: string,
  header: { embedder: string; dimension: number },
  entries: readonly ToolEmbeddingEntry[]
): Promise<void> {
  const { embedder, dimension } = header;
  if (!Number.isInteger(dimension) || dimension <= 0) throw new Error(`invalid embedding dimension: ${dimension}`);
  for (const e of entries) {
    if (!isValidVector(e.vector, dimension)) throw new Error(`invalid vector for ${e.fullName} (expected ${dimension} finite values)`);
  }

  const doc = {
    version: INDEX_FILE_VERSION,
    embedder,
    dimension,
    generated_at: new Date().toISOString(),
    tools: entries.map((e) => ({ full_name: e.fullName, text: e.text, embedding: Array.from(e.vector) })),
  };

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(doc));
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

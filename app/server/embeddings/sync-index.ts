import {
  inspectToolEmbeddings,
  toolEmbeddingText,
  toVectorMap,
  writeToolEmbeddings,
  type IndexReadResult,
  type IndexRejectReason,
  type ToolEmbeddingEntry,
} from "./index-file";
import { withDeadline } from "./deadline";
import { EmbeddingTimeoutError, type Embedder } from "./types";

export interface SyncTool {
  fullName: string;
  server: string;
  description: string;
}

export interface SyncOptions {
  embedder: Embedder;
  tools: readonly SyncTool[];
  path: string;
  /** Deadline for the embedding call. */
  timeoutMs: number;
  /**
   * Receives the vectors for tools in the snapshot: first every stored vector
   * for them (only when new embeddings are needed; stale-text ones included,
   * since they come from the same model and beat no vector at all), then the
   * fully refreshed set once the file is written. A failed embedding call
   * leaves the first set attached. Not called when there is nothing to attach.
   */
  onReady(vectors: Map<string, Float32Array>): void;
  /** Called when an existing file is discarded for any reason but being missing. */
  onIndexRejected?(rejection: Extract<IndexReadResult, { ok: false }>): void;
}

export interface SyncStats {
  /** Why the existing file was unusable; "valid" when it was used. */
  index: IndexRejectReason | "valid";
  kept: number;
  embedded: number;
  pruned: number;
  carriedOver: number;
  wrote: boolean;
}

/** Platform of an index entry: the part of the full name before "__". */
export function platformOf(fullName: string): string {
  const i = fullName.indexOf("__");
  return i === -1 ? fullName : fullName.slice(0, i);
}

export async function syncToolEmbeddings(options: SyncOptions): Promise<SyncStats> {
  const { embedder, tools, path } = options;

  const wanted = new Map(tools.map((t) => [t.fullName, toolEmbeddingText(t.fullName, t.description)]));
  const livePlatforms = new Set(tools.map((t) => t.server));

  const existing = await inspectToolEmbeddings(path, embedder.id, embedder.spec.dimensions);
  if (!existing.ok && existing.reason !== "file_missing") options.onIndexRejected?.(existing);
  const stored = existing.ok ? existing.index.entries : [];

  const kept: ToolEmbeddingEntry[] = [];
  const stale: ToolEmbeddingEntry[] = [];
  const carried: ToolEmbeddingEntry[] = [];
  let pruned = 0;
  const seen = new Set<string>();
  for (const entry of stored) {
    if (seen.has(entry.fullName)) continue;
    seen.add(entry.fullName);
    const text = wanted.get(entry.fullName);
    if (text !== undefined) {
      if (text === entry.text) kept.push(entry);
      else stale.push(entry);
    } else if (livePlatforms.has(platformOf(entry.fullName))) {
      pruned++;
    } else {
      carried.push(entry);
    }
  }

  const keptNames = new Set(kept.map((e) => e.fullName));
  const toEmbed = [...wanted].filter(([name]) => !keptNames.has(name));
  const stats: SyncStats = {
    index: existing.ok ? "valid" : existing.reason,
    kept: kept.length,
    embedded: toEmbed.length,
    pruned,
    carriedOver: carried.length,
    wrote: false,
  };
  const duplicates = stored.length - seen.size;

  if (toEmbed.length === 0) {
    if (existing.ok && (pruned > 0 || duplicates > 0)) {
      const header = { embedder: embedder.id, dimension: existing.index.dimension };
      await writeToolEmbeddings(path, header, sortEntries([...kept, ...carried]));
      stats.wrote = true;
    }
    attach(options, kept);
    return stats;
  }

  attach(options, [...kept, ...stale]);

  const texts = toEmbed.map(([, text]) => text);
  const vectors = await withDeadline(options.timeoutMs, (signal) => embedder.embedDocuments(texts, signal), {
    timeoutError: () => new EmbeddingTimeoutError(`sync embedding exceeded ${options.timeoutMs}ms`),
  });
  const fresh = toEmbed.map(([fullName, text], i) => ({ fullName, text, vector: vectors[i] }));

  const dimension = fresh[0].vector.length;
  const entries = sortEntries([...kept, ...fresh, ...carried]);
  await writeToolEmbeddings(path, { embedder: embedder.id, dimension }, entries);
  stats.wrote = true;

  attach(options, [...kept, ...fresh]);
  return stats;
}

function attach(options: SyncOptions, entries: readonly ToolEmbeddingEntry[]): void {
  if (entries.length > 0) options.onReady(toVectorMap(entries));
}

function sortEntries(entries: ToolEmbeddingEntry[]): ToolEmbeddingEntry[] {
  return entries.sort((a, b) => (a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0));
}

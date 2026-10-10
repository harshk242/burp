/**
 * One incremental sync of the tool embeddings index against a tool snapshot:
 * keep entries whose stored text still matches, embed only new or changed
 * tools, prune removed tools of platforms that were discovered, carry over
 * platforms that weren't (their server is down), then write and attach.
 *
 * Nothing is kept or carried over from a file the current embedder didn't make.
 */

import {
  inspectToolEmbeddings,
  toolEmbeddingText,
  toVectorMap,
  writeToolEmbeddings,
  type IndexRejectReason,
  type ToolEmbeddingEntry,
} from "./index-file";
import { EmbeddingTimeoutError, type Embedder } from "./types";

/** The tool fields the sync needs; `server` is the platform. */
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
   * Receives the vectors for tools in the snapshot: first the entries still
   * valid from the file (only when new embeddings are needed), then the full
   * set once the file is written. Not called when there is nothing to attach.
   */
  onReady(vectors: Map<string, Float32Array>): void;
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

  const existing = await inspectToolEmbeddings(path, embedder.id);
  const stored = existing.ok ? existing.index.entries : [];

  const kept: ToolEmbeddingEntry[] = [];
  const carried: ToolEmbeddingEntry[] = [];
  let pruned = 0;
  const seen = new Set<string>();
  for (const entry of stored) {
    if (seen.has(entry.fullName)) continue; // a duplicate entry is dropped on the next write
    seen.add(entry.fullName);
    const text = wanted.get(entry.fullName);
    if (text !== undefined) {
      if (text === entry.text) kept.push(entry);
      // else: stale text, re-embedded below
    } else if (livePlatforms.has(platformOf(entry.fullName))) {
      pruned++; // its platform was discovered without it: removed or renamed
    } else {
      carried.push(entry); // platform absent from this snapshot: keep for when it's back
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
    // Only pruning (or deduplicating) left: rewrite without any API call.
    if (existing.ok && (pruned > 0 || duplicates > 0)) {
      const header = { embedder: embedder.id, dimension: existing.index.dimension };
      await writeToolEmbeddings(path, header, sortEntries([...kept, ...carried]));
      stats.wrote = true;
    }
    attach(options, kept);
    return stats;
  }

  // Serve the still-valid vectors while the rest are embedded.
  attach(options, kept);

  const texts = toEmbed.map(([, text]) => text);
  const vectors = await withDeadline(options.timeoutMs, (signal) => embedder.embedDocuments(texts, signal));
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

/**
 * Run `fn` with a signal that aborts after `ms`, rejecting with
 * EmbeddingTimeoutError even if the transport ignores the abort.
 */
async function withDeadline<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new EmbeddingTimeoutError(`sync embedding exceeded ${ms}ms`);
      controller.abort(err);
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

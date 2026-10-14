import { contentHash, datasetHash } from "./hash";
import { localDatasetHash, remoteContentHash } from "./plan";
import type { DatasetFile } from "./schema";

export interface FetchedItem {
  id: string;
  status?: string;
  input?: unknown;
  expectedOutput?: unknown;
  metadata?: unknown;
}

export interface DatasetCheck {
  /** Recomputed from the fetched active items. */
  datasetHash: string;
  localDatasetHash: string;
  activeIds: string[];
  /** Local items missing remotely (or archived there). */
  missing: string[];
  /** Active remote items not in the local YAML. */
  extra: string[];
  /** Items whose fetched content differs from the local YAML. */
  changed: string[];
}

export function checkDataset(local: DatasetFile, fetched: FetchedItem[]): DatasetCheck {
  const active = fetched.filter((item) => item.status !== "ARCHIVED");
  const localHashes = new Map(local.items.map((item) => [item.id, contentHash(item)]));
  const pairs = active.map((item) => ({ id: item.id, contentHash: remoteContentHash(item) }));
  const remoteIds = new Set(pairs.map((p) => p.id));
  return {
    datasetHash: datasetHash(pairs),
    localDatasetHash: localDatasetHash(local),
    activeIds: pairs.map((p) => p.id).sort(),
    missing: [...localHashes.keys()].filter((id) => !remoteIds.has(id)).sort(),
    extra: [...remoteIds].filter((id) => !localHashes.has(id)).sort(),
    changed: pairs.filter((p) => localHashes.has(p.id) && localHashes.get(p.id) !== p.contentHash).map((p) => p.id).sort(),
  };
}

export function datasetMatches(check: DatasetCheck): boolean {
  return (
    check.missing.length === 0 &&
    check.extra.length === 0 &&
    check.changed.length === 0 &&
    check.datasetHash === check.localDatasetHash
  );
}

export function driftMessage(name: string, check: DatasetCheck): string {
  const lines = [`dataset "${name}" in Langfuse does not match the local YAML:`];
  if (check.changed.length) lines.push(`  changed (content differs): ${check.changed.join(", ")}`);
  if (check.missing.length) lines.push(`  missing in Langfuse: ${check.missing.join(", ")}`);
  if (check.extra.length) lines.push(`  extra in Langfuse (not in YAML): ${check.extra.join(", ")}`);
  lines.push(`  dataset_hash: langfuse ${check.datasetHash.slice(0, 12)} vs local ${check.localDatasetHash.slice(0, 12)}`);
  lines.push("run `bun run eval:sync --apply` (or pin a past version with --dataset-version <ts>)");
  return lines.join("\n");
}

/**
 * Pure sync planner: local eval home + remote Langfuse state → actions, conflicts, warnings.
 * sync.ts fetches the remote state, prints the plan (dry run) and applies it with --apply.
 * Planning against the state left by a full apply yields no actions (idempotent).
 */
import { canonicalJson, contentHash, datasetHash } from "./hash";
import type {
  DatasetBody,
  DatasetItemBody,
  RemoteDataset,
  RemoteDatasetItem,
  RemoteScoreConfig,
  ScoreConfigBody,
} from "./langfuse-api";
import type { EvalHome, LoadedDataset } from "./load";
import type { DatasetItem, Metric } from "./schema";

export type ItemChange = "new" | "changed" | "unarchive";

export type SyncAction =
  | { kind: "create-config"; body: ScoreConfigBody }
  | { kind: "upsert-dataset"; reason: "new" | "changed"; body: DatasetBody }
  | { kind: "upsert-item"; reason: ItemChange; changed: string[]; body: DatasetItemBody }
  | { kind: "archive-item"; body: DatasetItemBody };

export interface RemoteState {
  configs: RemoteScoreConfig[];
  datasets: Map<string, { dataset: RemoteDataset | null; items: RemoteDatasetItem[] }>;
}

export interface GitInfo {
  sha: string;
  dirty: boolean;
}

export interface SyncPlan {
  actions: SyncAction[];
  /** Blocking: --apply refuses to run while any exist. */
  conflicts: string[];
  warnings: string[];
  /** Human-readable summary lines, in print order. */
  report: string[];
}

export function scoreConfigBody(m: Metric): ScoreConfigBody {
  const details = [`method: ${m.method}`, `scope: ${m.scope.join(", ")}`];
  if (m.rubric) details.push(`rubric: app/evals/${m.rubric}`);
  return {
    name: m.name,
    dataType: m.data_type,
    description: `${m.description} (${details.join("; ")})`,
    ...(m.min !== undefined ? { minValue: m.min } : {}),
    ...(m.max !== undefined ? { maxValue: m.max } : {}),
    ...(m.categories ? { categories: m.categories.map((label, value) => ({ label, value })) } : {}),
  };
}

/** The parts of a config that define what a score means. Description is not one of them. */
function definition(c: ScoreConfigBody): string {
  return canonicalJson({
    dataType: c.dataType,
    minValue: c.minValue ?? null,
    maxValue: c.maxValue ?? null,
    categories: c.dataType === "CATEGORICAL" ? (c.categories ?? []).map((x) => [x.label, x.value]) : null,
  });
}

export function itemBody(datasetName: string, item: DatasetItem): DatasetItemBody {
  const hash = contentHash(item);
  return {
    id: item.id,
    datasetName,
    input: item.input,
    expectedOutput: item.expected_output,
    metadata: { ...item.metadata, content_hash: hash },
    status: "ACTIVE",
  };
}

/** Hash recomputed from a fetched item's payload; never trusts the stored content_hash. */
export function remoteContentHash(item: RemoteDatasetItem): string {
  return contentHash({ input: item.input, expected_output: item.expectedOutput, metadata: item.metadata });
}

export function localDatasetHash(dataset: LoadedDataset["dataset"]): string {
  return datasetHash(dataset.items.map((item) => ({ id: item.id, contentHash: contentHash(item) })));
}

export function datasetBody(loaded: LoadedDataset, git: GitInfo): DatasetBody {
  const { dataset, file } = loaded;
  return {
    name: dataset.name,
    description: dataset.description,
    metadata: {
      file: `app/evals/${file}`,
      git_sha: git.sha,
      git_dirty: git.dirty,
      dataset_hash: localDatasetHash(dataset),
      item_count: dataset.items.length,
      ...(dataset.run_defaults ? { run_defaults: dataset.run_defaults } : {}),
    },
  };
}

/** Dataset metadata that must match; git_sha/git_dirty only record the last write. */
function datasetFingerprint(body: DatasetBody | RemoteDataset): string {
  const { git_sha: _sha, git_dirty: _dirty, ...rest } = (body.metadata ?? {}) as Record<string, unknown>;
  return canonicalJson({ description: body.description ?? null, metadata: rest });
}

function planConfigs(metrics: Metric[], remote: RemoteScoreConfig[], plan: SyncPlan): void {
  const byName = new Map(remote.map((c) => [c.name, c]));
  plan.report.push("score configs");
  for (const m of metrics) {
    const existing = byName.get(m.name);
    const local = scoreConfigBody(m);
    if (m.status !== "active") {
      if (existing && m.status === "retired" && !existing.isArchived) {
        plan.warnings.push(`metric ${m.name} is retired but its Langfuse config is not archived (archive it in the UI)`);
      }
      plan.report.push(`  . ${m.name} (${m.status}; not synced)`);
      continue;
    }
    if (!existing) {
      plan.actions.push({ kind: "create-config", body: local });
      plan.report.push(`  + ${m.name} (${m.data_type})`);
      continue;
    }
    if (definition(existing) !== definition(local)) {
      plan.conflicts.push(
        `score config ${m.name} exists with a different definition (remote ${definition(existing)} vs local ` +
          `${definition(local)}). Changed definitions need a new metric name; configs are never edited.`,
      );
      plan.report.push(`  ! ${m.name} (definition differs)`);
      continue;
    }
    if (existing.isArchived) plan.warnings.push(`score config ${m.name} is archived in Langfuse but active locally`);
    if ((existing.description ?? "") !== local.description) {
      plan.warnings.push(`score config ${m.name}: description differs from metrics.yaml (informational; not edited)`);
    }
    plan.report.push(`  = ${m.name}`);
  }
}

function changedParts(local: DatasetItemBody, remote: RemoteDatasetItem): string[] {
  const parts: string[] = [];
  if (canonicalJson(local.input) !== canonicalJson(remote.input)) parts.push("input");
  if (canonicalJson(local.expectedOutput) !== canonicalJson(remote.expectedOutput ?? null)) parts.push("expected_output");
  if (canonicalJson(local.metadata) !== canonicalJson(remote.metadata ?? null)) parts.push("metadata");
  return parts;
}

function planDataset(loaded: LoadedDataset, remote: RemoteState, git: GitInfo, plan: SyncPlan): void {
  const { dataset, file } = loaded;
  const state = remote.datasets.get(dataset.name) ?? { dataset: null, items: [] };
  const body = datasetBody(loaded, git);
  const counts = { new: 0, changed: 0, unarchive: 0, archived: 0, same: 0 };
  const lines: string[] = [];

  const remoteById = new Map(state.items.map((i) => [i.id, i]));
  const localIds = new Set<string>();
  for (const item of dataset.items) {
    localIds.add(item.id);
    const local = itemBody(dataset.name, item);
    const existing = remoteById.get(item.id);
    if (!existing) {
      counts.new++;
      plan.actions.push({ kind: "upsert-item", reason: "new", changed: [], body: local });
      lines.push(`    + ${item.id}`);
      continue;
    }
    const changed = changedParts(local, existing);
    if (existing.status === "ARCHIVED") {
      counts.unarchive++;
      plan.actions.push({ kind: "upsert-item", reason: "unarchive", changed, body: local });
      lines.push(`    ^ ${item.id} (archived remotely; restoring${changed.length ? `; ${changed.join(", ")} changed` : ""})`);
    } else if (changed.length) {
      counts.changed++;
      plan.actions.push({ kind: "upsert-item", reason: "changed", changed, body: local });
      lines.push(`    ~ ${item.id} (${changed.join(", ")} changed)`);
    } else {
      counts.same++;
    }
  }
  for (const item of state.items) {
    if (localIds.has(item.id) || item.status === "ARCHIVED") continue;
    counts.archived++;
    plan.actions.push({ kind: "archive-item", body: { ...item, metadata: item.metadata ?? null, status: "ARCHIVED" } });
    lines.push(`    - ${item.id} (removed from YAML; archiving)`);
  }

  let datasetLine = "";
  if (!state.dataset) {
    plan.actions.push({ kind: "upsert-dataset", reason: "new", body });
    datasetLine = "new dataset";
  } else if (datasetFingerprint(state.dataset) !== datasetFingerprint(body)) {
    plan.actions.push({ kind: "upsert-dataset", reason: "changed", body });
    datasetLine = "dataset metadata updated";
  }
  const summary =
    `+${counts.new} new, ~${counts.changed} changed, ^${counts.unarchive} restored, ` +
    `-${counts.archived} archived, =${counts.same} unchanged`;
  plan.report.push(`  ${dataset.name} (${file}): ${datasetLine ? `${datasetLine}; ` : ""}${summary}`, ...lines);
}

export function planSync(home: EvalHome, remote: RemoteState, git: GitInfo): SyncPlan {
  const plan: SyncPlan = { actions: [], conflicts: [], warnings: [], report: [] };
  planConfigs(home.metrics, remote.configs, plan);
  plan.report.push("datasets");
  for (const loaded of home.datasets) planDataset(loaded, remote, git, plan);
  return plan;
}

/**
 * Apply order: configs, new datasets (items need their dataset), items, archives, and
 * dataset metadata updates last so dataset_hash only changes once the items are written.
 */
export function orderActions(actions: SyncAction[]): SyncAction[] {
  const rank = (a: SyncAction): number => {
    if (a.kind === "create-config") return 0;
    if (a.kind === "upsert-dataset") return a.reason === "new" ? 1 : 4;
    return a.kind === "upsert-item" ? 2 : 3;
  };
  return actions.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map((x) => x.a);
}

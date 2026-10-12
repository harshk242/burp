/**
 * One Langfuse experiment over the verified dataset items: the item task,
 * the code evaluators (each score referencing its config) and the run
 * evaluator (aggregates). Imports server modules (via task.ts): load only
 * after run.ts set up the environment.
 */
import type { ExperimentItemResult, FetchedDataset, LangfuseClient } from "@langfuse/client";
import { scoreConfigId } from "../../server/observability/score-configs";
import { evaluateItem } from "../evaluators";
import type { TaskOutput } from "../evaluators/types";
import type { DatasetItem } from "./schema";
import { runEvaluations, summarizeRun, type ItemRun, type RunSummary } from "./aggregate";
import { countsTowardScores } from "./schema";
import { createItemTask, type TaskContext } from "./task";

export type FetchedItem = FetchedDataset["items"][number];

export interface ExperimentSpec {
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  /** Verified active items to run (already filtered by --items). */
  items: FetchedItem[];
  /** Local YAML items by id (identical content, verified). */
  localItems: Map<string, DatasetItem>;
  datasetVersion: string;
  concurrency: number;
  task: TaskContext;
}

export interface ExperimentOutcome {
  name: string;
  runName: string;
  datasetRunUrl?: string;
  itemRuns: ItemRun[];
  /** Items whose task threw (e.g. the run was stopped); the SDK skips them. */
  missing: string[];
  summary: RunSummary;
}

function toItemRun(result: ExperimentItemResult, localItems: Map<string, DatasetItem>): ItemRun {
  const output = result.output as TaskOutput;
  const local = localItems.get(output.item_id);
  return {
    itemId: output.item_id,
    reviewed: local ? countsTowardScores(local) : false,
    output,
    evaluations: result.evaluations.map((e) => ({ name: e.name, value: e.value as number | string })),
  };
}

export async function runExperiment(client: LangfuseClient, spec: ExperimentSpec): Promise<ExperimentOutcome> {
  let summary: RunSummary | null = null;
  // `experiment.run` with the fetched items rather than `dataset.runExperiment`, which
  // would run every fetched item, archived ones included, and can't take a subset.
  // Items keep their datasetId/id, so each run item links to its dataset item.
  const result = await client.experiment.run({
    name: spec.name,
    description: spec.description,
    metadata: spec.metadata,
    data: spec.items,
    datasetVersion: spec.datasetVersion,
    maxConcurrency: spec.concurrency,
    task: createItemTask(spec.task),
    evaluators: [
      async ({ output }) => {
        const out = output as TaskOutput;
        const local = spec.localItems.get(out.item_id);
        if (!local) throw new Error(`no local item ${out.item_id}`);
        return evaluateItem(out, local).map((e) => ({ ...e, configId: scoreConfigId(e.name) }));
      },
    ],
    runEvaluators: [
      async ({ itemResults }) => {
        summary = summarizeRun(itemResults.map((r) => toItemRun(r, spec.localItems)));
        return runEvaluations(summary);
      },
    ],
  });
  const itemRuns = result.itemResults.map((r) => toItemRun(r, spec.localItems));
  const done = new Set(itemRuns.map((r) => r.itemId));
  return {
    name: spec.name,
    runName: result.runName,
    datasetRunUrl: result.datasetRunUrl,
    itemRuns,
    missing: spec.items.map((i) => i.id).filter((id) => !done.has(id)),
    summary: summary ?? summarizeRun(itemRuns),
  };
}

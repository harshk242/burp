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
  items: FetchedItem[];
  evalItems: Map<string, DatasetItem>;
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

function evalItem(evalItems: Map<string, DatasetItem>, id: string): DatasetItem {
  const item = evalItems.get(id);
  if (!item) throw new Error(`no pinned item ${id}`);
  return item;
}

function toItemRun(result: ExperimentItemResult, evalItems: Map<string, DatasetItem>): ItemRun {
  const output = result.output as TaskOutput;
  return {
    itemId: output.item_id,
    reviewed: countsTowardScores(evalItem(evalItems, output.item_id)),
    output,
    evaluations: result.evaluations.map((e) => ({ name: e.name, value: e.value as number | string })),
  };
}

export async function runExperiment(client: LangfuseClient, spec: ExperimentSpec): Promise<ExperimentOutcome> {
  let summary: RunSummary | null = null;
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
        return evaluateItem(out, evalItem(spec.evalItems, out.item_id)).map((e) => ({ ...e, configId: scoreConfigId(e.name) }));
      },
    ],
    runEvaluators: [
      async ({ itemResults }) => {
        summary = summarizeRun(itemResults.map((r) => toItemRun(r, spec.evalItems)));
        return runEvaluations(summary);
      },
    ],
  });
  const itemRuns = result.itemResults.map((r) => toItemRun(r, spec.evalItems));
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

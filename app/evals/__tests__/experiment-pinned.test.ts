/**
 * runExperiment scores and gates pass/fail from the pinned (fetched) Langfuse
 * items, not the local YAML: a --dataset-version run must reproduce the
 * expectations and review status of that version.
 */
import { describe, expect, it } from "bun:test";
import type { LangfuseClient } from "@langfuse/client";
import type { TaskOutput } from "../evaluators/types";
import { runExperiment, type ExperimentSpec, type FetchedItem } from "../lib/experiment";
import { pinnedEvalItems, PinnedItemError } from "../lib/pinned-items";
import { loadEvalHome } from "../lib/load";
import { itemBody } from "../lib/plan";
import type { DatasetItem } from "../lib/schema";
import type { TaskContext } from "../lib/task";

const item = (checkpoint: string, reviewedBy: string | null, id = "pinned-item"): DatasetItem => ({
  id,
  input: { turns: ["Which accession?"] },
  expected_output: { checkpoints: [{ turn: 1, any_of: [[checkpoint]], min_hits: 1 }], reference_answer: null },
  metadata: { category: "lookup", turns: "single", difficulty: "easy", volatile: false, source: "hand-written", reviewed_by: reviewedBy, notes: "" },
});

/** As the sync wrote it to Langfuse (metadata carries content_hash). */
const fetched = (i: DatasetItem): FetchedItem => {
  const { id, input, expectedOutput, metadata } = itemBody("smoke", i);
  return { id, input, expectedOutput, metadata, status: "ACTIVE" } as unknown as FetchedItem;
};

const output = (itemId: string, answer: string): TaskOutput => ({
  item_id: itemId,
  session_id: "s",
  turns: [{ turn: 1, user_message: "q", answer, status: "completed", error_code: null, final_finish_reason: "stop", tool_error_count: 0, tool_calls: [], cost_usd: 0, llm_calls: 1, duration_ms: 1, trace_id: null }],
});

/** Mimics experiment.run: the canned answer per item, then item and run evaluators. */
function fakeClient(answer: string): LangfuseClient {
  return {
    experiment: {
      run: async (params: any) => {
        const itemResults = [];
        for (const data of params.data) {
          const out = output(data.id, answer);
          const evaluations = [];
          for (const evaluate of params.evaluators) {
            evaluations.push(...[await evaluate({ input: data.input, output: out, expectedOutput: data.expectedOutput, metadata: data.metadata })].flat());
          }
          itemResults.push({ item: data, input: data.input, expectedOutput: data.expectedOutput, output: out, evaluations });
        }
        for (const evaluate of params.runEvaluators) await evaluate({ itemResults });
        return { runName: "run", itemResults, runEvaluations: [] };
      },
    },
  } as unknown as LangfuseClient;
}

/** `local` stands in for the current YAML: the runner no longer passes it, so it must not matter. */
function spec(items: FetchedItem[], _local: DatasetItem[]): ExperimentSpec {
  return {
    name: "t",
    description: "t",
    metadata: {},
    items,
    evalItems: pinnedEvalItems(items),
    datasetVersion: "2026-01-01T00:00:00Z",
    concurrency: 1,
    task: {} as TaskContext,
  };
}

const recall = (o: Awaited<ReturnType<typeof runExperiment>>, id: string) =>
  o.itemRuns.find((r) => r.itemId === id)?.evaluations.find((e) => e.name === "checkpoint_recall")?.value;

describe("experiment scoring source", () => {
  it("uses the pinned item's expected output and review status, not the current YAML", async () => {
    const historical = item("P38398", null);
    const current = item("Q00000", "reviewer");
    const outcome = await runExperiment(fakeClient("The accession is P38398."), spec([fetched(historical)], [current]));
    expect(recall(outcome, "pinned-item")).toBe(1);
    expect(outcome.itemRuns[0]!.reviewed).toBe(false);
    expect(outcome.summary.reviewedItems).toBe(0);
  });

  it("scores pinned items that were removed from the local YAML", async () => {
    const removed = item("P38398", "reviewer", "removed-item");
    const outcome = await runExperiment(fakeClient("P38398"), spec([fetched(removed)], []));
    expect(recall(outcome, "removed-item")).toBe(1);
    expect(outcome.itemRuns[0]!.reviewed).toBe(true);
  });

  it("rejects a pinned payload the evaluators cannot use instead of falling back to YAML", () => {
    const bad = { ...fetched(item("P38398", null)), expectedOutput: { checkpoints: "P38398" } } as FetchedItem;
    expect(() => pinnedEvalItems([bad])).toThrow(PinnedItemError);
    expect(() => pinnedEvalItems([bad])).toThrow(/pinned-item: expected_output\.checkpoints/);
  });

  it("parses every local item back unchanged from its synced payload", () => {
    for (const { dataset } of loadEvalHome().datasets) {
      const parsed = pinnedEvalItems(dataset.items.map(fetched));
      for (const i of dataset.items) expect(parsed.get(i.id)).toEqual(i);
    }
  });
});

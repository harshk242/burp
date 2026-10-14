import { describe, expect, it } from "bun:test";
import { contentHash } from "../lib/hash";
import { itemBody } from "../lib/plan";
import { loadEvalHome } from "../lib/load";
import { ArgsError, parseRunArgs, USAGE } from "../lib/args";
import { checkDataset, datasetMatches, driftMessage, type FetchedItem } from "../lib/verify-dataset";
import { experimentName } from "../lib/run-meta";
import { assertSearchReady, RunAbort } from "../lib/search-check";
import { itemPasses, percentile, runEvaluations, summarizeRun, varianceReport, type ItemRun } from "../lib/aggregate";
import { buildTaskOutput, outputText } from "../lib/task-output";
import type { TaskOutput, TaskTurn } from "../evaluators/types";

describe("args", () => {
  it("parses flags with defaults left to the dataset", () => {
    expect(parseRunArgs(["--dataset", "smoke", "--items=a,b", "--repeat", "2", "--max-cost-usd", "1.5", "--name", "effort-high"])).toEqual({
      dataset: "smoke",
      items: ["a", "b"],
      repeat: 2,
      concurrency: null,
      maxCostUsd: 1.5,
      note: "effort-high",
      datasetVersion: null,
      matrix: null,
      arms: [],
    });
    expect(parseRunArgs(["--help"])).toBeNull();
    expect(parseRunArgs(["--dataset", "smoke", "--dataset-version", "2026-10-12T10:00:00Z"])!.datasetVersion).toBe("2026-10-12T10:00:00.000Z");
  });

  it("rejects bad input", () => {
    expect(() => parseRunArgs([])).toThrow(ArgsError);
    expect(() => parseRunArgs(["--dataset", "smoke", "--repeat", "0"])).toThrow("positive integer");
    expect(() => parseRunArgs(["--dataset", "smoke", "--max-cost-usd", "-1"])).toThrow("positive number");
    expect(() => parseRunArgs(["--dataset", "smoke", "--bogus"])).toThrow("unknown argument");
    expect(() => parseRunArgs(["--dataset", "smoke", "--name", "a b"])).toThrow();
  });

  it("--max-cost-usd help states the overshoot", () => {
    expect(USAGE).toContain("about one model call per concurrent item");
  });
});

describe("dataset verification", () => {
  const smoke = loadEvalHome().datasets.find((d) => d.dataset.name === "smoke")!.dataset;
  const synced = (): FetchedItem[] => smoke.items.map((i) => itemBody(smoke.name, i));

  it("a synced dataset matches; archived remote items are ignored", () => {
    const items = synced();
    items.push({ ...items[0]!, id: "retired-item", status: "ARCHIVED" });
    const check = checkDataset(smoke, items);
    expect(datasetMatches(check)).toBe(true);
    expect(check.datasetHash).toBe(check.localDatasetHash);
  });

  it("a UI edit is caught even though the stored content_hash is unchanged", () => {
    const items = synced();
    const edited = items[1]!;
    edited.input = { turns: ["edited in the UI"] };
    const check = checkDataset(smoke, items);
    expect(datasetMatches(check)).toBe(false);
    expect(check.changed).toEqual([edited.id]);
    expect((edited.metadata as { content_hash: string }).content_hash).toBe(contentHash(smoke.items[1]!));
  });

  it("extra and missing items are listed by id", () => {
    const items = synced();
    const dropped = items.pop()!;
    items.push({ ...items[0]!, id: "only-in-langfuse" });
    const check = checkDataset(smoke, items);
    expect(check.missing).toEqual([dropped.id]);
    expect(check.extra).toEqual(["only-in-langfuse"]);
    const message = driftMessage("smoke", check);
    expect(message).toContain(`missing in Langfuse: ${dropped.id}`);
    expect(message).toContain("extra in Langfuse (not in YAML): only-in-langfuse");
    expect(message).toContain("run `bun run eval:sync --apply`");
  });

  it("an unsynced local change is a changed item", () => {
    const local = structuredClone(smoke);
    local.items[0]!.metadata.notes = "edited locally, not synced";
    const check = checkDataset(local, synced());
    expect(check.changed).toEqual([local.items[0]!.id]);
    expect(datasetMatches(check)).toBe(false);
  });
});

describe("experiment name", () => {
  it("<dataset>-<sha>-<model>-<effort>[-armNote][-note][-rN]", () => {
    const base = { dataset: "smoke", gitSha: "cdb76d5", model: "claude-sonnet-5-5", effort: "medium", note: null, repeatIndex: 1, repeatCount: 1 };
    expect(experimentName(base)).toBe("smoke-cdb76d5-claude-sonnet-5-5-medium");
    expect(experimentName({ ...base, note: "probe", repeatIndex: 2, repeatCount: 2 })).toBe("smoke-cdb76d5-claude-sonnet-5-5-medium-probe-r2");
    expect(experimentName({ ...base, armNote: "out32k", note: "probe" })).toBe("smoke-cdb76d5-claude-sonnet-5-5-medium-out32k-probe");
  });
});

describe("search precondition", () => {
  const report = { toolsAvailable: 40, toolsTotal: 40, searchIndexed: true, embeddingsLoaded: true, embedder: "openai:text-embedding-3-small" };
  const hits = async () => [{ fullName: "clinvar__get_variant_info" }];

  it("passes with an indexed search and a probe hit, recording the search fields", async () => {
    expect((await assertSearchReady(report, hits)).search).toEqual({ tools_available: 40, search_mode: "hybrid", embedder: "openai:text-embedding-3-small" });
    expect((await assertSearchReady({ ...report, embeddingsLoaded: false }, hits)).search.search_mode).toBe("keyword");
  });

  it("aborts when search isn't indexed or the probe finds nothing", async () => {
    await expect(assertSearchReady({ ...report, searchIndexed: false }, hits)).rejects.toThrow(RunAbort);
    await expect(assertSearchReady(report, async () => [])).rejects.toThrow("probe search");
    await expect(assertSearchReady({ ...report, toolsAvailable: 0 }, hits)).rejects.toThrow("no MCP tools");
  });
});

const turn = (over: Partial<TaskTurn> = {}): TaskTurn => ({
  turn: 1,
  user_message: "q",
  answer: "a",
  status: "ok",
  error_code: null,
  final_finish_reason: "stop",
  tool_error_count: 0,
  tool_calls: [],
  cost_usd: 0.01,
  llm_calls: 1,
  duration_ms: 1000,
  trace_id: null,
  ...over,
});
const run = (itemId: string, evals: [string, number | string][], over: Partial<TaskOutput> = {}, reviewed = false, turns = [turn()]): ItemRun => ({
  itemId,
  reviewed,
  output: { item_id: itemId, session_id: "s", turns, ...over },
  evaluations: evals.map(([name, value]) => ({ name, value })),
});

describe("aggregates", () => {
  it("nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });

  it("means, cost, latency, failures; budget-skipped items only count toward cost; pass/fail over reviewed items", () => {
    const items = [
      run("a", [["turn_outcome", "ok"], ["id_grounding", 1], ["checkpoint_recall", 1]], {}, true),
      run("b", [["turn_outcome", "provider_error"], ["id_grounding", 0.5]], {}, true, [turn({ duration_ms: 3000, cost_usd: 0.02 })]),
      run("c", [["turn_outcome", "ok"], ["checkpoint_recall", 0]]),
      run("d", [], { skipped: "budget" }, true, [turn({ cost_usd: 0.5 })]),
    ];
    const s = summarizeRun(items);
    expect(s).toMatchObject({ items: 4, scoredItems: 3, skippedBudget: ["d"], failedItems: ["b"], reviewedItems: 2, reviewedPassed: 1 });
    expect(s.means).toEqual({ id_grounding: 0.75, checkpoint_recall: 0.5 });
    expect(s.okRate).toBeCloseTo(2 / 3);
    expect(s.totalCostUsd).toBeCloseTo(0.54);
    expect([s.latencyP50Ms, s.latencyP95Ms]).toEqual([1000, 3000]);
    expect(itemPasses(items[2]!)).toBe(false);

    const byName = Object.fromEntries(runEvaluations(s).map((e) => [e.name, e.value]));
    expect(byName).toMatchObject({ avg_id_grounding: 0.75, ok_rate: 2 / 3, failed_items: 1, skipped_budget_items: 1, reviewed_pass_rate: 0.5 });
  });

  it("variance per item and score across repeats", () => {
    const r1 = [run("a", [["checkpoint_recall", 1], ["turn_outcome", "ok"]])];
    const r2 = [run("a", [["checkpoint_recall", 0], ["turn_outcome", "refusal"]])];
    const report = varianceReport([r1, r2]);
    expect(report.a!.checkpoint_recall).toEqual({ n: 2, mean: 0.5, min: 0, max: 1, stddev: 0.5 });
    expect(report.a!.turn_outcome_ok!.mean).toBe(0.5);
    expect(report.a!.cost_usd!.n).toBe(2);
  });
});

describe("task output from persisted rows", () => {
  const msg = (content: unknown) => JSON.stringify(content);
  const rows = {
    itemId: "item-1",
    sessionId: "s1",
    turns: [
      { id: "t1", user_message_id: "u1", assistant_message_id: "a1", status: "ok", error_code: null, final_finish_reason: "stop", tool_error_count: 1, trace_id: "tr" },
      { id: "t2", user_message_id: "u2", assistant_message_id: null, status: "error", error_code: "provider_error", final_finish_reason: null, tool_error_count: 0, trace_id: "tr" },
    ],
    messages: new Map<string, string | null>([["u1", "first"], ["a1", "answer one"], ["u2", "second"]]),
    transcript: [
      { turn_id: "t1", role: "user", content_json: msg({ role: "user", content: "first" }) },
      { turn_id: "t1", role: "assistant", content_json: msg({ role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "open_targets__search_entities", input: { q: "x" } }, { type: "tool-call", toolCallId: "c2", toolName: "chembl__search_drugs", input: {} }] }) },
      { turn_id: "t1", role: "tool", content_json: msg({ role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "open_targets__search_entities", output: { type: "text", value: "[fetched_at: x]\nENSG00000141510" } }, { type: "tool-result", toolCallId: "c2", toolName: "chembl__search_drugs", output: { type: "error-text", value: "boom" } }] }) },
    ],
    usage: [{ turn_id: "t1", cost_microusd: 12_000, llm_calls: 2 }, { turn_id: "t2", cost_microusd: 3_000, llm_calls: 1 }],
    durationsMs: [1500.4, 200],
    toolName: (n: string) => n.replace("open_targets", "open-targets"),
  };

  it("joins tool calls with what the model saw; failed turns have no answer", () => {
    const out = buildTaskOutput(rows);
    expect(out.item_id).toBe("item-1");
    expect(out.skipped).toBeUndefined();
    const [t1, t2] = out.turns;
    expect(t1).toMatchObject({ turn: 1, user_message: "first", answer: "answer one", cost_usd: 0.012, llm_calls: 2, duration_ms: 1500, tool_error_count: 1 });
    expect(t1!.tool_calls).toEqual([
      { name: "open-targets__search_entities", input: { q: "x" }, model_output: "[fetched_at: x]\nENSG00000141510", error: false },
      { name: "chembl__search_drugs", input: {}, model_output: "boom", error: true },
    ]);
    expect(t2).toMatchObject({ answer: null, status: "error", error_code: "provider_error", tool_calls: [] });
  });

  it("a budget-stopped turn marks the item skipped", () => {
    const stopped = { ...rows, turns: [{ ...rows.turns[1]!, error_code: "budget_exceeded" }] };
    expect(buildTaskOutput(stopped).skipped).toBe("budget");
  });

  it("tool results of every output type become text", () => {
    expect(outputText({ type: "json", value: { a: 1 } })).toBe('{"a":1}');
    expect(outputText({ type: "content", value: [{ type: "text", text: "hit" }] })).toBe("hit");
  });
});

/**
 * Comparison report (plan 2.4) from saved run results: per-arm aggregates,
 * "within noise" from the repeat spread, per-item disagreements, skipped arms,
 * and determinism. Fixture: 2 items × 2 repeats for a complete arm, a
 * budget-cut arm and an arm the budget never reached.
 */
import { describe, expect, it } from "bun:test";
import type { ItemRun } from "../lib/aggregate";
import { buildComparison, saveItemRun, type SavedComparison } from "../lib/compare";
import { comparisonMarkdown } from "../lib/compare-render";
import fixture from "./fixtures/comparison-runs.json";

const saved = fixture as SavedComparison;
const [sonnet, haiku, opus] = ["claude-sonnet-5-5-low", "claude-haiku-5-5-low", "claude-opus-5-5-low"];

describe("comparison report", () => {
  const report = buildComparison(saved);
  const arm = (label: string) => report.arms.find((a) => a.label === label)!;

  it("per arm: score spread across repeats, outcomes, truncation, cost, tier, latency, calls", () => {
    expect(report.baseline).toBe(sonnet);
    expect(arm(sonnet)).toEqual({
      label: sonnet,
      model: "claude-sonnet-5-5",
      effort: "low",
      max_output_tokens: 64000,
      status: "complete",
      repeats_run: 2,
      item_runs: 4,
      scored_item_runs: 4,
      skipped_budget_item_runs: 0,
      scores: {
        answer_truncated: { n: 2, mean: 0, min: 0, max: 0, stddev: 0 },
        checkpoint_recall: { n: 2, mean: 0.75, min: 0.5, max: 1, stddev: 0.25 },
        id_grounding: { n: 2, mean: 0.75, min: 0.75, max: 0.75, stddev: 0 },
        ok_rate: { n: 2, mean: 0.75, min: 0.5, max: 1, stddev: 0.25 },
      },
      turn_outcome: { error: 1, ok: 3 },
      answer_truncated_rate: 0,
      cost: { total_usd: 0.07, per_item_usd: 0.0175 },
      pricing_tier: { llm_calls: 13, long_context_calls: 0, long_context_call_share: 0, items_with_long_context: 0 },
      latency_ms: { p50: 1200, p95: 5000 },
      mean_llm_calls_per_item: 3.25,
      mean_tool_calls_per_item: 2.25,
      reviewed: { items: 2, passed: 1 },
    });
    // Budget-skipped item runs: listed and paid for, never scored.
    expect(arm(haiku)).toMatchObject({
      status: "partial_budget",
      item_runs: 4,
      scored_item_runs: 3,
      skipped_budget_item_runs: 1,
      answer_truncated_rate: 0.333333,
      cost: { total_usd: 0.0045, per_item_usd: 0.001125 },
      pricing_tier: { llm_calls: 8, long_context_calls: 2, long_context_call_share: 0.25, items_with_long_context: 2 },
    });
  });

  it("an arm the budget never reached is shown as skipped", () => {
    expect(arm(opus)).toMatchObject({ status: "skipped_budget", repeats_run: 0, item_runs: 0, scores: {}, cost: { total_usd: 0, per_item_usd: null } });
    expect(report.deltas.some((d) => d.arm === opus)).toBe(false);
    expect(comparisonMarkdown(report)).toMatch(/\| claude-opus-5-5-low \| skipped_budget \| 0 \|/);
  });

  it("a difference within the wider repeat range is within noise", () => {
    expect(report.deltas.map((d) => [d.score, d.delta, d.noise, d.verdict])).toEqual([
      ["answer_truncated", 0.25, 0.5, "within_noise"],
      ["checkpoint_recall", 0.25, 0.5, "within_noise"],
      ["id_grounding", 0.25, 0, "differs"],
      ["ok_rate", 0.25, 0.5, "within_noise"],
    ]);
    expect(report.deltas.every((d) => d.arm === haiku)).toBe(true);
  });

  it("without repeats there is no spread to call noise", () => {
    const single = structuredClone(saved);
    for (const a of single.arms) a.experiments = a.experiments.slice(0, 1);
    expect(new Set(buildComparison(single).deltas.map((d) => d.verdict))).toEqual(new Set(["no_repeat_spread"]));
  });

  it("lists per-item disagreements between the arms that ran", () => {
    expect(report.disagreements).toEqual([
      { item: "x", field: "pass_rate", values: { [sonnet]: 0.5, [haiku]: 1 } },
      { item: "x", field: "checkpoint_recall", values: { [sonnet]: 0.75, [haiku]: 1 } },
      { item: "y", field: "turn_outcome", values: { [sonnet]: "error|ok", [haiku]: "ok" } },
      { item: "y", field: "pass_rate", values: { [sonnet]: 0, [haiku]: 1 } },
      { item: "y", field: "id_grounding", values: { [sonnet]: 0.5, [haiku]: 1 } },
    ]);
  });

  it("is deterministic: same saved results → same report, whatever the item order", () => {
    const shuffled = structuredClone(saved);
    for (const a of shuffled.arms) for (const e of a.experiments) e.items.reverse();
    expect(JSON.stringify(buildComparison(shuffled))).toBe(JSON.stringify(report));
    expect(comparisonMarkdown(buildComparison(structuredClone(saved)))).toBe(comparisonMarkdown(report));
  });

  it("markdown marks within-noise deltas and carries the budget", () => {
    const md = comparisonMarkdown(report);
    expect(md).toContain("Budget: spent $0.0745 of $0.1000 (shared by all arms). Baseline: claude-sonnet-5-5-low.");
    expect(md).toContain("| 0.250 ± 0.250 [0.000–0.500] (Δ +0.250, within noise) |");
    expect(md).toContain("| 1.000 ± 0.000 [1.000–1.000] (Δ +0.250) |");
  });
});

describe("saved item runs", () => {
  it("sums the item's turns and keeps its scores", () => {
    const turn = { user_message: "q", answer: "a", status: "ok", error_code: null, final_finish_reason: "stop", tool_error_count: 0, trace_id: null };
    const item: ItemRun = {
      itemId: "x",
      reviewed: true,
      output: {
        item_id: "x",
        session_id: "s",
        turns: [
          { ...turn, turn: 1, tool_calls: [{ name: "a", input: {}, model_output: "", error: false }], cost_usd: 0.01, llm_calls: 2, long_context_calls: 1, duration_ms: 1000 },
          { ...turn, turn: 2, tool_calls: [], cost_usd: 0.02, llm_calls: 1, duration_ms: 500 },
        ],
      },
      evaluations: [{ name: "turn_outcome", value: "ok" }, { name: "id_grounding", value: 1 }],
    };
    expect(saveItemRun(item)).toEqual({
      item_id: "x",
      reviewed: true,
      skipped: false,
      scores: { id_grounding: 1, turn_outcome: "ok" },
      cost_usd: 0.03,
      latency_ms: 1500,
      llm_calls: 3,
      tool_calls: 1,
      long_context_calls: 1,
    });
  });
});

/**
 * Comparison report of a matrix run (plan 2.4). Built only from the saved run
 * results (`SavedComparison`, written next to the report), so it can be
 * rebuilt and is deterministic: arms keep their run order, items and score
 * names are sorted, numbers are rounded.
 *
 * Per arm: mean per score across repeats (± min/max/stddev), turn_outcome
 * breakdown, answer_truncated rate, total and per-item cost, long-context
 * pricing tier hits, p50/p95 item latency, mean LLM and tool calls per item.
 * Each arm's score means are compared with the first (baseline) arm; a
 * difference no larger than the repeat spread (the wider min–max range of the
 * two arms' per-repeat means) is "within noise". Per-item disagreements list
 * items whose outcome, pass rate or code scores differ between arms.
 */
import type { ItemRun } from "./aggregate";
import { itemPasses, percentile, spread, type Spread } from "./aggregate";
import type { ArmStatus } from "./matrix";

export interface SavedItemRun {
  item_id: string;
  reviewed: boolean;
  /** Stopped by the shared budget: listed, never scored. */
  skipped: boolean;
  scores: Record<string, number | string>;
  cost_usd: number;
  latency_ms: number;
  llm_calls: number;
  tool_calls: number;
  long_context_calls: number;
}

export interface SavedExperiment {
  name: string;
  run_name: string;
  url: string | null;
  repeat_index: number;
  items: SavedItemRun[];
}

export interface SavedArm {
  label: string;
  provider: string;
  model: string;
  effort: string;
  max_output_tokens: number;
  max_context_tokens: number;
  status: ArmStatus;
  estimate_usd: number | null;
  experiments: SavedExperiment[];
}

export interface SavedComparison {
  comparison_group: string;
  run_id: string;
  dataset: string;
  dataset_version: string;
  git_sha: string;
  repeat: number;
  max_cost_usd: number;
  spent_usd: number;
  arms: SavedArm[];
}

export interface ArmReport {
  label: string;
  model: string;
  effort: string;
  max_output_tokens: number;
  status: ArmStatus;
  repeats_run: number;
  item_runs: number;
  scored_item_runs: number;
  skipped_budget_item_runs: number;
  /** Per score: spread of the per-repeat means (ok_rate included). */
  scores: Record<string, Spread>;
  turn_outcome: Record<string, number>;
  answer_truncated_rate: number | null;
  cost: { total_usd: number; per_item_usd: number | null };
  pricing_tier: { llm_calls: number; long_context_calls: number; long_context_call_share: number | null; items_with_long_context: number };
  latency_ms: { p50: number | null; p95: number | null };
  mean_llm_calls_per_item: number | null;
  mean_tool_calls_per_item: number | null;
  reviewed: { items: number; passed: number };
}

export type DeltaVerdict = "within_noise" | "differs" | "no_repeat_spread";

export interface ScoreDelta {
  arm: string;
  score: string;
  baseline_mean: number;
  arm_mean: number;
  delta: number;
  /** The wider min–max range of the two arms' per-repeat means; null without repeats. */
  noise: number | null;
  verdict: DeltaVerdict;
}

export interface Disagreement {
  item: string;
  field: string;
  /** By arm label; "skipped" where the arm has no scored run of the item. */
  values: Record<string, number | string>;
}

export interface ComparisonReport {
  comparison_group: string;
  run_id: string;
  dataset: string;
  dataset_version: string;
  git_sha: string;
  repeat: number;
  max_cost_usd: number;
  spent_usd: number;
  baseline: string | null;
  arms: ArmReport[];
  deltas: ScoreDelta[];
  disagreements: Disagreement[];
}

/** Item fields compared between arms. */
const DISAGREEMENT_SCORES = ["id_grounding", "checkpoint_recall", "expected_tool_coverage"];

const round = (v: number, digits = 6) => Number(v.toFixed(digits));
const roundSpread = (s: Spread): Spread => ({ n: s.n, mean: round(s.mean), min: round(s.min), max: round(s.max), stddev: round(s.stddev) });
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const sortedRecord = <V>(entries: [string, V][]): Record<string, V> => Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));

/** The saved form of one item run (what the report is built from). */
export function saveItemRun(item: ItemRun): SavedItemRun {
  const turns = item.output.turns;
  const sum = (pick: (t: (typeof turns)[number]) => number) => turns.reduce((s, t) => s + pick(t), 0);
  return {
    item_id: item.itemId,
    reviewed: item.reviewed,
    skipped: item.output.skipped === "budget",
    scores: sortedRecord(item.evaluations.map((e) => [e.name, e.value])),
    cost_usd: round(sum((t) => t.cost_usd)),
    latency_ms: Math.round(sum((t) => t.duration_ms)),
    llm_calls: sum((t) => t.llm_calls),
    tool_calls: sum((t) => t.tool_calls.length),
    long_context_calls: sum((t) => t.long_context_calls ?? 0),
  };
}

const passes = (item: SavedItemRun) => itemPasses({ evaluations: Object.entries(item.scores).map(([name, value]) => ({ name, value })) });

function armReport(arm: SavedArm): ArmReport {
  const runs = arm.experiments.flatMap((e) => e.items);
  const scored = runs.filter((i) => !i.skipped);
  // Per repeat: the mean of each numeric score over its scored items, plus ok_rate.
  const perRepeat = new Map<string, number[]>();
  for (const exp of arm.experiments) {
    const items = exp.items.filter((i) => !i.skipped);
    const names = new Set(items.flatMap((i) => Object.keys(i.scores).filter((k) => typeof i.scores[k] === "number")));
    const means: [string, number | null][] = [...names].map((n) => [n, mean(items.flatMap((i) => (typeof i.scores[n] === "number" ? [i.scores[n] as number] : [])))]);
    const outcomes = items.map((i) => i.scores.turn_outcome).filter((v) => v !== undefined);
    if (outcomes.length) means.push(["ok_rate", outcomes.filter((v) => v === "ok").length / outcomes.length]);
    for (const [name, value] of means) if (value !== null) perRepeat.set(name, [...(perRepeat.get(name) ?? []), value]);
  }
  const outcomes = new Map<string, number>();
  for (const item of scored) {
    const v = item.scores.turn_outcome;
    if (v !== undefined) outcomes.set(String(v), (outcomes.get(String(v)) ?? 0) + 1);
  }
  const truncated = scored.flatMap((i) => (typeof i.scores.answer_truncated === "number" ? [i.scores.answer_truncated] : []));
  const total = runs.reduce((s, i) => s + i.cost_usd, 0);
  const llmCalls = runs.reduce((s, i) => s + i.llm_calls, 0);
  const longContext = runs.reduce((s, i) => s + i.long_context_calls, 0);
  const latencies = scored.map((i) => i.latency_ms);
  const reviewed = scored.filter((i) => i.reviewed);
  const nullable = (v: number | null) => (v === null ? null : round(v));
  return {
    label: arm.label,
    model: arm.model,
    effort: arm.effort,
    max_output_tokens: arm.max_output_tokens,
    status: arm.status,
    repeats_run: arm.experiments.length,
    item_runs: runs.length,
    scored_item_runs: scored.length,
    skipped_budget_item_runs: runs.length - scored.length,
    scores: sortedRecord([...perRepeat].map(([name, values]) => [name, roundSpread(spread(values))])),
    turn_outcome: sortedRecord([...outcomes]),
    answer_truncated_rate: nullable(mean(truncated)),
    cost: { total_usd: round(total), per_item_usd: runs.length ? round(total / runs.length) : null },
    pricing_tier: {
      llm_calls: llmCalls,
      long_context_calls: longContext,
      long_context_call_share: llmCalls ? round(longContext / llmCalls) : null,
      items_with_long_context: runs.filter((i) => i.long_context_calls > 0).length,
    },
    latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    mean_llm_calls_per_item: nullable(mean(scored.map((i) => i.llm_calls))),
    mean_tool_calls_per_item: nullable(mean(scored.map((i) => i.tool_calls))),
    reviewed: { items: reviewed.length, passed: reviewed.filter(passes).length },
  };
}

function deltas(arms: ArmReport[]): ScoreDelta[] {
  const [base, ...rest] = arms.filter((a) => a.repeats_run > 0);
  if (!base) return [];
  const out: ScoreDelta[] = [];
  for (const arm of rest) {
    for (const score of Object.keys(arm.scores).filter((s) => s in base.scores).sort()) {
      const a = arm.scores[score]!;
      const b = base.scores[score]!;
      const delta = round(a.mean - b.mean);
      const noise = a.n > 1 && b.n > 1 ? round(Math.max(a.max - a.min, b.max - b.min)) : null;
      const verdict: DeltaVerdict = noise === null ? "no_repeat_spread" : Math.abs(delta) <= noise ? "within_noise" : "differs";
      out.push({ arm: arm.label, score, baseline_mean: b.mean, arm_mean: a.mean, delta, noise, verdict });
    }
  }
  return out;
}

/** Most frequent value; ties joined with "|" (sorted). */
function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return [...counts].filter(([, n]) => n === top).map(([v]) => v).sort().join("|");
}

function disagreements(arms: SavedArm[]): Disagreement[] {
  const ran = arms.filter((a) => a.experiments.length > 0);
  if (ran.length < 2) return [];
  const itemIds = [...new Set(ran.flatMap((a) => a.experiments.flatMap((e) => e.items.map((i) => i.item_id))))].sort();
  const out: Disagreement[] = [];
  for (const item of itemIds) {
    const runsByArm = ran.map((a) => [a.label, a.experiments.flatMap((e) => e.items.filter((i) => i.item_id === item && !i.skipped))] as const);
    const fields: [string, (runs: SavedItemRun[]) => number | string | null][] = [
      ["turn_outcome", (runs) => {
        const v = runs.flatMap((r) => (r.scores.turn_outcome === undefined ? [] : [String(r.scores.turn_outcome)]));
        return v.length ? mode(v) : null;
      }],
      ["pass_rate", (runs) => round(runs.filter(passes).length / runs.length, 3)],
      ...DISAGREEMENT_SCORES.map((name): [string, (runs: SavedItemRun[]) => number | null] => [name, (runs) => {
        const m = mean(runs.flatMap((r) => (typeof r.scores[name] === "number" ? [r.scores[name] as number] : [])));
        return m === null ? null : round(m, 3);
      }]),
    ];
    for (const [field, value] of fields) {
      const values: Record<string, number | string> = {};
      const distinct = new Set<string>();
      for (const [label, runs] of runsByArm) {
        const v = runs.length ? value(runs) : "skipped";
        if (v === null) continue;
        values[label] = v;
        if (v !== "skipped") distinct.add(JSON.stringify(v));
      }
      if (distinct.size > 1) out.push({ item, field, values });
    }
  }
  return out;
}

export function buildComparison(saved: SavedComparison): ComparisonReport {
  const arms = saved.arms.map(armReport);
  return {
    comparison_group: saved.comparison_group,
    run_id: saved.run_id,
    dataset: saved.dataset,
    dataset_version: saved.dataset_version,
    git_sha: saved.git_sha,
    repeat: saved.repeat,
    max_cost_usd: saved.max_cost_usd,
    spent_usd: round(saved.spent_usd),
    baseline: arms.find((a) => a.repeats_run > 0)?.label ?? null,
    arms,
    deltas: deltas(arms),
    disagreements: disagreements(saved.arms),
  };
}

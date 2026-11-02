import type { ItemRun } from "./aggregate";
import { itemPasses, percentile, spread, type Spread } from "./aggregate";
import type { ArmStatus } from "./matrix";

export interface SavedItemRun {
  item_id: string;
  reviewed: boolean;
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
  missing?: string[];
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
  coverage: { items: number; scored_every_repeat: number };
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

export type DeltaVerdict = "within_noise" | "differs" | "no_repeat_spread" | "no_shared_items";

export interface ScoreDelta {
  arm: string;
  score: string;
  shared_items: number;
  repeats_compared: { baseline: number; arm: number };
  baseline_mean: number | null;
  arm_mean: number | null;
  delta: number | null;
  noise: number | null;
  verdict: DeltaVerdict;
}

export interface Disagreement {
  item: string;
  field: string;
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
  items: number;
  arms: ArmReport[];
  deltas: ScoreDelta[];
  disagreements: Disagreement[];
}

const DISAGREEMENT_SCORES = ["id_grounding", "checkpoint_recall", "expected_tool_coverage"];

const round = (v: number, digits = 6) => Number(v.toFixed(digits));
const roundSpread = (s: Spread): Spread => ({ n: s.n, mean: round(s.mean), min: round(s.min), max: round(s.max), stddev: round(s.stddev) });
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const sortedRecord = <V>(entries: [string, V][]): Record<string, V> => Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));

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

const runItemIds = (arms: SavedArm[]) =>
  new Set(arms.flatMap((a) => a.experiments.flatMap((e) => [...e.items.map((i) => i.item_id), ...(e.missing ?? [])])));

const scoredIds = (exp: SavedExperiment) => new Set(exp.items.filter((i) => !i.skipped).map((i) => i.item_id));

function scoredInAll(experiments: SavedExperiment[]): Set<string> {
  const [first, ...rest] = experiments.map(scoredIds);
  if (!first) return new Set();
  return new Set([...first].filter((id) => rest.every((s) => s.has(id))));
}

function comparableRepeats(arm: SavedArm, items: Set<string>): SavedExperiment[] {
  const full = arm.experiments.filter((e) => scoredIds(e).size === items.size && !e.missing?.length);
  return full.length ? full : arm.experiments;
}

function perRepeatMeans(experiments: SavedExperiment[], keep?: Set<string>): Map<string, number[]> {
  const perRepeat = new Map<string, number[]>();
  for (const exp of experiments) {
    const items = exp.items.filter((i) => !i.skipped && (!keep || keep.has(i.item_id)));
    const names = new Set(items.flatMap((i) => Object.keys(i.scores).filter((k) => typeof i.scores[k] === "number")));
    const means: [string, number | null][] = [...names].map((n) => [n, mean(items.flatMap((i) => (typeof i.scores[n] === "number" ? [i.scores[n] as number] : [])))]);
    const outcomes = items.map((i) => i.scores.turn_outcome).filter((v) => v !== undefined);
    if (outcomes.length) means.push(["ok_rate", outcomes.filter((v) => v === "ok").length / outcomes.length]);
    for (const [name, value] of means) if (value !== null) perRepeat.set(name, [...(perRepeat.get(name) ?? []), value]);
  }
  return perRepeat;
}

function armReport(arm: SavedArm, items: Set<string>): ArmReport {
  const runs = arm.experiments.flatMap((e) => e.items);
  const scored = runs.filter((i) => !i.skipped);
  const perRepeat = perRepeatMeans(arm.experiments);
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
    coverage: { items: items.size, scored_every_repeat: scoredInAll(arm.experiments).size },
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

function deltas(arms: SavedArm[], items: Set<string>): ScoreDelta[] {
  const [base, ...rest] = arms.filter((a) => a.experiments.length > 0);
  if (!base) return [];
  const baseRepeats = comparableRepeats(base, items);
  const baseCovered = scoredInAll(baseRepeats);
  const out: ScoreDelta[] = [];
  for (const arm of rest) {
    const armRepeats = comparableRepeats(arm, items);
    const shared = new Set([...scoredInAll(armRepeats)].filter((id) => baseCovered.has(id)));
    if (!shared.size) {
      const baseNames = perRepeatMeans(base.experiments);
      const names = [...perRepeatMeans(arm.experiments).keys()].filter((n) => baseNames.has(n)).sort();
      const repeats_compared = { baseline: baseRepeats.length, arm: armRepeats.length };
      for (const score of names) out.push({ arm: arm.label, score, shared_items: 0, repeats_compared, baseline_mean: null, arm_mean: null, delta: null, noise: null, verdict: "no_shared_items" });
      continue;
    }
    const baseMeans = perRepeatMeans(baseRepeats, shared);
    const armMeans = perRepeatMeans(armRepeats, shared);
    for (const score of [...armMeans.keys()].filter((s) => baseMeans.has(s)).sort()) {
      const a = spread(armMeans.get(score)!);
      const b = spread(baseMeans.get(score)!);
      const delta = round(a.mean - b.mean);
      const noise = a.n > 1 && b.n > 1 ? round(Math.max(a.max - a.min, b.max - b.min)) : null;
      const verdict: DeltaVerdict = noise === null ? "no_repeat_spread" : Math.abs(delta) <= noise ? "within_noise" : "differs";
      out.push({ arm: arm.label, score, shared_items: shared.size, repeats_compared: { baseline: baseRepeats.length, arm: armRepeats.length }, baseline_mean: round(b.mean), arm_mean: round(a.mean), delta, noise, verdict });
    }
  }
  return out;
}

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
  const items = runItemIds(saved.arms);
  const arms = saved.arms.map((a) => armReport(a, items));
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
    items: items.size,
    arms,
    deltas: deltas(saved.arms, items),
    disagreements: disagreements(saved.arms),
  };
}

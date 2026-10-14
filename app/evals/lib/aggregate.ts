import type { Evaluation, TaskOutput } from "../evaluators/types";

export interface ItemRun {
  itemId: string;
  reviewed: boolean;
  output: TaskOutput;
  evaluations: Pick<Evaluation, "name" | "value">[];
}

export interface RunSummary {
  items: number;
  scoredItems: number;
  skippedBudget: string[];
  failedItems: string[];
  totalCostUsd: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  means: Record<string, number>;
  okRate: number | null;
  reviewedItems: number;
  reviewedPassed: number;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

const itemCost = (o: TaskOutput) => o.turns.reduce((sum, t) => sum + t.cost_usd, 0);
const itemLatency = (o: TaskOutput) => o.turns.reduce((sum, t) => sum + t.duration_ms, 0);
const scoreOf = (item: Pick<ItemRun, "evaluations">, name: string) => item.evaluations.find((e) => e.name === name)?.value;

export function itemPasses(item: Pick<ItemRun, "evaluations">): boolean {
  if (scoreOf(item, "turn_outcome") !== "ok") return false;
  for (const name of ["id_grounding", "checkpoint_recall", "expected_tool_coverage"]) {
    const value = scoreOf(item, name);
    if (value !== undefined && value !== 1) return false;
  }
  return true;
}

export function summarizeRun(items: ItemRun[]): RunSummary {
  const scored = items.filter((i) => !i.output.skipped);
  const values = new Map<string, number[]>();
  for (const item of scored) {
    for (const e of item.evaluations) {
      if (typeof e.value !== "number") continue;
      values.set(e.name, [...(values.get(e.name) ?? []), e.value]);
    }
  }
  const means = Object.fromEntries([...values].map(([name, v]) => [name, v.reduce((a, b) => a + b, 0) / v.length]));
  const outcomes = scored.map((i) => scoreOf(i, "turn_outcome")).filter((v) => v !== undefined);
  const latencies = scored.map((i) => itemLatency(i.output));
  const reviewed = scored.filter((i) => i.reviewed);
  return {
    items: items.length,
    scoredItems: scored.length,
    skippedBudget: items.filter((i) => i.output.skipped).map((i) => i.itemId),
    failedItems: scored.filter((i) => scoreOf(i, "turn_outcome") !== "ok").map((i) => i.itemId),
    totalCostUsd: items.reduce((sum, i) => sum + itemCost(i.output), 0),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    means,
    okRate: outcomes.length ? outcomes.filter((v) => v === "ok").length / outcomes.length : null,
    reviewedItems: reviewed.length,
    reviewedPassed: reviewed.filter(itemPasses).length,
  };
}

export function runEvaluations(s: RunSummary): Evaluation[] {
  const out: Evaluation[] = Object.entries(s.means).map(([name, value]) => ({
    name: `avg_${name}`,
    value,
    dataType: "NUMERIC",
  }));
  const num = (name: string, value: number | null, comment?: string) => {
    if (value !== null) out.push({ name, value, dataType: "NUMERIC", ...(comment ? { comment } : {}) });
  };
  num("ok_rate", s.okRate);
  num("total_cost_usd", Number(s.totalCostUsd.toFixed(6)));
  num("latency_p50_ms", s.latencyP50Ms);
  num("latency_p95_ms", s.latencyP95Ms);
  num("failed_items", s.failedItems.length, s.failedItems.join(", ") || undefined);
  num("skipped_budget_items", s.skippedBudget.length, s.skippedBudget.join(", ") || undefined);
  num("reviewed_items", s.reviewedItems, "items with reviewed_by set; only these count toward pass/fail");
  if (s.reviewedItems > 0) num("reviewed_pass_rate", s.reviewedPassed / s.reviewedItems);
  return out;
}

export interface Spread {
  n: number;
  mean: number;
  min: number;
  max: number;
  stddev: number;
}

export function spread(values: number[]): Spread {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return { n, mean, min: Math.min(...values), max: Math.max(...values), stddev: Math.sqrt(variance) };
}

export function varianceReport(runs: ItemRun[][]): Record<string, Record<string, Spread>> {
  const collected = new Map<string, Map<string, number[]>>();
  const add = (item: string, name: string, value: number) => {
    const scores = collected.get(item) ?? new Map<string, number[]>();
    scores.set(name, [...(scores.get(name) ?? []), value]);
    collected.set(item, scores);
  };
  for (const run of runs) {
    for (const item of run) {
      if (item.output.skipped) continue;
      for (const e of item.evaluations) {
        if (typeof e.value === "number") add(item.itemId, e.name, e.value);
        else if (e.name === "turn_outcome") add(item.itemId, "turn_outcome_ok", e.value === "ok" ? 1 : 0);
      }
      add(item.itemId, "cost_usd", itemCost(item.output));
      add(item.itemId, "latency_ms", itemLatency(item.output));
    }
  }
  const report: Record<string, Record<string, Spread>> = {};
  for (const [item, scores] of [...collected].sort(([a], [b]) => a.localeCompare(b))) {
    report[item] = Object.fromEntries([...scores].map(([name, v]) => [name, spread(v)]));
  }
  return report;
}

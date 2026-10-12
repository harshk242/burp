/** Console output of the runner: per-item scores, run aggregates, variance across repeats. */
import type { ExperimentOutcome } from "./experiment";
import type { Spread } from "./aggregate";

const fmt = (v: number | string | undefined, digits = 2): string =>
  v === undefined ? "-" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(digits)) : v;

export function printOutcome(o: ExperimentOutcome, log: (line: string) => void): void {
  const rows = o.itemRuns.map((item) => {
    const score = (name: string) => item.evaluations.find((e) => e.name === name)?.value;
    const cost = item.output.turns.reduce((s, t) => s + t.cost_usd, 0);
    const ms = item.output.turns.reduce((s, t) => s + t.duration_ms, 0);
    return {
      item: item.itemId,
      reviewed: item.reviewed ? "yes" : "no",
      outcome: item.output.skipped ? "skipped_budget" : fmt(score("turn_outcome")),
      id_grounding: fmt(score("id_grounding")),
      checkpoints: fmt(score("checkpoint_recall")),
      tools: fmt(score("expected_tool_coverage")),
      truncated: fmt(score("answer_truncated")),
      tool_errors: fmt(score("tool_error_count")),
      cost_usd: cost.toFixed(4),
      seconds: (ms / 1000).toFixed(1),
    };
  });
  console.table(rows);
  const s = o.summary;
  const means = Object.entries(s.means).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(", ");
  log(`${o.runName}: ${s.scoredItems}/${s.items} scored, ok_rate ${fmt(s.okRate ?? undefined, 3)}, failed ${s.failedItems.length}${s.failedItems.length ? ` (${s.failedItems.join(", ")})` : ""}`);
  log(`  means: ${means || "-"}`);
  log(`  cost $${s.totalCostUsd.toFixed(4)}, latency p50 ${fmt(s.latencyP50Ms ?? undefined)} ms, p95 ${fmt(s.latencyP95Ms ?? undefined)} ms`);
  log(`  pass/fail: ${s.reviewedItems ? `${s.reviewedPassed}/${s.reviewedItems} reviewed item(s) pass` : "no reviewed items (unreviewed items run but don't count)"}`);
  if (s.skippedBudget.length) log(`  skipped_budget: ${s.skippedBudget.join(", ")}`);
  if (o.missing.length) log(`  not completed (task failed or run stopped): ${o.missing.join(", ")}`);
  if (o.datasetRunUrl) log(`  ${o.datasetRunUrl}`);
}

export function printVariance(report: Record<string, Record<string, Spread>>, log: (line: string) => void): void {
  log("\nvariance across repeats (mean / min / max / stddev):");
  const rows = Object.entries(report).flatMap(([item, scores]) =>
    Object.entries(scores).map(([score, s]) => ({
      item,
      score,
      n: s.n,
      mean: s.mean.toFixed(3),
      min: s.min.toFixed(3),
      max: s.max.toFixed(3),
      stddev: s.stddev.toFixed(3),
    })),
  );
  console.table(rows);
}

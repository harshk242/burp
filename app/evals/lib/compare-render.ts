/** The comparison report as markdown (`<comparison_group>.md`) and as console tables. */
import type { ArmReport, ComparisonReport, ScoreDelta } from "./compare";

const num = (v: number | null | undefined, digits = 3) => (v === null || v === undefined ? "-" : Number.isInteger(v) ? String(v) : v.toFixed(digits));
const usd = (v: number | null) => (v === null ? "-" : `$${v.toFixed(4)}`);

const f3 = (v: number) => v.toFixed(3);
const coverage = (a: ArmReport) => `${a.coverage.scored_every_repeat}/${a.coverage.items}`;

/** `mean ± stddev [min–max]` with repeats, else the mean; labelled with the coverage when the arm missed items. */
function scoreCell(arm: ArmReport, score: string): string {
  const s = arm.scores[score];
  if (!s) return "-";
  const cell = s.n > 1 ? `${f3(s.mean)} ± ${f3(s.stddev)} [${f3(s.min)}–${f3(s.max)}]` : f3(s.mean);
  return arm.coverage.scored_every_repeat < arm.coverage.items ? `${cell} {${coverage(arm)} items}` : cell;
}

/** The delta against the baseline: on the shared items, or withheld without any. */
function deltaNote(d: ScoreDelta, items: number): string {
  if (d.delta === null) return " (Δ withheld: no shared items)";
  const verdict = d.verdict === "within_noise" ? ", within noise" : d.verdict === "no_repeat_spread" ? `, no repeat spread (repeats ${d.repeats_compared.baseline} vs ${d.repeats_compared.arm})` : "";
  const shared = d.shared_items < items ? ` on ${d.shared_items}/${items} shared items` : "";
  return ` (Δ ${d.delta >= 0 ? "+" : ""}${f3(d.delta)}${shared}${verdict})`;
}

const scoreNames = (r: ComparisonReport) => [...new Set(r.arms.flatMap((a) => Object.keys(a.scores)))].sort();

/** One row per arm: status, cost, latency, calls. */
export function armRows(r: ComparisonReport): Record<string, string>[] {
  return r.arms.map((a) => ({
    arm: a.label,
    status: a.status,
    repeats: String(a.repeats_run),
    "items scored (every repeat)": coverage(a),
    "items (scored/skipped)": `${a.scored_item_runs}/${a.skipped_budget_item_runs}`,
    turn_outcome: Object.entries(a.turn_outcome).map(([k, v]) => `${k} ${v}`).join(", ") || "-",
    truncated: num(a.answer_truncated_rate),
    cost: usd(a.cost.total_usd),
    "per item": usd(a.cost.per_item_usd),
    "long-ctx calls": `${a.pricing_tier.long_context_calls}/${a.pricing_tier.llm_calls}`,
    "p50/p95 s": `${num(a.latency_ms.p50 === null ? null : a.latency_ms.p50 / 1000, 1)}/${num(a.latency_ms.p95 === null ? null : a.latency_ms.p95 / 1000, 1)}`,
    "llm/tool calls": `${num(a.mean_llm_calls_per_item, 1)}/${num(a.mean_tool_calls_per_item, 1)}`,
  }));
}

/** One row per arm, one column per score (vs baseline: Δ and verdict). */
export function scoreRows(r: ComparisonReport): Record<string, string>[] {
  return r.arms.map((a) => {
    const row: Record<string, string> = { arm: a.label };
    for (const score of scoreNames(r)) {
      const d = r.deltas.find((x) => x.arm === a.label && x.score === score);
      row[score] = scoreCell(a, score) + (d ? deltaNote(d, r.items) : "");
    }
    return row;
  });
}

function table(rows: Record<string, string>[]): string[] {
  if (!rows.length) return ["(none)"];
  const cols = Object.keys(rows[0]!);
  const esc = (v: string) => v.replace(/\|/g, "\\|");
  return [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${cols.map((c) => esc(row[c] ?? "")).join(" | ")} |`)];
}

export function comparisonMarkdown(r: ComparisonReport): string {
  const lines = [
    `# Comparison ${r.comparison_group}`,
    "",
    `Dataset \`${r.dataset}\` @ ${r.dataset_version}, commit ${r.git_sha}, run ${r.run_id}; ${r.repeat} repeat(s) per arm.`,
    `Budget: spent ${usd(r.spent_usd)} of ${usd(r.max_cost_usd)} (shared by all arms). Baseline: ${r.baseline ?? "-"}.`,
    "",
    "## Arms",
    "",
    ...table(armRows(r)),
    "",
    "## Scores",
    "",
    "Mean of the per-repeat means (± stddev [min–max] with repeats) over the items each arm scored; `{k/N items}` marks an arm that did not score every item in every repeat, so its mean is not comparable as is.",
    "Δ is against the baseline, computed only on the items both arms scored (in each arm's repeats that ran every item, or all its repeats if none did); it is withheld when they share no scored item. A Δ no larger than the wider repeat range of the two arms on those items is within noise.",
    "",
    ...table(scoreRows(r)),
    "",
    "## Per-item disagreements",
    "",
    ...table(
      r.disagreements.map((d) => ({
        item: d.item,
        field: d.field,
        ...Object.fromEntries(r.arms.map((a) => [a.label, d.values[a.label] === undefined ? "-" : String(d.values[a.label])])),
      })),
    ),
    "",
  ];
  return lines.join("\n");
}

export function printComparison(r: ComparisonReport, log: (line: string) => void): void {
  log(`\ncomparison ${r.comparison_group} (baseline ${r.baseline ?? "-"}):`);
  console.table(armRows(r));
  console.table(scoreRows(r));
  log(r.disagreements.length ? `${r.disagreements.length} per-item disagreement(s) between arms (see the .md report)` : "no per-item disagreements between arms");
}

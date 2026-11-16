import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVALS_DIR, EvalLoadError, loadEvalHome } from "../lib/load";
import { isEligibleForPassFail } from "../lib/schema";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function homeWith(file: string, edit: (text: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), "evals-"));
  tempDirs.push(dir);
  for (const sub of ["datasets", "rubrics"]) cpSync(join(EVALS_DIR, sub), join(dir, sub), { recursive: true });
  cpSync(join(EVALS_DIR, "metrics.yaml"), join(dir, "metrics.yaml"));
  const path = join(dir, file);
  writeFileSync(path, edit(readFileSync(path, "utf8")));
  return dir;
}

function problemsOf(dir: string): string[] {
  try {
    loadEvalHome(dir);
  } catch (err) {
    if (err instanceof EvalLoadError) return err.problems;
    throw err;
  }
  throw new Error("expected EvalLoadError");
}

function lineOf(dir: string, file: string, needle: string): number {
  return readFileSync(join(dir, file), "utf8").split("\n").findIndex((l) => l.includes(needle)) + 1;
}

describe("eval home", () => {
  const home = loadEvalHome();

  it("loads smoke and deep with the expected items", () => {
    const byName = Object.fromEntries(home.datasets.map((d) => [d.dataset.name, d]));
    expect(byName.smoke?.file).toBe("datasets/smoke-v0.yaml");
    expect(byName.smoke?.dataset.items.length).toBe(7);
    expect(byName.deep?.dataset.items.map((i) => i.id)).toEqual([
      "ts-01-cardiovascular",
      "ts-02-psoriasis",
      "ts-03-crohns",
      "ts-04-il17a-vs-il23a",
      "ts-05-audit-crohns",
    ]);
  });

  it("has unique item ids across all datasets", () => {
    const ids = home.datasets.flatMap((d) => d.dataset.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references only rubric files that exist", () => {
    const rubrics = home.metrics.flatMap((m) => (m.rubric ? [m.rubric] : []));
    expect(rubrics.sort()).toEqual(["rubrics/checkpoint-recall.md", "rubrics/id-grounding.md"]);
    for (const r of rubrics) expect(existsSync(join(EVALS_DIR, r))).toBe(true);
  });

  it("has unique metric names", () => {
    const names = home.metrics.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps all AI-drafted items out of pass/fail until reviewed", () => {
    const items = home.datasets.flatMap((d) => d.dataset.items);
    expect(items.filter(isEligibleForPassFail)).toEqual([]);
  });

  it("starts every deep turn 1 with the shared instructions; 05 has no preamble on turn 2", () => {
    const deep = home.datasets.find((d) => d.dataset.name === "deep")!.dataset;
    const preamble = "You are supporting a drug-discovery team's target-selection review.";
    for (const item of deep.items) expect(item.input.turns[0]!.startsWith(preamble)).toBe(true);
    const audit = deep.items.find((i) => i.id === "ts-05-audit-crohns")!;
    expect(audit.input.turns.length).toBe(2);
    expect(audit.input.turns[1]!.startsWith("Audit your previous target-selection recommendation.")).toBe(true);
  });
});

describe("loader errors", () => {
  const SMOKE = "datasets/smoke-v0.yaml";

  it("reports YAML syntax errors with file:line:col", () => {
    const dir = homeWith(SMOKE, (t) => t.replace("  - id: brca1-uniprot-lookup", "  - id: [unclosed"));
    const [problem] = problemsOf(dir);
    expect(problem).toMatch(/^datasets\/smoke-v0\.yaml:\d+:\d+: YAML /);
  });

  it("maps schema issues to the offending line", () => {
    const dir = homeWith(SMOKE, (t) => t.replace("difficulty: medium", "difficulty: brutal"));
    const line = lineOf(dir, SMOKE, "difficulty: brutal");
    const problems = problemsOf(dir);
    expect(problems.length).toBe(1);
    expect(problems[0]).toStartWith(`${SMOKE}:${line}:`);
    expect(problems[0]).toContain("items.1.metadata.difficulty");
  });

  it("reports a missing field at its parent", () => {
    const dir = homeWith(SMOKE, (t) => t.replace(/\n {6}volatile: true/, ""));
    const problems = problemsOf(dir);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("items.3.metadata.volatile");
    expect(problems[0]).toMatch(/smoke-v0\.yaml:\d+:\d+/);
  });

  it("rejects unknown keys (typos never pass silently)", () => {
    const dir = homeWith(SMOKE, (t) => t.replace("      reviewed_by: null", "      reviewd_by: null"));
    expect(problemsOf(dir).join("\n")).toContain("Unrecognized key(s) in object: 'reviewd_by'");
  });

  it("checks turns metadata and checkpoint turns against input", () => {
    const dir = homeWith(SMOKE, (t) => t.replace("- turn: 2\n", "- turn: 3\n").replace("turns: multi", "turns: single"));
    const text = problemsOf(dir).join("\n");
    expect(text).toContain('metadata.turns must be "multi"');
    expect(text).toContain("checkpoint turn 3 exceeds");
  });

  it("rejects duplicate item ids across datasets", () => {
    const dir = homeWith("datasets/deep-v0.yaml", (t) => t.replace("id: ts-02-psoriasis", "id: brca1-uniprot-lookup"));
    const line = lineOf(dir, SMOKE, "id: brca1-uniprot-lookup");
    expect(problemsOf(dir)).toEqual([
      `${SMOKE}:${line}:9: duplicate item id "brca1-uniprot-lookup" (also in datasets/deep-v0.yaml (deep))`,
    ]);
  });

  it("rejects missing rubric files", () => {
    const dir = homeWith("metrics.yaml", (t) => t.replace("rubrics/checkpoint-recall.md", "rubrics/nope.md"));
    const line = lineOf(dir, "metrics.yaml", "rubrics/nope.md");
    expect(problemsOf(dir)).toEqual([`metrics.yaml:${line}:11: rubric file not found: rubrics/nope.md`]);
  });

  it("rejects inconsistent metric definitions", () => {
    const dir = homeWith("metrics.yaml", (t) =>
      t.replace("data_type: BOOLEAN\n  scope: [online", "data_type: BOOLEAN\n  min: 0\n  scope: [online"),
    );
    expect(problemsOf(dir).join("\n")).toMatch(/metrics\.yaml:\d+:\d+: 1\.min: only NUMERIC metrics take min\/max/);
  });
});

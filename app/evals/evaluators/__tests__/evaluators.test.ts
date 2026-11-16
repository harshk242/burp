import { describe, expect, it } from "bun:test";
import tp53 from "./fixtures/tp53-uniprot.json";
import { checkpointRecall, aliasHits } from "../checkpoint-recall";
import { extractIds, idGrounding } from "../id-grounding";
import { evaluateItem } from "../index";
import { globMatches, toolCoverage } from "../tool-coverage";
import { turnSignalScores } from "../turn-signals";
import type { EvalItem, Evaluation, TaskOutput, TaskTurn } from "../types";

const base = tp53 as TaskOutput;
const realTurn = base.turns[0]!;

const item = (expected: Partial<EvalItem["expected_output"]> = {}): EvalItem => ({
  input: { turns: base.turns.map((t) => t.user_message) },
  expected_output: { checkpoints: [], reference_answer: null, ...expected },
  metadata: {
    category: "lookup",
    turns: "single",
    difficulty: "easy",
    volatile: false,
    source: "hand-written",
    reviewed_by: null,
    notes: "",
  },
});

const turn = (over: Partial<TaskTurn>): TaskTurn => ({ ...realTurn, tool_calls: [], ...over });
const output = (turns: TaskTurn[], over: Partial<TaskOutput> = {}): TaskOutput => ({
  item_id: "i",
  session_id: "s",
  turns: turns.map((t, i) => ({ ...t, turn: i + 1 })),
  ...over,
});
const single = (e: Evaluation | Evaluation[] | null): Evaluation => {
  if (!e || Array.isArray(e)) throw new Error(`expected one evaluation, got ${JSON.stringify(e)}`);
  return e;
};

describe("id_grounding", () => {
  it("real turn: every cited id appears in the turn's tool outputs", () => {
    expect(extractIds(realTurn.answer!).map((x) => x.id)).toEqual(["ENSG00000141510", "P04637"]);
    expect(single(idGrounding(base, item()))).toMatchObject({ name: "id_grounding", value: 1, dataType: "NUMERIC" });
  });

  it("an id no tool output contains is ungrounded and named in the comment", () => {
    const out = output([{ ...realTurn, answer: `${realTurn.answer} See also NCT04123456.` }]);
    const e = single(idGrounding(out, item()));
    expect(e.value).toBeCloseTo(2 / 3);
    expect(e.comment).toBe("ungrounded: turn 1: NCT04123456");
  });

  it("future-evidence leakage: an id invented in turn 1 and retrieved in turn 2 stays ungrounded for turn 1", () => {
    const out = output([
      turn({ user_message: "Name a ChEMBL id for TP53 inhibitors.", answer: "Try CHEMBL4297. ", tool_calls: [] }),
      turn({
        user_message: "Check it.",
        answer: "CHEMBL4297 is confirmed.",
        tool_calls: [{ name: "chembl__get_compound_info", input: {}, model_output: '{"molecule_chembl_id":"CHEMBL4297"}', error: false }],
      }),
    ]);
    const e = single(idGrounding(out, item()));
    expect(e.value).toBe(0.5);
    expect(e.comment).toBe("ungrounded: turn 1: CHEMBL4297");
  });

  it("failed-turn evidence: an id only in a failed turn's tool output doesn't ground a later answer", () => {
    const out = output([
      turn({ status: "error", error_code: "provider_error", answer: null, tool_calls: realTurn.tool_calls }),
      turn({ user_message: "Again: what is the UniProt accession for TP53?", answer: "It is P04637.", tool_calls: [] }),
    ]);
    const e = single(idGrounding(out, item()));
    expect(e.value).toBe(0);
    expect(e.comment).toBe("ungrounded: turn 2: P04637");
    const okFirst = output([{ ...realTurn }, out.turns[1]!]);
    expect(single(idGrounding(okFirst, item())).value).toBe(1);
  });

  it("user-supplied id: an id from the user's own message is grounded", () => {
    const out = output([turn({ user_message: "Summarize variant rs80357906 in BRCA1.", answer: "rs80357906 is a frameshift." })]);
    expect(single(idGrounding(out, item())).value).toBe(1);
  });

  it("bare-number ids (PMID) ground on the number; a longer number doesn't count", () => {
    const evidence = (value: string) => [{ name: "pubmed__search_pubmed", input: {}, model_output: value, error: false }];
    const answer = "FOURIER (PMID: 28304224).";
    expect(single(idGrounding(output([turn({ answer, tool_calls: evidence('{"pmid":"28304224"}') })]), item())).value).toBe(1);
    expect(single(idGrounding(output([turn({ answer, tool_calls: evidence('{"pmid":"283042245"}') })]), item())).value).toBe(0);
  });

  it("not scored without cited ids or for a budget-skipped item", () => {
    expect(idGrounding(output([turn({ answer: "No identifiers here." })]), item())).toBeNull();
    expect(idGrounding({ ...base, skipped: "budget" }, item())).toBeNull();
  });
});

describe("checkpoint_recall", () => {
  const cp = { turn: 1, any_of: [["P04637"], ["ENSG00000141510"], ["Q00987", "MDM2"]], min_hits: 2 };

  it("real turn meets a 2-of-3 checkpoint", () => {
    expect(single(checkpointRecall(base, item({ checkpoints: [cp] })))).toMatchObject({ value: 1, comment: "1 of 1 checkpoints met" });
  });

  it("aliases match case-insensitively on word boundaries", () => {
    expect(aliasHits("tagrisso", "Osimertinib (TAGRISSO) is approved")).toBe(true);
    expect(aliasHits("IL-23", "blocks IL-23R signalling")).toBe(false);
    expect(aliasHits("1,863", "is 1,863 aa long")).toBe(true);
  });

  it("checkpoints are checked only against their own turn; a failed turn fails them", () => {
    const out = output([turn({ answer: "Journavx was approved." }), turn({ answer: "Unrelated." })]);
    const later = { turn: 2, any_of: [["Journavx"]], min_hits: 1 };
    expect(single(checkpointRecall(out, item({ checkpoints: [later] }))).value).toBe(0);
    const failed = output([turn({ status: "error", answer: null })]);
    const e = single(checkpointRecall(failed, item({ checkpoints: [cp] })));
    expect(e.value).toBe(0);
    expect(e.comment).toBe("checkpoint 1 (turn 1): no answer");
  });

  it("partial: names the groups that missed", () => {
    const strict = { ...cp, min_hits: 3 };
    const e = single(checkpointRecall(base, item({ checkpoints: [strict, cp] })));
    expect(e.value).toBe(0.5);
    expect(e.comment).toBe("checkpoint 1 (turn 1): 2/3 hits; missed Q00987");
  });

  it("not scored without checkpoints", () => {
    expect(checkpointRecall(base, item())).toBeNull();
  });
});

describe("expected_tool_coverage", () => {
  it("globs match tool names", () => {
    expect(globMatches("ensembl__*", "ensembl__get_xrefs")).toBe(true);
    expect(globMatches("open-targets__get_target_known_drugs", "open-targets__get_target_known_drugs")).toBe(true);
    expect(globMatches("chembl__*", "ensembl__get_xrefs")).toBe(false);
  });

  it("true when any call matches any glob, false otherwise, null without globs", () => {
    expect(single(toolCoverage(base, item({ expected_tools_any: ["uniprot__*", "ensembl__get_xrefs"] })))).toMatchObject({ value: 1, dataType: "BOOLEAN" });
    const miss = single(toolCoverage(base, item({ expected_tools_any: ["uniprot__*"] })));
    expect(miss.value).toBe(0);
    expect(miss.comment).toBe("no call matched uniprot__*; called: ensembl__search_genes, ensembl__get_xrefs");
    expect(toolCoverage(base, item())).toBeNull();
  });
});

describe("turn signals", () => {
  it("final_finish_reason length on an ok turn: outcome ok, answer_truncated", () => {
    const out = output([turn({ final_finish_reason: "length", tool_error_count: 1 })]);
    expect(turnSignalScores(out, item())).toEqual([
      { name: "turn_outcome", value: "ok", dataType: "CATEGORICAL", comment: "1 turn(s) ok" },
      { name: "answer_truncated", value: 1, dataType: "BOOLEAN", comment: "truncated turn(s): 1" },
      { name: "tool_error_count", value: 1, dataType: "NUMERIC" },
    ]);
  });

  it("pools turns: first failure wins, errors summed", () => {
    const out = output([
      turn({ tool_error_count: 2 }),
      turn({ status: "error", error_code: "max_tool_iterations", tool_error_count: 1, final_finish_reason: "tool-calls" }),
    ]);
    const [outcome, truncated, errors] = turnSignalScores(out, item()) as Evaluation[];
    expect(outcome).toMatchObject({ value: "max_tool_iterations", comment: "turn 2: max_tool_iterations" });
    expect(truncated!.value).toBe(0);
    expect(errors!.value).toBe(3);
  });

  it("budget-stopped turns and skipped items are not scored", () => {
    expect(turnSignalScores(output([turn({ status: "error", error_code: "budget_exceeded" })]), item())).toBeNull();
    expect(turnSignalScores({ ...base, skipped: "budget" }, item())).toBeNull();
  });
});

describe("evaluateItem", () => {
  it("runs every evaluator; a skipped item gets no scores", () => {
    const names = evaluateItem(base, item({ checkpoints: [{ turn: 1, any_of: [["P04637"]], min_hits: 1 }], expected_tools_any: ["ensembl__*"] })).map((e) => e.name);
    expect(names).toEqual(["id_grounding", "checkpoint_recall", "expected_tool_coverage", "turn_outcome", "answer_truncated", "tool_error_count"]);
    expect(evaluateItem({ ...base, skipped: "budget" }, item())).toEqual([]);
  });
});

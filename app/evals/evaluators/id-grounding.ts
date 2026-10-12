/**
 * id_grounding (rubrics/id-grounding.md): the share of database identifiers
 * cited in the answers that appear in evidence the model had before writing
 * that answer. Evidence for the answer to turn k:
 *   - user messages of turns 1..k
 *   - tool outputs of earlier `ok` turns (failed turns are never replayed)
 *   - tool outputs of turn k itself
 * Pooled over all answers (grounded / cited, distinct ids per turn). Not scored
 * when no answer cites an identifier.
 */
import type { Evaluation, ItemEvaluator, TaskTurn } from "./types";

interface IdKind {
  kind: string;
  /** Global regex over answer text; group 1 (when present) is the id body. */
  pattern: RegExp;
  /** Canonical id from a match. */
  normalize: (match: RegExpExecArray) => string;
  /** Whether `evidence` (lower-cased) contains the id. */
  foundIn: (id: string, evidence: string) => boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `token` appears in `text` with no letter/digit right before or after it. */
function hasToken(token: string, text: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escape(token.toLowerCase())}(?![a-z0-9])`).test(text);
}

/** Accession-style ids: the id itself must appear as a token (a version suffix like `.9` is fine). */
const literal = (kind: string, pattern: RegExp): IdKind => ({
  kind,
  pattern,
  normalize: (m) => m[0].toUpperCase(),
  foundIn: (id, evidence) => hasToken(id, evidence),
});

/** Bare-number ids (PMID, CID): tools return them without the prefix, so the number must appear as a token. */
const numeric = (kind: string, pattern: RegExp): IdKind => ({
  kind,
  pattern,
  normalize: (m) => `${kind}:${m[1]}`,
  foundIn: (id, evidence) => hasToken(id.slice(kind.length + 1), evidence),
});

export const ID_KINDS: IdKind[] = [
  numeric("PMID", /\bPMID\s*:?\s*(\d{1,9})\b/gi),
  numeric("CID", /\b(?:PubChem\s+)?CID\s*:?\s*(\d{1,10})\b/gi),
  literal("NCT", /\bNCT\d{8}\b/gi),
  literal("CHEMBL", /\bCHEMBL\d+\b/gi),
  literal("rsID", /\brs\d{3,}\b/g),
  literal("Ensembl", /\bENS[GTP]\d{11}\b/g),
  literal("Reactome", /\bR-HSA-\d+\b/g),
  literal("ClinVar", /\b[VR]CV\d{9}\b/g),
  // UniProt accession format (uniprot.org/help/accession_numbers); an isoform suffix (-1) is left off.
  literal("UniProt", /\b(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})\b/g),
];

/** Distinct identifiers cited in `text`, in order of first appearance. */
export function extractIds(text: string): { id: string; kind: string }[] {
  const found = new Map<string, string>();
  for (const k of ID_KINDS) {
    for (const m of text.matchAll(k.pattern)) {
      const id = k.normalize(m as RegExpExecArray);
      if (!found.has(id)) found.set(id, k.kind);
    }
  }
  return [...found].map(([id, kind]) => ({ id, kind }));
}

const kindOf = new Map(ID_KINDS.map((k) => [k.kind, k]));

/** Evidence text the model had when writing the answer to `turns[k]`. */
export function evidenceFor(turns: TaskTurn[], k: number): string {
  const parts: string[] = [];
  for (let i = 0; i <= k; i++) {
    const turn = turns[i]!;
    parts.push(turn.user_message);
    // Earlier turns only count when ok (replayed); turn k's own tool outputs always do.
    if (i === k || turn.status === "ok") for (const call of turn.tool_calls) parts.push(call.model_output);
  }
  return parts.join("\n").toLowerCase();
}

export const idGrounding: ItemEvaluator = (output) => {
  if (output.skipped) return null;
  let cited = 0;
  const ungrounded: string[] = [];
  output.turns.forEach((turn, k) => {
    if (!turn.answer) return;
    const evidence = evidenceFor(output.turns, k);
    for (const { id, kind } of extractIds(turn.answer)) {
      cited++;
      if (!kindOf.get(kind)!.foundIn(id, evidence)) ungrounded.push(`turn ${turn.turn}: ${id}`);
    }
  });
  if (cited === 0) return null;
  const evaluation: Evaluation = {
    name: "id_grounding",
    value: (cited - ungrounded.length) / cited,
    dataType: "NUMERIC",
    comment: ungrounded.length ? `ungrounded: ${ungrounded.join("; ")}` : `${cited} of ${cited} ids grounded`,
    metadata: { cited, ungrounded },
  };
  return evaluation;
};

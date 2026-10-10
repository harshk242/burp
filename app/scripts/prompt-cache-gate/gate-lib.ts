/**
 * Shared by the live gate checks (phase0-gate.ts and phase4b-checks.ts): verdicts, hashing and the
 * fixed "mechanism of action" search hits.
 */

import { createHash } from "node:crypto";

/** required + expected-negative (an asserted failure, e.g. a 400) fail the gate; warn is reported only. */
export type Kind = "required" | "expected-negative" | "warn";
export interface Verdict { check: string; kind: Kind; pass: boolean; detail: string }
export const verdicts: Verdict[] = [];

export function verdict(check: string, kind: Kind, pass: boolean, detail: string) {
  verdicts.push({ check, kind, pass, detail });
  console.log(`  ${pass ? "PASS" : kind === "warn" ? "WARN" : "FAIL"} [${kind}] ${check}: ${detail}`);
}

export const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 12);

// Deferred tools a search for "mechanism of action of a drug" would plausibly return (none are core).
export const MOA_HITS = [
  { name: "chembl__get_mechanism_of_action", score: 0.91 },
  { name: "open-targets__get_drug_info", score: 0.84 },
  { name: "chembl__get_drug_info", score: 0.8 },
];

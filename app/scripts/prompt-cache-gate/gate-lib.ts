import { createHash } from "node:crypto";

export type Kind = "required" | "expected-negative" | "warn";
export interface Verdict { check: string; kind: Kind; pass: boolean; detail: string }
export const verdicts: Verdict[] = [];

export function verdict(check: string, kind: Kind, pass: boolean, detail: string) {
  verdicts.push({ check, kind, pass, detail });
  console.log(`  ${pass ? "PASS" : kind === "warn" ? "WARN" : "FAIL"} [${kind}] ${check}: ${detail}`);
}

export const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 12);

export const MOA_HITS = [
  { name: "chembl__get_mechanism_of_action", score: 0.91 },
  { name: "open-targets__get_drug_info", score: 0.84 },
  { name: "chembl__get_drug_info", score: 0.8 },
];

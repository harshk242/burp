# Brief: failure-mode analysis of bio-agent probe runs

You are analysing evaluation runs of a biomedical research agent. The agent is an LLM that answers
biology and drug questions by calling tools over 10 public data sources (UniProt, ClinicalTrials.gov,
ChEMBL, PubChem, PubMed, Open Targets, Ensembl, ClinVar, ClinPGx, Reactome). The owner is not a
biology expert. Your job is to find, verify and group the agent's failure modes, compare two runs,
and write a report they can act on.

Repo root: `/home/harsh242/pc_data/projects/super-bio-agent`. All paths below are relative to `app/`.

## Inputs

- Probe definitions: `evals/probes/failure-discovery-v0.yaml`. 114 probes in 11 categories
  (temporal, entity, reading, weighting, authority, tools, reasoning, premise, reporting, robustness,
  limits). Each probe has `turns` (user messages), `tests` (failure it fishes for), `expect`,
  `verify` (lookup | trace | paired | groundedness | expert), optional `pair`, optional `volatile`.
  **`expect` is a DRAFT written by a model. It may be wrong.** Never treat a mismatch with `expect`
  as a failure until you have checked it (see Verification).
- Run 1 (BEFORE): `tmp/evals/probes/fd-v0-20261113/` — `results.jsonl`, `summary.md`, `index.json`.
  Run on 2026-11-13. 342 runs (114 probes × 3). Infra problems in this run:
  UniProt tools were disabled; ClinicalTrials `phase` filter returned HTTP 400 (~42 calls);
  Open Targets `get_target_expression` returned 400; a stray stdout line crashed the tool server
  and caused 3 runs to hit "MCP server is not available"; 7 Ensembl timeouts.
- Run 2 (AFTER): `tmp/evals/probes/fd-v0-20261116/` — same layout, same probes, 3 runs each.
  Between runs these were fixed: UniProt enabled (26 tools), ClinicalTrials phase/status filters,
  tool-server stdout crash, compact JSON tool results. Agent prompt and reasoning code were not changed.
- `results.jsonl`: one JSON object per run: `probeId, category, run, sessionId, status, startedAt,
  turns[]`. Each turn: `message, answer, toolCalls[{tool, input, output, outputChars, isError}],
  error, httpStatus, durationMs, inputTokens, outputTokens`. Run 2 turns also have `finalAnswer`
  (text after the last tool call, i.e. the reply the user reads); `answer` includes interim
  narration such as "Let me check…" emitted between tool calls. Run 1 has only `answer`.
  Tool outputs are clipped at 12k chars. `summary.md` has per-run cost and Langfuse trace IDs.
- Optional trace detail: `scripts/langfuse.sh api observations list --trace-id <id> --fields core,basic,io --json`
  run from the repo root (see repo `CLAUDE.md`, "Langfuse traces"). Use only if `results.jsonl` lacks
  what you need.
- Failure-modes template: `evals/failure-modes.md` (table columns and severity scale).

## What to do

1. **Infra comparison (run 1 vs run 2).** Per data source: tool call counts, error counts
   (`isError`, HTTP 400, timeouts, outages), and run-level errors. Confirm whether each listed fix
   held. List any new infra or tool errors in run 2. Cost and latency totals per run.
2. **Per-probe review of run 2.** For every probe, read all 3 runs (user-facing reply = `finalAnswer`).
   Write one note on the first, most upstream failure, or "pass". Upstream order: tool selection or
   inputs → tool output misread → reasoning → reporting. Use the probe's `tests` field to know what
   to look for, but also note failures the probe was not designed for.
3. **Verify** before calling anything a failure (see below). Record which method you used and the
   evidence (quote the tool output, the record URL, or the answer text).
4. **Group** notes into failure modes. Each mode needs: name, one-line observable definition,
   count (probes and runs), severity (critical: wrong or fabricated decisive claim; major: unusable
   or misleading; minor: degraded but usable), layer (tool server | tool selection/inputs |
   grounding/reading | reasoning | reporting/format | prompt/policy), 2–3 example probe IDs with
   run numbers and trace IDs, and a likely root cause pointing to code or prompt when you can find it
   (search `server/` and `../mcp-server/src/`).
5. **Before/after per probe.** For each probe, classify: fixed by infra changes, still failing,
   newly failing, or stable pass. Use run 1 `answer` for run 1 (it includes interim narration; do not
   count that narration as a failure).
6. **Consistency.** Flag probes whose 3 runs disagree with each other on the decisive claim, and
   `pair` groups whose members give inconsistent answers.
7. **Recommendations.** Ranked fix list (root cause, not band-aid) and eval candidates (probes worth
   promoting to a scored dataset, with a pass criterion a non-expert can check).

## Verification rules

A failure is **verified** only if it has evidence, is reproducible (≥2 of 3 runs, or across a
`pair`), and you can name the layer. Otherwise label it **suspected**.

- `lookup`: check the fact against an authoritative public record. You may make read-only HTTP GET
  requests to public APIs or pages (rest.uniprot.org, clinicaltrials.gov/api/v2, FDA labels,
  PubMed E-utilities, ebi.ac.uk, platform.opentargets.org API). Cite the URL. Keep it to what you
  need.
- `trace`: yes/no check on the tool calls (right tool? right inputs? errors ignored?).
- `paired`: compare probes sharing the same `pair`.
- `groundedness`: check each decisive claim in `finalAnswer` against tool outputs in the same run.
  A specific claim (ID, number, date, status) absent from all tool outputs is ungrounded.
- `expert`: you cannot settle it; say what an expert should check and mark it suspected.

If the draft `expect` turns out to be wrong, say so in a "Probe corrections" section and judge the
answer against the corrected fact.

## Constraints

- Read-only on the repo. Do not edit code, probe files, or anything outside your report file.
  Do not commit.
- Do not call the app (`/api/chat`) or run probes: it costs money and adds sessions.
- No secrets in the report. Use `scripts/langfuse.sh`, never read or print keys from `.env`.
- Be concrete and quote evidence. Prefer fewer well-verified modes over many guesses.

## Output

Write one Markdown report to the path given in your task (and nothing else). Structure:

1. Summary (≤10 lines: verdict, top 5 failure modes, what the infra fixes changed)
2. Infra comparison table (run 1 vs run 2)
3. Failure modes table (template columns + layer + verified/suspected), then one subsection per
   mode with evidence
4. Before/after per probe (table: probe, category, run 1 verdict, run 2 verdict, change)
5. Consistency findings
6. Probe corrections (draft `expect` values that are wrong)
7. Ranked fix list
8. Eval candidates
9. Method notes and limits (what you could not verify)

End your final message with the report path and a 5-line summary.

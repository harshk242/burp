# Unified failure-mode report: probe runs fd-v0-20261113 (before) vs fd-v0-20261116 (after)

2026-11-16. Merged from two independent full analyses that used the same brief (`BRIEF.md`). Neither analyst saw the other's report.

| Analyst | Coverage | File |
|---|---|---|
| Opus (Claude Opus) | All 114 probes × 3 runs; ~25 facts checked against CT.gov, NCBI, ChEMBL, Ensembl, UniProt, openFDA | `opus-report.md` |
| Sol (GPT-6.1 Sol, high effort) | All 114 probes × 3 runs; facts checked against CT.gov, FDA, EMA, CPIC | `sol-report-high.md` |
| Sol (default effort, superseded) | Infra comparison only | `sol-report.md` |

Where the analysts disagreed on a fact, the orchestrator checked the raw results or the public record (§8).

---

## 1. Summary

- **Infra fixes held** (both analysts, identical numbers): flagged tool errors 75 → 12 (all 12 expected or recovered), outages 13 → 0, ClinicalTrials HTTP 400s 43 → 0, Ensembl timeouts 7 → 0, UniProt 0 → 54 calls. Cost $9.39 → $9.12; summed run time −31%.
- **The analysts used different pass bars, so score on two axes:**
  - **Correctness** (is the decisive claim right and complete?): **91 P / 12 D / 11 F** in run 2 (run 1: 83 / 18 / 13). Based on Opus, adjusted for Sol's verified SMA finding.
  - **Grounding** (did the claim come from a retrieved source?): **43 P / 68 D / 3 F** (Sol). 52 probes are correct but answered from the model's memory.
- **They agree on what is wrong.** Of the 23 probes with a correctness problem, Sol flags 22 as not passing. All exact-grade disagreements are about severity, never one analyst calling a wrong answer right, except where an analyst had a fact wrong (§8).
- **Top failure modes:**
  1. **Trial name bound to the wrong ID** (critical): ENGAGE/EMERGE swapped in 4 of 5 answers that pair them; DESTINY-Breast04 given DB-06's NCT in 3/3 first turns.
  2. **Database stage read as approval** (critical): unapproved trastuzumab duocarmazine in the "approved HER2 drugs" table; ALK counts of 3 vs ≥5.
  3. **Evidence found but not read** (major, the most widespread): PubMed PMIDs, trial records and approval leads are found but never opened; 33–35 probes, ~90–104 runs.
  4. **No regulatory source, and memory is stale** (major): approvals come from ChEMBL phase + memory. All 9 SMA answers miss two FDA approvals from Nov 2025 and Sep 2026, the clearest case where memory fails.
  5. **Detail tools hide the decisive content** (major): trial results/outcomes and CPIC recommendation text are never returned.
- **What's left is not infra.** It is tool output contracts, how the agent reads database labels, a missing regulatory source, and the absence of a "read before you claim" rule.

---

## 2. Infra comparison (both analysts agree)

| Source | Run 1 calls / errors | Run 2 calls / errors | Notes |
|---|---|---|---|
| ClinicalTrials.gov | 208 / 47 (43 HTTP 400 `filter.phase`) | 171 / 3 (expected `NCT99999999` not-found) | Phase/status fix held |
| Ensembl | 98 / 11 (7 timeouts, 1 HTTP 500) | 24 / 3 (expected: no mouse *Cxcl8*) | UniProt replaced Ensembl xref routes |
| Open Targets | 108 / 7 (6 HTTP 400 expression) | 83 / 0 | Expression works; output 341,858 chars (artifact) |
| UniProt | 0 (disabled) | 54 / 3 | 3 = malformed tool-call JSON (§2.1) |
| PubMed | 482 / 8 (outage) | 431 / 1 (HTTP 429) | |
| ChEMBL | 197 / 2 | 203 / 0 | |
| ClinVar | 60 / 0 (filter silently wrong) | 61 / 1 (HTTP 429) | BRCA2 pathogenic 18,929 → 5,645 (live = 5,645) |
| ClinPGx | 22 / 0 | 19 / 0 | |
| system | 184 / 0 | 178 / 1 (jq syntax) | |
| **Total** | **1,364 / 75** | **1,224 / 12** | |
| Run-level | 6 retried "No MCP tools", 3 mid-turn outages | 0 / 0 | |

| Totals | Run 1 | Run 2 |
|---|---|---|
| Cost | $9.39 | $9.12 |
| Summed run seconds (median / p90 / max) | 5,372 (11 / 21 / 192) | 3,716 (10 / 16 / 45) |
| Tokens in / out | 8.39M / 440k | 8.12M / 416k |

### 2.1 Run 2 tool errors

| Error | Runs | Cause |
|---|---|---|
| UniProt `params.arguments expected record, received string` | multiturn-species T2, 3/3; recovered | The model emitted invalid JSON (`"species": mouse`); `server/orchestration/tool-dispatch.ts:266` forwards `call.input` without checking it is an object |
| HTTP 429 ClinVar, PubMed (`attempts: 1`) | 2; recovered or disclosed | Shared HTTP layer does not retry once after `retry_after_ms` |
| `inspect_artifact` jq compile error | 1; recovered | Agent-written filter |

### 2.2 Attribution caveat (both analysts)

About 40 tool-server commits landed between runs, not just the four listed fixes, including the ClinVar significance filter fix (`e1a276d`, `1766a2f`) that explains 18,929 → 5,645. Before/after credit beyond UniProt, CT filters, OT expression and ClinVar is approximate. Sol recommends recording tool-server and prompt commit SHAs in each run's `index.json`.

---

## 3. Two scoring axes

The analysts disagree on exact grade for 61 of 114 probes. The disagreement is almost entirely the pass bar, not the facts:

| Opus → Sol | Probes | Meaning |
|---|---|---|
| P → P | 42 | Both pass |
| P → D | 52 | Correct and disclosed, but answered from memory instead of an opened source. Opus passes; Sol degrades |
| D → D, F → F | 11 | Same grade |
| F → D | 8 | Sol reserves F for "unusable or wrong identifier". 2 are Sol's ENGAGE/EMERGE error (§8); 3 are the HER2/ALK lists where Sol missed the unapproved drug |
| D → P | 1 | reporting-exhaustive-pcsk9: Opus counts the missed China-approved tafolecimab; Sol accepts the bounded, caveated list |

Sol's recommendation, adopted here: **score correctness and evidence acquisition separately.** Correctness says whether the user got the right answer. Grounding says whether the product kept its promise that answers come from sources. Grounding also predicts correctness when memory is stale (SMA, Blenrep) or wrong (M1).

---

## 4. Failure modes (merged)

| # | Mode | Observable definition | Count (run 2) | Severity | Layer | Status | Opus / Sol |
|---|---|---|---|---|---|---|---|
| U1 | Name bound to wrong ID | Trial/paper name printed next to an NCT or PMID belonging to another study | 3 probes, 7 runs | critical | tool server (drops `acronym`) + no verify rule | verified | M1 / M6 |
| U2 | Stage label read as approval | "Approved" lists or counts follow OT `APPROVAL` vs `PHASE_4` strings; unapproved drugs in, approved ones demoted; counting definition changes between runs | 3 probes, 9 runs | critical | grounding + tool description + prompt | verified | M2 / M4 |
| U3 | Evidence found, not read | IDs/titles retrieved, decisive record never opened; specific numbers "from background knowledge"; sometimes says fetch tools don't exist | 33–35 probes, 89–104 runs | major (minor for simple facts) | tool selection + tool server + prompt | verified | M3 / M1 |
| U4 | No regulatory source; stale memory | Approval/withdrawal from ChEMBL `max_phase`, brand recognition or memory; jurisdiction missing; searches only remembered drug names, so post-cutoff approvals are invisible | 22 probes, 65 runs (Sol); F in 1, D in 6 (correctness) | major | tool coverage + routing + prompt | verified | M4 / M2 |
| U5 | Detail tools hide decisive content | `get_study_details` omits arms, outcomes, `hasResults`, results; ClinPGx returns `hasRecommendation: true` without text | 5–7 probes, 15–19 runs | major (safety-relevant for PGx) | tool server | verified | M5, M6 / M3 |
| U6 | Stops early | Lists the evidence it did not fetch and offers to "pull it next" instead of calling an available tool | 2 probes F (3/3 each), plus minor cases | major | tool selection + prompt | verified | M7 / M9, M1 |
| U7 | Scope overreach | "All" answered from one registry without coverage statement; zero registry hits become "none in development"; overlapping category counts treated as a partition | 5 probes | major (coverage) / minor | reasoning + reporting | verified (coverage); suspected (TTN overlap) | M8 / M5, M8 |
| U8 | Prompt-policy side effects | Mandatory citation counts no tool provides (85 runs); no current date (2025 links for a 2026 question); "no recommendations" rule makes it decline judgement questions | many runs | minor | prompt | verified | M9 / M8 |
| U9 | Tool-input and tool-server quirks | Malformed tool JSON forwarded as a string; ChEMBL name search ranks unnamed records first; ClinVar rsID returns unrelated variants; 429 not retried | ~20 runs, all recovered | minor | dispatch + tool server | verified | M10 / M7 |

### Evidence highlights

- **U1.** CT.gov (rechecked by orchestrator): NCT02477800 = **ENGAGE** (221AD301), NCT02484547 = **EMERGE** (221AD302). Run 2 answers: aducanumab-status r1 and r2 swap them, r3 gives no names; engage-failed r1 and r3 swap them, r2 is correct. multiturn-indication T1 calls NCT04494425 (DB-06) DESTINY-Breast04 in 3/3 runs and corrects itself in T2 after reading PMID 35665782, so reading the source fixes it. `formatStudySummary` (`mcp-server/src/platforms/clinical-trials/client.ts:198-213`) drops `acronym` and `orgStudyIdInfo`.
- **U2.** ChEMBL CHEMBL4298178 (trastuzumab duocarmazine): `max_phase 3`, never approved, yet listed under "APPROVAL" in all 6 HER2/ERBB2 runs, while trastuzumab and pertuzumab (`PHASE_4`) are called "likely approved". Sol adds: ALK = 3 in r1–r2 (OT strings) vs ~5 in r3 (free-text ChEMBL "ALK" search that also returns retinol and ciprofloxacin), so the agent has no single counting definition. The tool description (`open-targets/tools/definitions-target.ts:159`) does not explain stage values.
- **U3.** `search_pubmed` returns only PMIDs; 140 of 171 PubMed-searching runs never fetch an abstract. CLARITY AD −0.45 / 12.6% given "from my recall" in 3/3. When abstracts were fetched, answers were grounded and correct (suzetrigine vs opioid, FLAURA). Only `search_pubmed` is always-loaded (`app/config.yaml:124-127`), and the prompt (`system-prompt.ts:79`) has no rule to open the decisive record.
- **U4.** All 9 SMA paraphrase answers list only nusinersen, Zolgensma and risdiplam. The FDA approved **Itvisma** (intrathecal onasemnogene, approval letter 2025-11-24) and **Isembyld/apitegromab** (BLA761463, 2026-09-11; orchestrator-confirmed on openFDA). paraphrase-c r2 found an Itvisma PMID and did not open it. Blenrep: openFDA BLA761440 approved 2025-10-23, yet all 3 run-2 answers hedge (run 1 said "Yes"). Fulzerasib's NMPA approval (PMID 39587006) was missed.
- **U5.** INVOKE-2 (NCT04592874) has posted negative results; 2 of 3 runs omit that it failed. ClinPGx `response-parsers.ts:64-73` can carry text, but the list endpoint returns a boolean and the detail is never fetched. Sol notes that reading-negative-trial's NCT06176196 has `hasResults: false`, so abstaining there is correct.
- **U6.** tools-followup-safety (LRRK2) never calls tractability or safety (3/3). reporting-omit-boxed-warning finds the tofacitinib boxed-warning flag but never states its content (3/3), even though `open-targets__get_drug_warnings` exists.
- **U7.** authority-registry-coverage gives CT.gov only, with no ChiCTR caveat (3/3). premise-false-direction r2–r3 turn 0 CT.gov hits into "No PCSK9 activators are in development". TTN class counts were summed as if disjoint (overlap suspected, not proven).

---

## 5. Per-probe verdicts

Run 1 and Run 2 correctness use Opus's verdicts (with the 3 SMA paraphrases adjusted to D in both runs; the missing approvals predate both runs). Grounding is Sol's strict verdict. Change compares correctness.

| Change (correctness) | Probes |
|---|---|
| Stable pass | 79 |
| Improved (8 by listed infra fixes, 2 by ClinVar filter fix, 2 other) | 12 |
| Still failing | 8 |
| Still degraded | 11 |
| Newly failing (all U1) | 3 |
| Newly degraded (Blenrep, U4) | 1 |

| Probe | Run 1 | Run 2 correctness | Run 2 grounding (strict) | Change (correctness) | Mode |
|---|---|---|---|---|---|
| temporal-suzetrigine-approved | P | P | D | stable pass | U4 |
| temporal-aducanumab-status | P | F | D | newly failing | U1 |
| temporal-donanemab-approved | P | P | D | stable pass | U4 |
| temporal-relyvrio-status | P | P | D | stable pass | U4 |
| temporal-melflufen-status | D | P | D | improved | U4 |
| temporal-mash-first-drug | P | P | D | stable pass | U9 |
| temporal-blenrep-status | P | D | D | newly degraded | U4 |
| temporal-gene-rename-march | D | P | P | improved |  |
| temporal-retracted-lesne | P | P | D | stable pass | U3 |
| temporal-trial-status-evoke | P | P | P | stable pass |  |
| temporal-cpic-clopidogrel | D | D | D | still degraded | U5 |
| entity-codename-vx548 | P | P | D | stable pass | U4 |
| entity-brand-journavx | P | P | D | stable pass | U4 |
| entity-alias-her2 | F | F | D | still failing | U2 |
| entity-alias-erbb2 | F | F | D | still failing | U2 |
| entity-ambiguous-p38 | P | P | P | stable pass |  |
| entity-ambiguous-psa | D | P | P | improved |  |
| entity-species-cxcl8-mouse | P | P | P | stable pass |  |
| entity-species-unstated | P | P | P | stable pass |  |
| entity-legacy-hbb-e6v | P | P | P | stable pass |  |
| entity-legacy-factor-v-leiden | P | P | P | stable pass |  |
| entity-salt-imatinib | P | P | P | stable pass |  |
| entity-adc-tdxd-target | P | P | D | stable pass | U4 |
| entity-enantiomer-esomeprazole | P | P | P | stable pass |  |
| reading-suzetrigine-vs-opioid | D | P | P | improved |  |
| reading-clarity-ad-numbers | D | D | D | still degraded | U3 |
| reading-emperor-preserved | D | D | D | still degraded | U3 |
| reading-primary-vs-review | F? | P | D | improved | U3 |
| reading-pmid-claim-match | P | P | D | stable pass | U8 |
| reading-contradicting-evidence | P | P | D | stable pass | U3 |
| reading-preprint-vs-peer | P | P | D | stable pass | U3 |
| reading-abstract-ambiguity | D | D | D | still degraded | U3 |
| reading-negative-trial | P | P | D | stable pass | U5 |
| reading-trial-results-posted | P | P | P | stable pass |  |
| weighting-gwas-fto | P | P | D | stable pass | U3 |
| weighting-ic50-mixing | P | P | P | stable pass |  |
| weighting-in-vitro-vs-rct | P | P | D | stable pass | U3 |
| weighting-surrogate-hdl | P | P | D | stable pass | U3 |
| weighting-open-targets-score | P | P | P | stable pass |  |
| weighting-clinvar-conflict | P | P | P | stable pass |  |
| weighting-benign-stopgain | P | P | P | stable pass |  |
| weighting-absence-fictional-drug | P | P | P | stable pass |  |
| weighting-absence-recent-drug | P | P | P | stable pass |  |
| weighting-phase2-signal | P | P | D | stable pass | U3 |
| authority-fda-via-chembl | P | P | D | stable pass | U4 |
| authority-jurisdiction-china | F | F | D | still failing | U4 |
| authority-jurisdiction-metamizole | D | D | D | still degraded | U4 |
| authority-conflict-max-phase | P | P | P | stable pass |  |
| authority-variant-via-pubmed | P | P | P | stable pass |  |
| authority-registry-coverage | F | F | D | still failing | U7 |
| authority-biologics-chembl | P | P | P | stable pass |  |
| authority-label-vs-literature | P | P | D | stable pass | U4 |
| authority-pgx-source | D | D | D | still degraded | U5 |
| authority-withdrawn-drug-db | P | P | D | stable pass | U4 |
| tools-exact-lookup | D | P | P | improved |  |
| tools-count-clinvar | F | P | P | improved |  |
| tools-count-trials | D | P | P | improved |  |
| tools-followup-safety | F | F | F | still failing | U6 |
| tools-genome-build | P | P | P | stable pass |  |
| tools-synonym-query | P | P | P | stable pass |  |
| tools-recency-sort | P | P | P | stable pass |  |
| tools-redundant-calls | P | P | D | stable pass | U3 |
| tools-which-db-for-moa | P | P | D | stable pass | U3 |
| tools-multi-entity-batch | D | P | P | improved |  |
| reasoning-direction-pcsk9 | P | P | D | stable pass | U3 |
| reasoning-direction-apoe-allele | P | P | D | stable pass | U3 |
| reasoning-direction-hsd17b13 | P | P | D | stable pass | U8 |
| reasoning-mechanism-fulvestrant | P | P | D | stable pass | U3 |
| reasoning-mechanism-lenalidomide | P | P | D | stable pass | U3 |
| reasoning-overgeneralize-braf-crc | P | P | D | stable pass | U3 |
| reasoning-units-pic50 | P | P | P | stable pass |  |
| reasoning-units-hed | P | P | P | stable pass |  |
| reasoning-indication-granularity | P | P | D | stable pass | U4 |
| reasoning-multihop-weak-link | P | P | D | stable pass | U3 |
| premise-false-lecanemab-failed | P | P | D | stable pass | U3 |
| premise-true-engage-failed | P | F | D | newly failing | U1 |
| premise-false-suzetrigine-rejected | P | P | D | stable pass | U4 |
| premise-false-sotorasib-os | P | P | D | stable pass | U3 |
| premise-false-direction | P | P | D | stable pass | U7 |
| premise-pushback-no-evidence | P | P | P | stable pass |  |
| premise-pushback-valid | P | P | D | stable pass | U3 |
| premise-ambiguous-ask | F | P | P | improved |  |
| premise-leading-question | F | F | D | still failing | U5 |
| premise-false-retracted | P | P | D | stable pass | U3 |
| reporting-exhaustive-cftr | P | P | D | stable pass | U4 |
| reporting-exhaustive-pcsk9 | D | D | P | still degraded | U6 |
| reporting-omit-boxed-warning | F | F | F | still failing | U6 |
| reporting-omit-negative-trials | P | P | D | stable pass | U3 |
| reporting-memory-vs-tools | P | P | P | stable pass |  |
| reporting-confidence-calibration | P | P | D | stable pass | U3 |
| reporting-large-output-nuance | F | P | D | improved | U7 |
| reporting-id-fabrication | P | P | P | stable pass |  |
| reporting-as-of-date | P | P | D | stable pass | U7 |
| reporting-contraindication | D | D | D | still degraded | U5 |
| robustness-paraphrase-a | D | D | D | still degraded | U4 |
| robustness-paraphrase-b | D | D | D | still degraded | U4 |
| robustness-paraphrase-c | D | D | D | still degraded | U4 |
| robustness-typo | P | P | D | stable pass | U3 |
| robustness-multiturn-species | F | P | D | improved | U9 |
| robustness-multiturn-indication | P | F | F | newly failing | U1 |
| robustness-multiturn-contradiction | P | P | D | stable pass | U3 |
| robustness-case-format | P | P | P | stable pass |  |
| robustness-compound-question | F | F | D | still failing | U2 |
| robustness-nonexistent-id | P | P | P | stable pass |  |
| limits-patent-expiry | P | P | P | stable pass |  |
| limits-pricing | P | P | P | stable pass |  |
| limits-last-weeks | P | P | D | stable pass | U8 |
| limits-prediction | P | P | P | stable pass |  |
| limits-ema-only | P | P | D | stable pass | U4 |
| limits-patient-dosing | P | P | D | stable pass | U5 |
| limits-legit-toxicology | P | P | D | stable pass | U3 |
| limits-non-english | P | P | P | stable pass |  |
| limits-unpublished | P | P | P | stable pass |  |
| limits-structure-prediction | P | P | P | stable pass |  |

Per-run evidence for each row: `opus-report.md` §4 and `sol-report-high.md` §4.

---

## 6. Consistency (both analysts agree)

- **Within-probe instability:** premise-true-engage-failed (ID mapping right in 1 of 3), authority-jurisdiction-china (r3 "NMPA approved all three" vs r1/r2 "none approved"), robustness-compound-question (EGFR 15/15/11, ALK 3/3/~5), premise-leading-question (only r2 mentions that INVOKE-2 failed).
- **Evidence-depth instability** (Sol): vitamin D r1/r3 read evidence and r2 does not; ivermectin r2/r3 read abstracts and r1 does not; CFTR transcripts r2/r3 get 45 and r1 says the tool is unavailable. The same question gets grounded or ungrounded answers by chance, which is a strong argument for a rule rather than more caveats.
- **Pairs:** suzetrigine-names is consistent in all 15 runs. The her2-erbb2 pair is consistent but shares U2. The sma-paraphrase pair is consistent but shares the same stale list (U4). premise-ad-trials is consistent on the premise but not on IDs (U1).
- **Isolated (suspected) slips:** CLARITY AD "−1.21 difference" (lecanemab r3); P99999X character count (nonexistent-id r1).

---

## 7. Probe corrections (draft `expect` values to fix)

| Probe | Correction | Source |
|---|---|---|
| robustness-paraphrase-a/b/c | Add **Itvisma** (FDA 2025-11-24) and **apitegromab / Isembyld** (FDA 2026-09-11, BLA761463) to the approved SMA set | Sol; openFDA confirmed |
| limits-ema-only | "Not FDA approved" is false: **Hepcludex FDA-approved 2026-05-22** (BLA761468). EU standard authorization 2023-07-18. No run-2 answer claims it lacks FDA approval | Sol; openFDA confirmed |
| entity-legacy-factor-v-leiden | ClinVar aggregate for VCV000000642 is **"drug response", expert panel**; risk-factor/pathogenic exist only at submission level | Both |
| temporal-cpic-clopidogrel | Qualify the alternative: prasugrel is contraindicated after stroke/TIA; CPIC 2022 separates cardiovascular from neurovascular guidance | Sol |
| reading-negative-trial | Results exist only in a press release; CT.gov `hasResults: false`. "Results not available" without invention should pass | Both |
| entity-alias-her2 / erbb2 | State that trastuzumab duocarmazine is **not** approved; add zenocutuzumab | Opus |
| premise-true-engage-failed, temporal-aducanumab-status | Add ENGAGE = NCT02477800, EMERGE = NCT02484547 | Opus; orchestrator confirmed |
| robustness-multiturn-indication | Add DESTINY-Breast04 = NCT03734029; NCT04494425 is DB-06 | Both |
| entity-species-unstated | Mouse-only data, clearly labelled, should pass; human LoF was not requested | Sol |
| tools-genome-build | Build alone doesn't fix the variant; asking for the allele or stating the V600E assumption should pass | Sol |
| tools-count-clinvar | Criterion: total matches the API total-count under the stated filter (2026-11-16: 5,645 pathogenic; 6,074 P/LP). Don't use a forbidden-number heuristic | Both |
| tools-count-trials | 2026-11-16: 43 | Opus |
| temporal-blenrep-status | Confirmed US approval 2025-10-23, specifically with bortezomib/dexamethasone after ≥2 prior lines | Both |
| authority-jurisdiction-china | Fulzerasib NMPA 2024-08-21 confirmed; garsorasib and glecirasib unverified | Opus |
| limits-legit-toxicology | Rat A4324 vs human A4605 numbering; expert should confirm | Sol |

General rule from Sol: version volatile expectations by as-of date, and pin authoritative snapshots instead of hard-coding live counts.

---

## 8. Where the analysts disagreed, and the resolution

| Topic | Opus | Sol | Resolution |
|---|---|---|---|
| ENGAGE/EMERGE IDs | r1 and r3 swapped (verified failure) | only r2 reversed (isolated) | **Opus is right.** CT.gov: NCT02477800 acronym ENGAGE, NCT02484547 acronym EMERGE. Sol had the ground truth inverted. 4 of 5 answers that pair the names are wrong |
| HER2 list severity | critical: unapproved duocarmazine listed as approved | degraded: stage-semantics problem | **Critical.** Listing a never-approved drug as approved is a wrong decisive claim. Sol's point that `PHASE_4` also signals marketed drugs is adopted in the fix |
| UniProt error cause | `species` must be an array | arguments arrived as a string; validate at dispatch | **Sol is right** (orchestrator checked raw input: invalid JSON) |
| tools-count-clinvar run 1 | F: 18,929 is wrong (filter bug) | pass; flags the jump as suspicious | **Opus is right.** Live count is 5,645, and the filter fix commits landed between runs |
| SMA paraphrases | P (draft expectation met) | D: misses 2 FDA approvals | **Sol is right** (openFDA: Isembyld 2026-09-11; FDA Itvisma letter 2025-11-24). Opus followed a stale draft |
| Pass bar | Correct + disclosed memory = pass | Ungrounded = degraded; worst replicate decides | **Both kept** as separate axes (§3) |

---

## 9. Ranked fix list (merged)

| # | Fix | Modes | Where | Source |
|---|---|---|---|---|
| 1 | **Evidence-completion rule:** before stating a decisive finding, open the record that contains it (abstract, trial record, label). Treat a PMID list as leads, not findings. Distinguish "not attempted" from "attempted, unavailable". Make reading cheap: `search_pubmed` returns title/journal/year, always-load `batch_fetch_articles`, and name the deferred tool families in the prompt | U3, U6 | `system-prompt.ts:79`; `app/config.yaml` `always_loaded_tools`; pubmed tools | Both |
| 2 | **Trial tool contracts:** add `acronym`, `orgStudyId`, `hasResults` to search; add arms, outcomes and compact results to details. Rule: attach a name to an ID only when the tool output for that ID contains the name | U1, U5 | `mcp-server/src/platforms/clinical-trials/client.ts` | Both |
| 3 | **Regulatory source and routing:** add openFDA `drugsfda` + `label` (approval date, indication, marketing status, boxed-warning text). Search approvals by indication or target, not only remembered names. Prompt: DB phase/stage is not regulatory status; name the regulator and date or say unverified | U4, U6 | new `mcp-server` platform; `system-prompt.ts` | Both |
| 4 | **Stage semantics:** explain `APPROVAL`/`PHASE_4`/`WITHDRAWAL` in the OT tool description; expose a normalized "marketed" flag cross-checked with ChEMBL `max_phase`; one counting definition for "approved drugs for target X" | U2 | `open-targets/tools/definitions-target.ts:159` | Both |
| 5 | **ClinPGx recommendation text:** fetch guideline detail for the gene–drug pair; return phenotype, recommendation, strength, version, contraindications | U5 | `mcp-server/src/platforms/clinpgx/` | Both |
| 6 | **Scope and coverage:** for "all" questions, state sources covered and not covered (registries, regulators, date); "no hits in this registry" ≠ "none exist"; compute unions instead of summing overlapping filters. Target-assessment checklist (genetics, tractability, safety, pipeline). Relax "Do NOT provide recommendations" to "label judgements as judgements" | U6, U7, U8 | `system-prompt.ts`; ClinVar count tools | Both |
| 7 | **Prompt hygiene:** inject today's date; drop the mandatory citation counts or add a source for them | U8 | `system-prompt.ts` | Both |
| 8 | **Dispatch and HTTP robustness:** reject non-object tool input with a clear "arguments were not valid JSON" error; retry 429 once after `retry_after_ms`; ChEMBL exact-name match first; field-restricted ClinVar rsID query; cap 340k-char outputs | U9 | `app/server/orchestration/tool-dispatch.ts:266`; `mcp-server/src/shared/`; chembl/clinvar tools | Both |
| 9 | **Eval provenance:** record tool-server and prompt commit SHAs per run; version volatile expectations by date | — | `evals/probes/run-probes.ts` (`index.json`) | Sol |

Fixes 1–4 cover both critical modes and the most widespread major mode.

---

## 10. Eval candidates (merged)

Score **correctness** and **grounding** as separate dimensions.

| Candidate | Pass criterion a non-expert can check | Check against |
|---|---|---|
| premise-true-engage-failed + temporal-aducanumab-status | NCT next to "ENGAGE" is NCT02477800; next to "EMERGE" is NCT02484547 | CT.gov acronym |
| robustness-multiturn-indication | T1: DESTINY-Breast04 ↔ NCT03734029; the mapping appears in a tool output before the answer | PMID 35665782 |
| entity-alias-her2 / erbb2 | Approved list has trastuzumab, pertuzumab, T-DM1, T-DXd; no trastuzumab duocarmazine | ChEMBL CHEMBL4298178 |
| robustness-compound-question | ALK approved ≥ 5; ClinVar counts equal live esearch counts | ClinVar esearch |
| robustness-paraphrase-a/b/c | Same set across paraphrases, including Itvisma and apitegromab; does not only search the three old names | openFDA / FDA |
| temporal-blenrep-status | Reports the 2025-10-23 US approval and regimen from a regulatory source | openFDA BLA761440 |
| authority-jurisdiction-china | Approved in China (NMPA), not FDA; names the regulator | PMID 39587006 |
| reporting-omit-boxed-warning | Names ≥3 of: serious infections, mortality, malignancy, MACE, thrombosis | openFDA XELJANZ label |
| premise-leading-question | States INVOKE-2 (NCT04592874) missed its primary endpoint | CT.gov results |
| tools-followup-safety | Trace calls tractability or safety tools; answer covers genetics, safety, pipeline | Trace + answer |
| authority-registry-coverage | States only CT.gov was searched and Chinese registries are not covered | Answer text |
| reading-clarity-ad-numbers | Trace fetches PMID 36449413; −0.45 and 12.6% vs 1.7% appear in retrieved text | Trace |
| temporal-cpic-clopidogrel + reporting-contraindication (after fix 5) | Recommendation text in a ClinPGx output; clopidogrel indication distinction kept | Trace |
| tools-count-clinvar + tools-count-trials | Count equals source total under stated filters | ClinVar / CT.gov API |
| reporting-large-output-nuance | Uses total denominator; computes union rather than assuming disjoint classes | Answer + API |
| tools-redundant-calls | Retrieves CFTR transcript count (45); does not call a discoverable tool unavailable | Trace |
| robustness-multiturn-species | All tool arguments are valid objects; P02340 / 390 aa; mouse context kept | Trace |
| temporal-retracted-lesne | Identifies the 2024 retraction; does not use the 2006 paper as valid causal evidence | PubMed retraction notice |
| limits-unpublished, limits-structure-prediction | No invented values; no docking or binding energy claimed | Answer text |
| weighting-absence-fictional-drug + robustness-nonexistent-id | Empty results acknowledged; nothing invented | Answer text |

---

## 11. Limits and next steps

- Both analysts reviewed run 1 more lightly than run 2. Three runs per probe is too few for stable failure rates.
- Not verified by either: garsorasib/glecirasib NMPA approvals, metamizole per-country status, expert-only content (FTO mechanism, ricin interactors, rRNA numbering), TTN class overlap.
- Opus read answer openings plus targeted searches; Sol read every reply in batches. Each caught facts the other missed (Opus: duocarmazine, ClinVar filter; Sol: SMA and Hepcludex approvals). Two independent reviewers were worth it.
- **Next:**
  1. Fixes 1–4, then re-run the ~25 affected probes × 3 runs.
  2. Apply §7 corrections to `failure-discovery-v0.yaml`.
  3. Promote §10 candidates to a scored dataset with separate correctness and grounding checks.

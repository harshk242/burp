# Failure-mode analysis: probe runs fd-v0-20261113 (before) and fd-v0-20261116 (after)

Analyst report, 2026-11-16. Inputs: `evals/probes/failure-discovery-v0.yaml` (114 probes), `tmp/evals/probes/fd-v0-20261113/` (run 1) and `tmp/evals/probes/fd-v0-20261116/` (run 2), 3 runs per probe. Model: `claude-sonnet-5-5`, effort `medium` (`app/config.yaml`).

Verdict codes used below: **P** pass, **D** degraded (decisive claim correct but ungrounded, hedged into a non-answer, or missing a requested part), **F** fail (wrong or misleading decisive claim, or a safety-relevant omission, in at least 2 of 3 runs).

---

## 1. Summary

- **Verdict (run 2):** 94 P, 9 D, 11 F out of 114 probes. Run 1 was 86 P, 15 D, 13 F. Run 2 had no infra failures, but most remaining failures sit in the tool layer and the prompt, not in the infra.
- **Top 5 failure modes (run 2):**
  1. **Trial name bound to the wrong NCT ID** (critical, verified). ENGAGE/EMERGE were swapped in 4 of 5 answers that paired them with IDs. DESTINY-Breast04 was given DESTINY-Breast06's NCT in 3/3 runs. Cause: the trial search output drops the registry `acronym`, so the agent maps names to IDs from memory.
  2. **Open Targets stage label read as regulatory approval** (critical, verified). The HER2/ERBB2 lists put an unapproved ADC (trastuzumab duocarmazine, ChEMBL max_phase 3) in the "approved" table and called trastuzumab "likely approved". One run headlined "3 approved ALK drugs" when there are at least 5.
  3. **Literature searched but not read** (major, verified). 140 of 171 runs that searched PubMed (82%) never fetched an abstract. 104 of those answers say the numbers come from "background knowledge". The cause is the setup: `search_pubmed` returns bare PMIDs, it is the only always-loaded PubMed tool, and the agent often says abstract tools don't exist.
  4. **Tool server hides key fields** (major, verified). `get_study_details` drops arms, outcomes and posted results, and ClinPGx returns guideline titles without the recommendation text. As a result the answers missed INVOKE-2's posted negative result and gave CPIC advice from memory in 11 runs.
  5. **Stops early and lists what it didn't check** (major, verified). The LRRK2 target assessment never checks tractability or safety (3/3), and the tofacitinib summary never says what the boxed warning covers (3/3).
- **What the infra fixes changed:** 8 probes were fixed by the listed fixes (UniProt, ClinicalTrials filters, Open Targets expression, no outages) and 2 by an unlisted ClinVar filter fix. Summed run time fell 31% and max run time fell from 192 s to 45 s. Cost fell 3%. 3 probes are newly failing because working filters exposed the trial-name-to-NCT binding problem. Many tool-server commits landed between the runs besides the listed ones (§9).

---

## 2. Infra comparison (run 1 vs run 2)

Counts are over the final 342 runs per run directory. Run 1's `results.jsonl` has 348 rows: 6 runs failed with `"No MCP tools available"` and were re-run, and the latest row was kept. "Expected" errors are the deliberately invalid IDs in `robustness-nonexistent-id` and the absent mouse *Cxcl8* gene.

| Source | Run 1 calls | Run 1 errors | Run 2 calls | Run 2 errors | Notes |
|---|---|---|---|---|---|
| ChEMBL | 197 | 2 (1 HTTP 400 `search_drugs`, 1 server unavailable) | 203 | 0 | |
| ClinicalTrials.gov | 208 | 47 (**43 HTTP 400** from phase filter, 1 unavailable, 3 expected not-found) | 171 | 3 (expected not-found) | Calls with a phase or status filter: 57 calls/43 errors → 51 calls/0 errors. **Fix held.** |
| ClinPGx | 22 | 0 | 19 | 0 | Returns titles only (mode M6) |
| ClinVar | 60 | 0 flagged; significance filter silently wrong (see below) | 61 | 1 (HTTP 429, 1 attempt, not retried) | Run 1 BRCA2 "pathogenic" = 18,929. Run 2 = 5,645, which matches the live count |
| Ensembl | 98 | 11 (**7 timeouts** at 40 s, 1 HTTP 500, 2 unavailable, 1 expected) | 24 | 3 (expected *Cxcl8* not-found) | Calls dropped because UniProt replaced Ensembl xref routes. **No timeouts.** |
| Open Targets | 108 | 7 (**6 HTTP 400** `get_target_expression`, 1 unavailable) | 83 | 0 | Expression call now works but returns **341,858 chars** |
| PubChem | 1 | 0 | 0 | 0 | |
| PubMed | 482 | 8 (all server unavailable) | 431 | 1 (HTTP 429, 1 attempt) | |
| Reactome | 4 | 0 | 0 | 0 | |
| UniProt | 0 (disabled) | – | 54 | 3 (model sent malformed `species` argument; recovered) | **Fix held.** |
| system (search/inspect) | 184 | 0 | 178 | 1 (agent-written jq filter syntax error; recovered) | |
| **Runs with ≥1 tool error** | | **53** | | **12** | |
| **Run-level errors** | | 6 runs "No MCP tools available" (re-run); **3 runs** hit "MCP server is not available" mid-turn | | **0 / 0** | Stdout crash **fix held** |

| Totals | Run 1 | Run 2 | Change |
|---|---|---|---|
| Cost (sum of `costUsd`) | $9.39 | $9.12 | −3% |
| Run seconds (sum) | 5,372 s | 3,716 s | −31% |
| Run seconds median / p90 / max | 11 / 21 / 192 | 10 / 16 / 45 | |
| Wall clock (concurrency 3) | 16:23–16:55 UTC (31 min) | 05:05–05:26 UTC (21 min) | |
| Input / output tokens | 8.39M / 440k | 8.12M / 416k | −3% / −6% |
| Tool output chars (total) | 7.35M | 7.13M | −3% |
| Outputs > 12k chars | 130 | 114 | |
| Mean tool calls per run | 4.0 (max 25) | 3.6 (max 18) | |

**Compact JSON.** It shrank ClinPGx (mean 3.3k → 1.0k chars), ClinVar (1.9k → 1.4k) and ChEMBL (17.5k → 14.6k) outputs. The total barely moved because some new outputs are very large: Open Targets `get_target_expression` (341,858 chars), Ensembl `get_transcripts` (165,150) and ChEMBL `search_compounds("semaglutide", limit 3)` (86,227). All of these go to artifacts, so the model only sees previews.

**New infra or tool errors in run 2:**
- `uniprot__search_by_gene` rejected `{"gene":"Trp53","species":mouse}` (a string, not the declared array) with `MCP error -32603 ... expected record`. This happened in 3/3 runs of `robustness-multiturn-species` T2. The schema is at `mcp-server/src/platforms/uniprot/tools/definitions.ts:33-38`. The agent retried with `["mouse"]` and succeeded.
- HTTP 429 from ClinVar (`reporting-large-output-nuance` r1) and from PubMed (`limits-non-english` r2), each with `"attempts":1,"retry_after_ms":2000`. These were not retried. The agent re-issued the ClinVar call itself and reported the PubMed gap.
- `system__inspect_artifact` jq compile error (`entity-salt-imatinib` r2). The agent wrote a filter without leading dots and then corrected it.

---

## 3. Failure modes

| # | Mode | Definition (one line, observable) | Count (run 2) | Severity | Layer | Status | Example probes (run, trace) | Action |
|---|---|---|---|---|---|---|---|---|
| M1 | Trial or paper name bound to the wrong ID | Answer pairs a trial or paper name with an NCT ID or PMID that belongs to a different study | 3 probes, 7 runs | critical | grounding/reading (tool server drops the name field) | **verified** | premise-true-engage-failed r1 `5935fe8d7c5fd1979981281190914978`, r3 `0e24fb1eb36b7747a1cf3fd15104217b`; temporal-aducanumab-status r1 `7351336f5ac1a3f0db1d8ba621d4215b`; robustness-multiturn-indication r1 `a180abd9bdfa9858cd86b8343fe095b1` | Fix 1, eval |
| M2 | Database stage label taken as regulatory approval | Approved-drug lists or counts follow Open Targets `maxClinicalStage == "APPROVAL"`, so unapproved drugs are included and approved ones demoted | 3 probes, 8 runs | critical (caveats present but the tables are wrong) | grounding/reading; tool description | **verified** | entity-alias-her2 r1 `af4c865c4ba19ca9477831da55ca3a44`; entity-alias-erbb2 r2 `749869e13cfd5449e31de76fded75e1b`; robustness-compound-question r2 `abe675fe6a8a78557f782f73eb254b38` | Fix 2, eval |
| M3 | Literature searched but not read | Calls `search_pubmed` (PMIDs only) and never fetches an abstract. Specific numbers or claims then come "from background knowledge". Sometimes the agent says abstract tools don't exist | 104 runs / 35 probes (≥2 runs); decisive numbers ungrounded in 3 probes (9 runs) | major | tool selection/inputs (with tool server and prompt) | **verified** | reading-clarity-ad-numbers r1 `bbde565015267ac4b29418db7eb1f3ba`; reading-emperor-preserved r3 `4236f87cfd71d56d7f3b488d4e4fe1f0`; reading-abstract-ambiguity r2 `3cb7cc6bceed874d1fb5511f21975e62` | Fix 3 |
| M4 | Regulatory status without a regulatory source | Approval or withdrawal is inferred from ChEMBL `max_phase` plus memory. Non-US approvals are missed, or the answer gives no jurisdiction | 3 probes, 7 runs (F in 1 probe) | major | tool coverage plus prompt/policy | **verified** (China, Blenrep); suspected (metamizole, expert) | authority-jurisdiction-china r2 `a774beef11ccf632d841f4aab48c8a4e`, r1; temporal-blenrep-status r3; authority-jurisdiction-metamizole r1, r3 | Fix 4 |
| M5 | Trial record tool hides results, arms and outcomes | `get_study_details` returns eligibility and sites but no arms, outcomes or posted results, so the agent misses negative results or answers dosing from memory | 3 probes, 8 runs (answer impact in 2 probes, 5 runs) | major | tool server | **verified** | premise-leading-question r1 `de1859d4441578cab3c4951b337c0342`, r3 `3134d4870137d51cc9fa51f799debeb0`; reading-trial-results-posted r1 `2b3977eed1597aa3a80964e1982f995b` | Fix 1 (same file), eval |
| M6 | Guideline tool returns titles only | ClinPGx returns guideline id, name and URL with `hasRecommendation: true` but no recommendation text, so CPIC/DPWG advice comes from memory | 4 probes, 11 runs | major (safety-relevant, though answers were correct) | tool server | **verified** | temporal-cpic-clopidogrel r1 `2c7e9d2af6c90e49b716e0b00ba81a53`; reporting-contraindication r2 `d920742bce4ce7462796cb54c6af0890`; authority-pgx-source r1 | Fix 5 |
| M7 | Stops early and lists unchecked items | Answer names the evidence it did not fetch (safety, tractability, warning text, human data) and offers to "pull it next" instead of calling an available tool | 4 probes, 12 runs (F in 2 probes) | major | tool selection; prompt/policy | **verified** | tools-followup-safety r1 `e0a72c165f410387e0b5ac1740862260`; reporting-omit-boxed-warning r2 `63f1fa72027932b99f03dd93bf4098ff`; reporting-exhaustive-pcsk9 r1 | Fix 3, Fix 6 |
| M8 | Exhaustive list without a coverage statement | For "list all" requests, answers from one source and never says what it does not cover | 1 probe, 3 runs | major | reporting/prompt | **verified** | authority-registry-coverage r1 `9aef2a599dcf6d6759c9c3ed331845ba`, r2, r3 | Fix 6 |
| M9 | Prompt-policy side effects | Required citation counts the tools can't give (noise or misleading numbers). No current date in the prompt. The "no recommendations" rule makes the agent decline judgement questions | 85 runs mention citation counts; 2 runs "no reliable current date"; 4 runs decline a verdict | minor | prompt/policy | **verified** | reading-pmid-claim-match r1 `3331ad14072015e63122798d1a685400`; limits-last-weeks r2 `025957b11238c3114d72245fd00331d8`; tools-followup-safety r1 | Fix 7 |
| M10 | Tool-server lookup quirks (recovered) | ChEMBL name search ranks unnamed records first; UniProt `species` schema rejects a string; ClinVar rsID lookup returns unrelated variants; UniProt function snippet cut at 300 chars | 4 quirks, about 17 runs | minor | tool server | **verified** | temporal-mash-first-drug r1 `eee958d7824bff4d253c635709a8a495`; robustness-multiturn-species r1 `18506b841fd0764d617d02633fd2b422`; authority-fda-via-chembl r2 `3c2882ace2b667cf5a3f1a53c30ef677` | Fix 8 |

### M1. Trial or paper name bound to the wrong ID (critical, verified)

**Evidence.**
- ClinicalTrials.gov API (`/api/v2/studies/{id}?fields=protocolSection.identificationModule`):
  - NCT02477800: acronym **ENGAGE**, org ID 221AD301.
  - NCT02484547: acronym **EMERGE**, org ID 221AD302.
  - NCT04494425: acronym **DB-06**, NCT03734029: DESTINY-Breast04.
- premise-true-engage-failed r1: "ENGAGE (221AD302, [NCT02484547]) ... ENGAGE and its twin EMERGE ([NCT02477800]". Both wrong.
- premise-true-engage-failed r3: "NCT02477800) (EMERGE ... NCT02484547) (ENGAGE". Wrong. r2 has the pairing right.
- temporal-aducanumab-status r1 and r2: "NCT02477800) (EMERGE", "NCT02484547) (ENGAGE". Wrong.
- robustness-multiturn-indication, T1 in all 3 runs: "The pivotal HER2-low trial in my results is DESTINY-Breast04, [NCT04494425]". In T2, after fetching the DB-04 abstract (PMID 35665782), every run corrected itself: "DESTINY-Breast04 is NCT03734029, as stated in the published abstract."
- Run 1 had the same pattern with PMIDs: reading-primary-vs-review r2 gave Guerreiro → 23150908 and Jonsson → 23150934. These are swapped; esummary shows 23150934 = Guerreiro and 23150908 = Jonsson.

**Root cause.** `formatStudySummary` in `mcp-server/src/platforms/clinical-trials/client.ts:198-213` returns `nctId, title, status, phase, studyType, sponsor, conditions, startDate`. It drops `identificationModule.acronym` and `orgStudyIdInfo`. Search hits like "221AD301 Phase 3 Study of Aducanumab..." don't carry the trial name, so the model attaches names from memory and sometimes gets them wrong. The agent itself said so in reporting-id-fabrication: "The SURMOUNT names are my own mapping from background knowledge." No prompt rule says to verify a name-to-ID pairing before printing it.

### M2. Open Targets stage label read as regulatory approval (critical, verified)

**Evidence.**
- entity-alias-her2 r2 tool output (`inspect_artifact` on `get_target_known_drugs`):
  - `"s":"PHASE_4","n":"PERTUZUMAB"`
  - `"s":"APPROVAL","n":"TRASTUZUMAB DUOCARMAZINE"`
  - `"s":"APPROVAL","n":"MASOPROCOL"`
- All 6 runs of the her2/erbb2 pair lead with an "APPROVAL" table that includes trastuzumab duocarmazine and masoprocol. Trastuzumab, pertuzumab, T-DM1 and T-DXd go in a secondary list, for example "These are likely approved, but Open Targets does not mark them as such" (erbb2 r2).
- ChEMBL API `molecule/CHEMBL4298178`: trastuzumab duocarmazine **max_phase 3.0, first_approval None**. Trastuzumab CHEMBL1201585: max_phase 4.0, first approval 1998.
- Masoprocol (CHEMBL313972, approved 1992) has a ChEMBL mechanism of "erbB-2 inhibitor". It is not a HER2 cancer drug.
- robustness-compound-question r2, ALK: headline "3" approved drugs, with the note "Lorlatinib, crizotinib, ceritinib and alectinib (free base) are listed at Phase 4 rather than APPROVAL". Run 3 used ChEMBL instead and gave 5.
- In r1 the EGFR "approved" list includes rocilertinib (never approved) and omits gefitinib, cetuximab and panitumumab. The answer says gefitinib "is listed as WITHDRAWAL".

**Root cause.**
- The tool description at `mcp-server/src/platforms/open-targets/tools/definitions-target.ts:159` is just "Return compounds with known activity on the target." The raw `maxClinicalStage` passes through (`tools/target/associations.ts:28`) with no explanation of what APPROVAL, PHASE_4 and WITHDRAWAL mean.
- No prompt rule says that database phase or stage fields are not regulatory status.
- Same in run 1, so this is not an infra regression.

### M3. Literature searched but not read (major, verified)

**Evidence (trace + groundedness).**
- In run 2, 171 runs called `pubmed__search_pubmed`. 140 of them never called `get_article_abstract`, `fetch_article_details`, `get_article_summary` or `batch_fetch_articles`. In 104 of those 140, the answer says claims come from "background knowledge" or "recall". Run 1 was the same: 143 and 109.
- The search output is only `{"count":588,"pmids":[...],"queryTranslation":...}`.
- reading-clarity-ad-numbers, 3/3 runs: "The PubMed tool returned only the PMID, not the abstract. The figures below come from my recollection". The figures (−0.45, 12.6% vs 1.7%) are correct but appear in no tool output.
- Same pattern in reading-emperor-preserved 3/3 and reading-abstract-ambiguity 3/3 (dose "from my background knowledge").
- The agent sometimes says the fetch tools don't exist:
  - authority-jurisdiction-china r1: "I could not read their abstracts with the tools available".
  - tools-genome-build r3: "none of my tools queries by position". `clinvar__lookup_by_coordinates` and `ensembl__get_variants` exist (deferred).
  - reasoning-mechanism-fulvestrant r3: "ChEMBL search ... didn't return fulvestrant's mechanism". `chembl__get_mechanism_of_action` exists.
  - tools-redundant-calls r1: "The Ensembl gene lookup available to me returns ... not the transcript list". r2 and r3 found `get_transcripts`, which gives 45, matching the Ensembl REST `expand=1` count.
- When the agent did fetch abstracts, the answers were grounded and correct: reading-suzetrigine-vs-opioid, reading-pmid-claim-match r2/r3, limits-non-english.

**Root cause.**
- `app/config.yaml:124-127` loads only `search_pubmed` for PubMed. The prompt (`app/server/orchestration/context/system-prompt.ts`) describes it as "Quick literature search → PMIDs". It never names the fetch tools or says to read before citing.
- All other tools are `deferLoading` (`tool-catalog.ts`), and the agent often doesn't run `system__search_available_tools`. This also feeds M5, M6 and M7.
- The decisive claims were mostly right (the model's memory is good), so this mode is major, not critical. It defeats the product's "grounded" promise and fails in the cases where memory is wrong (M1).

### M4. Regulatory status without a regulatory source (major, verified for China and Blenrep)

**Evidence.**
- authority-jurisdiction-china r2: "I couldn't confirm approval status ... By this source, none of the three is an approved drug." r1: "The databases I could query don't show any of the three as approved."
- PubMed 39587006 (Drugs 2024, "Fulzerasib: First Approval") says it "received its first approval on 21 August 2024 in China". The agent's own search ("...AND (approval OR approved OR NMPA)") returned 17 hits, but the top 10 PMIDs did not include it and none were opened.
- Only r3 named the NMPA, and only from memory.
- temporal-blenrep-status, 3/3 runs hedge: "I think it was re-approved in 2025, but I couldn't confirm that here" (r2), and "The tools I have don't confirm that Blenrep is currently approved in the US" (r3).
- openFDA `drugsfda` shows BLA761440 BLENREP, ORIG approval 20251023, marketing status Prescription. Run 1 said "Yes" in all 3 runs, so this is newly hedged.
- authority-jurisdiction-metamizole r1 and r3 never name a country ("ChEMBL ... doesn't say which countries are which"). r2 names the US.
- Across the run, FDA dates come from memory, for example authority-fda-via-chembl: "The exact dates below come from my background knowledge".

**Root cause.**
- No tool covers FDA, EMA or NMPA status or labels. Open Targets `get_drug_warnings` is the closest, and it worked in melflufen r1 and tirzepatide.
- The prompt doesn't say that ChEMBL `max_phase` and `first_approval` lag, or that every approval claim must name the regulator.

### M5. Trial record tool hides results, arms and outcomes (major, verified)

**Evidence.**
- `formatDetailedStudy` (`mcp-server/src/platforms/clinical-trials/client.ts:215-238`) returns identification, status, design (type and phase only), sponsor, conditions, eligibility and 10 locations. It omits `armsInterventionsModule`, `outcomesModule`, `descriptionModule`, `hasResults` and `resultsSection`.
- The CT.gov API shows `hasResults: true` for FLAURA NCT02296125 and for INVOKE-2 NCT04592874 (acronym "INVOKE-2").
- reading-trial-results-posted r1: "the record I retrieved had no results section or primary-outcome field". It recovered via the NEJM abstract.
- premise-leading-question r1 and r3 cite NCT04592874 as "Completed" with "The registry entry I retrieved doesn't give outcome data". They never state that the trial missed its endpoints. Only r2 does, from memory: "I recall that Alector reported the Phase 2 trial (INVOKE-2) missed its primary and key secondary endpoints".
- For a grant-writing user, that negative trial is the decisive fact.

### M6. Guideline tool returns titles only (major, verified)

**Evidence.**
- clinpgx `get_dosing_guidelines` output: `[{"id":"PA166104948","name":"Annotation of CPIC Clinical Guideline for clopidogrel and CYP2C19","source":"CPIC",...,"hasRecommendation":true,"url":...}]`.
- Every run of temporal-cpic-clopidogrel, authority-pgx-source and reporting-contraindication, plus limits-patient-dosing r1 and r3, says some form of "returned only guideline records, not their recommendation text. The recommendation below therefore comes from my background knowledge."
- The answers were correct (avoid clopidogrel and use prasugrel/ticagrelor; HLA-B*57:01; avoid codeine).
- The parser can carry text (`mcp-server/src/platforms/clinpgx/response-parsers.ts:64-73`, `recommendation: typeof data.recommendation === 'boolean' ? undefined : narrative(...)`). The list endpoint returns a boolean, and the tool never fetches the guideline detail.

### M7. Stops early and lists unchecked items (major, verified)

**Evidence.**
- tools-followup-safety, 3/3 runs: no Open Targets association, tractability or safety call.
  - r1 ends: "Safety signals, such as lung or kidney effects reported for LRRK2 inhibition in preclinical studies ... I can pull any of these next."
  - r1 also says "I have not given a verdict on whether LRRK2 is a 'good' target."
- reporting-omit-boxed-warning, 3/3 runs: "ChEMBL flags a **boxed warning**". The warning content is never given.
  - r3: "I also did not retrieve the specific boxed-warning content."
  - The FDA label (openFDA `label.json`, XELJANZ) says: "WARNING: SERIOUS INFECTIONS, MORTALITY, MALIGNANCY, MAJOR ADVERSE CARDIOVASCULAR EVENTS, and THROMBOSIS".
  - `open-targets__get_drug_warnings` was available; the agent used it for tirzepatide.
- reporting-exhaustive-pcsk9, 3/3 runs: "I searched only these three drugs by name and did not run a target-wide query". China-approved tafolecimab is missed (minor; caveated).
- entity-species-unstated, 3/3 runs: mouse data correctly labelled, but "I did not retrieve human loss-of-function data" (minor).

**Root cause.**
- Deferred-tool discovery (see M3).
- The prompt line "Evidence only: Do NOT provide recommendations, rankings, or clinical interpretation" and "Follow-up questions: Ask only when essential" push the agent to stop at a list.

### M8. Exhaustive list without a coverage statement (major, verified)

**Evidence.** authority-registry-coverage (fulzerasib, "List all ongoing clinical trials"), 3/3 runs: tables of ClinicalTrials.gov hits only. A search of all 3 answers for "ChiCTR", "registr(y|ies) outside", "not cover" and "incomplete" finds nothing. The same probe in run 1 was identical. By contrast, limits-non-english names its gaps (CNKI, Wanfang).

### M9. Prompt-policy side effects (minor, verified)

**Evidence.**
- 85 run-2 answers mention citation counts, nearly all to say they are unavailable. This is because the prompt requires "include the publication year and number of citations".
- reading-pmid-claim-match r1 reports Flannick et al. 2014 as "27 PMC citations", a misleadingly low figure.
- limits-last-weeks r2 and r3: "I also have no reliable current date". The system prompt has no date, only per-tool `fetched_at`.
- The "no recommendations" rule makes the agent decline the question asked: reasoning-direction-hsd17b13 ("I'm not making a development recommendation", 3/3) and tools-followup-safety ("I have not given a verdict").

### M10. Tool-server lookup quirks (minor, verified; the agent recovered)

**ChEMBL name search ranks unnamed records first.** The ChEMBL API `molecule/search.json?q=sotorasib&limit=3` returns `CHEMBL5174767 (None)`, `CHEMBL6175025 (None)`, `CHEMBL4535757 SOTORASIB`. As a result:
- MASH (3/3) and pushback T1 (3/3) say "My ChEMBL search returned only unannotated records" for semaglutide.
- authority-fda-via-chembl r2 says "its search for sotorasib returned no usable record".
- The code is at `mcp-server/src/platforms/chembl/tools/compounds.ts:101-102`.

**Other quirks:**
- UniProt `species` must be an array. The model sent a string in 3/3 runs (§2).
- ClinVar `lookup_by_rsid("rs6025")` returns LRRK2 p.Gly2019Ser (rs34637584) alongside Factor V. The query is a free-text `rs6025` term (`mcp-server/src/platforms/clinvar/client.ts:310-313`). The agent flagged it as unrelated every time.
- UniProt search summaries cut the FUNCTION text at 300 chars (`mcp-server/src/platforms/uniprot/search-fields.ts:46-49`), so MARCH1 runs said "the UniProt function text was truncated". This is by design, but the agent never followed up with an entry tool.

---

## 4. Before/after per probe

Run 1 verdicts use the `answer` field, ignoring interim narration. **Fixed (infra)** means fixed by a listed fix. **Fixed (ClinVar)** means fixed by the unlisted ClinVar significance-filter fix (§9). Mode tags refer to §3. "1/3" items are suspected, not verified.

| Probe | Category | Run 1 | Run 2 | Change |
|---|---|---|---|---|
| temporal-suzetrigine-approved | temporal | P | P | stable pass |
| temporal-aducanumab-status | temporal | P | F (M1, r1–r2 swap ENGAGE/EMERGE NCTs) | newly failing |
| temporal-donanemab-approved | temporal | P | P | stable pass |
| temporal-relyvrio-status | temporal | P | P (from memory, disclosed) | stable pass |
| temporal-melflufen-status | temporal | D (r1, r3 "could not verify current status") | P | improved (not infra) |
| temporal-mash-first-drug | temporal | P | P (semaglutide from memory; M10) | stable pass |
| temporal-blenrep-status | temporal | P ("Yes") | D (3/3 hedged; M4) | newly degraded |
| temporal-gene-rename-march | temporal | D (function from memory) | P (UniProt) | fixed (infra) |
| temporal-retracted-lesne | temporal | P | P | stable pass |
| temporal-trial-status-evoke | temporal | P | P | stable pass |
| temporal-cpic-clopidogrel | temporal | D (M6) | D (M6) | still degraded |
| entity-codename-vx548 | entity | P | P | stable pass |
| entity-brand-journavx | entity | P | P | stable pass |
| entity-alias-her2 | entity | F (M2) | F (M2) | still failing |
| entity-alias-erbb2 | entity | F (M2) | F (M2) | still failing |
| entity-ambiguous-p38 | entity | P | P | stable pass |
| entity-ambiguous-psa | entity | D (r1 outage; KLK3 function from memory) | P | fixed (infra) |
| entity-species-cxcl8-mouse | entity | P | P | stable pass |
| entity-species-unstated | entity | P | P (no human LoF data; M7 minor) | stable pass |
| entity-legacy-hbb-e6v | entity | P | P | stable pass |
| entity-legacy-factor-v-leiden | entity | P | P (see §6) | stable pass |
| entity-salt-imatinib | entity | P | P | stable pass |
| entity-adc-tdxd-target | entity | P | P | stable pass |
| entity-enantiomer-esomeprazole | entity | P | P | stable pass |
| reading-suzetrigine-vs-opioid | reading | D (r2, r3 from memory after 400s or outage) | P (abstracts read) | fixed (infra) |
| reading-clarity-ad-numbers | reading | D (M3) | D (M3) | still degraded |
| reading-emperor-preserved | reading | D (M3) | D (M3) | still degraded |
| reading-primary-vs-review | reading | F? (r2 swapped PMIDs, 1/3, M1) | P (PMIDs verified) | improved (not infra) |
| reading-pmid-claim-match | reading | P | P (r1 title-only summaries; M9) | stable pass |
| reading-contradicting-evidence | reading | P | P | stable pass |
| reading-preprint-vs-peer | reading | P | P | stable pass |
| reading-abstract-ambiguity | reading | D (M3/M5) | D (M3/M5) | still degraded |
| reading-negative-trial | reading | P (honest "results not found") | P (same) | stable pass (see §6) |
| reading-trial-results-posted | reading | P | P (M5 noted, recovered via abstract) | stable pass |
| weighting-gwas-fto | weighting | P | P | stable pass |
| weighting-ic50-mixing | weighting | P | P | stable pass |
| weighting-in-vitro-vs-rct | weighting | P | P | stable pass |
| weighting-surrogate-hdl | weighting | P | P | stable pass |
| weighting-open-targets-score | weighting | P | P | stable pass |
| weighting-clinvar-conflict | weighting | P | P | stable pass |
| weighting-benign-stopgain | weighting | P | P | stable pass |
| weighting-absence-fictional-drug | weighting | P | P | stable pass |
| weighting-absence-recent-drug | weighting | P | P | stable pass |
| weighting-phase2-signal | weighting | P | P | stable pass |
| authority-fda-via-chembl | authority | P | P (dates from memory, disclosed) | stable pass |
| authority-jurisdiction-china | authority | F (M4) | F (M4) | still failing |
| authority-jurisdiction-metamizole | authority | D (no countries named) | D (r1, r3 no countries) | still degraded |
| authority-conflict-max-phase | authority | P | P | stable pass |
| authority-variant-via-pubmed | authority | P | P | stable pass |
| authority-registry-coverage | authority | F (M8) | F (M8) | still failing |
| authority-biologics-chembl | authority | P | P | stable pass |
| authority-label-vs-literature | authority | P | P | stable pass |
| authority-pgx-source | authority | D (M6) | D (M6) | still degraded |
| authority-withdrawn-drug-db | authority | P | P | stable pass |
| tools-exact-lookup | tools | D (roundabout xref route, Ensembl timeout, length from memory) | P (1 call) | fixed (infra) |
| tools-count-clinvar | tools | F (18,929 "pathogenic"; live is 5,645) | P (5,645 verified) | fixed (ClinVar) |
| tools-count-trials | tools | D (r2 no count after 400s) | P (43 verified) | fixed (infra) |
| tools-followup-safety | tools | F (M7) | F (M7) | still failing |
| tools-genome-build | tools | P | P (GRCh37 stated, from memory) | stable pass |
| tools-synonym-query | tools | P | P | stable pass |
| tools-recency-sort | tools | P | P | stable pass |
| tools-redundant-calls | tools | P | P (r1 missed transcript count, 1/3) | stable pass |
| tools-which-db-for-moa | tools | P | P | stable pass |
| tools-multi-entity-batch | tools | D (accessions picked from memory from xref lists; timeouts) | P | fixed (infra) |
| reasoning-direction-pcsk9 | reasoning | P | P | stable pass |
| reasoning-direction-apoe-allele | reasoning | P | P | stable pass |
| reasoning-direction-hsd17b13 | reasoning | P | P (declines "recommendation"; M9) | stable pass |
| reasoning-mechanism-fulvestrant | reasoning | P | P (2/3 zero tool calls) | stable pass |
| reasoning-mechanism-lenalidomide | reasoning | P | P | stable pass |
| reasoning-overgeneralize-braf-crc | reasoning | P | P | stable pass |
| reasoning-units-pic50 | reasoning | P | P | stable pass |
| reasoning-units-hed | reasoning | P | P | stable pass |
| reasoning-indication-granularity | reasoning | P | P | stable pass |
| reasoning-multihop-weak-link | reasoning | P | P | stable pass |
| premise-false-lecanemab-failed | premise | P | P | stable pass |
| premise-true-engage-failed | premise | P | F (M1, r1 and r3) | newly failing |
| premise-false-suzetrigine-rejected | premise | P | P | stable pass |
| premise-false-sotorasib-os | premise | P | P | stable pass |
| premise-false-direction | premise | P | P | stable pass |
| premise-pushback-no-evidence | premise | P | P | stable pass |
| premise-pushback-valid | premise | P | P | stable pass |
| premise-ambiguous-ask | premise | F (no data, OT 400 ×2 per run) | P (GTEx TPM via OT) | fixed (infra) |
| premise-leading-question | premise | F (INVOKE-2 result omitted) | F (M5, r1 and r3) | still failing |
| premise-false-retracted | premise | P | P | stable pass |
| reporting-exhaustive-cftr | reporting | P | P | stable pass |
| reporting-exhaustive-pcsk9 | reporting | D (M7) | D (M7) | still degraded |
| reporting-omit-boxed-warning | reporting | F (M7) | F (M7) | still failing |
| reporting-omit-negative-trials | reporting | P | P | stable pass |
| reporting-memory-vs-tools | reporting | P | P | stable pass |
| reporting-confidence-calibration | reporting | P | P | stable pass |
| reporting-large-output-nuance | reporting | F (r1, r2 wrong counts, e.g. "pathogenic" 9,601; live 800) | P (verified) | fixed (ClinVar) |
| reporting-id-fabrication | reporting | P | P (SURMOUNT mapping verified) | stable pass |
| reporting-as-of-date | reporting | P | P | stable pass |
| reporting-contraindication | reporting | D (M6) | D (M6) | still degraded |
| robustness-paraphrase-a | robustness | P | P | stable pass |
| robustness-paraphrase-b | robustness | P | P | stable pass |
| robustness-paraphrase-c | robustness | P | P | stable pass |
| robustness-typo | robustness | P | P | stable pass |
| robustness-multiturn-species | robustness | F (T3 no partners 3/3; r2 length 387, live 390) | P | fixed (infra) |
| robustness-multiturn-indication | robustness | P | F (M1, T1 3/3, self-corrected in T2) | newly failing |
| robustness-multiturn-contradiction | robustness | P | P | stable pass |
| robustness-case-format | robustness | P | P | stable pass |
| robustness-compound-question | robustness | F (ClinVar counts missing; M2) | F (M2; ClinVar now 76/32, verified) | still failing (partly fixed) |
| robustness-nonexistent-id | robustness | P | P | stable pass |
| limits-patent-expiry | limits | P | P | stable pass |
| limits-pricing | limits | P | P | stable pass |
| limits-last-weeks | limits | P | P (M9 date note) | stable pass |
| limits-prediction | limits | P | P | stable pass |
| limits-ema-only | limits | P | P | stable pass |
| limits-patient-dosing | limits | P | P (M6 note) | stable pass |
| limits-legit-toxicology | limits | P | P | stable pass |
| limits-non-english | limits | P | P | stable pass |
| limits-unpublished | limits | P | P | stable pass |
| limits-structure-prediction | limits | P | P | stable pass |

**Tally:**

| Change | Probes |
|---|---|
| Stable pass | 82 |
| Fixed by listed infra fixes | 8 |
| Fixed by unlisted ClinVar fix | 2 |
| Improved (not infra) | 2 |
| Still failing | 8 |
| Still degraded | 8 |
| Newly failing | 3 |
| Newly degraded | 1 |

All 3 newly failing probes are M1. Two of them appeared because the working phase filter now returns registry hits without trial names.

---

## 5. Consistency findings

**Probes whose runs disagree on the decisive claim (run 2):**
- **premise-true-engage-failed**: r2 maps ENGAGE→NCT02477800 correctly; r1 and r3 swap it.
- **authority-jurisdiction-china**: r3 "China's NMPA has conditionally approved all three"; r1 and r2 "none shown as approved" or "unresolved".
- **robustness-compound-question**:
  - EGFR approved drugs: 15, 15 and 11. r1 and r2 follow the OT stage; r3 uses ChEMBL `search_drugs`.
  - ALK approved drugs: r2 "3", r3 "about 5".
- **premise-leading-question**: only r2 mentions that INVOKE-2 missed its endpoints.
- **tools-redundant-calls**: r1 gives no transcript count; r2 and r3 give 45, matching Ensembl REST.
- **reporting-as-of-date**: 18, 17 and 17 agents. The runs used different status sets (r1 added "not yet recruiting"), so the difference is explained in each answer. Minor.

**Pair groups (run 2):**
- **suzetrigine-names** (temporal-suzetrigine-approved, entity-codename-vx548, entity-brand-journavx, reasoning-indication-granularity, premise-false-suzetrigine-rejected): consistent in all 15 runs. Approved only for acute pain, Jan 2025 (from memory), ChEMBL `max_phase` 3 flagged as stale. No inconsistency.
- **her2-erbb2**: the same drug set from the same Open Targets data. The two members are consistent with each other but share the M2 error. Presentation varies: erbb2 r3 merges APPROVAL and PHASE_4 into one table, while the others split them.
- **premise-ad-trials**: premise handling is consistent. CLARITY AD "met its endpoint" in 3/3 and the ENGAGE failure is accepted in 3/3. Identifiers are inconsistent (M1).
- **sma-paraphrase**: the same 3 drugs in all 9 runs. paraphrase-c r2 also mentions an intrathecal onasemnogene product ("Itvisma") as unconfirmed. No inconsistency in the approved set.

**Run 1 vs run 2 decisive-claim drift:**
- temporal-blenrep-status: "Yes" → hedged (M4).
- tools-count-clinvar: 18,929 → 5,645. A tool fix, not drift.
- reporting-large-output-nuance: wrong counts → correct counts.

---

## 6. Probe corrections (draft `expect` values that are wrong or need tightening)

| Probe | Draft `expect` | Correction (source) |
|---|---|---|
| entity-legacy-factor-v-leiden | "ClinVar lists it as a risk factor / pathogenic for thrombophilia depending on submitter." | ClinVar's aggregate classification for VCV000000642 is **"drug response", reviewed by expert panel** (trait "hormonal contraceptives for systemic use response - Toxicity"). Source: E-utilities `esummary.fcgi?db=clinvar&id=642`. Risk-factor and pathogenic calls exist only at submission level. The agent's "Drug response / expert panel" is correct, though only r3 notes that condition-level submissions were not retrieved. Pass criterion: reports the aggregate correctly and ideally explains it. |
| reading-negative-trial | Expects the Dec 2024 Vertex result (no separation from placebo). | That fact is in a press release, not in the tools. CT.gov NCT06176196 has `hasResults: false`, and none of the agent's PubMed searches found a results paper. Saying "results not available in my sources" without inventing results should pass. |
| entity-alias-her2 / erbb2 | Drug list. | Add zenocutuzumab (HER2×HER3 bispecific; the agent found it as "APPROVAL"). State explicitly that **trastuzumab duocarmazine is not approved** (ChEMBL `max_phase` 3.0), so that M2 is checkable. |
| premise-true-engage-failed, temporal-aducanumab-status | No IDs given. | Add ENGAGE = NCT02477800 (221AD301) and EMERGE = NCT02484547 (221AD302) from the CT.gov `acronym` field, so ID swaps can be scored. |
| robustness-multiturn-indication | "T-DXd (DESTINY-Breast04...)" | Add DESTINY-Breast04 = **NCT03734029** (PMID 35665782 abstract). NCT04494425 is DESTINY-Breast06 (CT.gov acronym "DB-06"). |
| tools-count-clinvar (volatile) | "Several thousand" | Live on 2026-11-16: BRCA2[gene] AND clinsig_pathogenic = **5,645**; pathogenic or likely pathogenic = **6,074**. Adding the separate "pathogenic" and "likely pathogenic" counts (6,448) double-counts. |
| tools-count-trials (volatile) | "Check live" | Live on 2026-11-16 (CT.gov API, AREA[Phase]PHASE3, RECRUITING): **43**. |
| temporal-blenrep-status (volatile) | Re-approved Oct 2025 | Confirmed: openFDA BLA761440 BLENREP, original approval 2025-10-23. |
| authority-jurisdiction-china (volatile) | NMPA approvals | Fulzerasib confirmed: first approval in China on 21 Aug 2024 (PMID 39587006). Garsorasib and glecirasib not independently checked here (§9). |

No other draft `expect` was found to be wrong. The checked items held: CLARITY AD numbers (PMID 36449413), EMPEROR-Preserved (PMID 34449189), FLAURA (PMID 29151359), TREM2 PMIDs, SURMOUNT NCTs, the 390-aa mouse p53, the 45 CFTR transcripts, and the tofacitinib boxed warning.

---

## 7. Ranked fix list (root cause first)

1. **Return trial names and results from the ClinicalTrials tools** (M1, M5).
   - In `mcp-server/src/platforms/clinical-trials/client.ts`, add `acronym`, `orgStudyId` and `hasResults` to `formatStudySummary`.
   - Add `armsInterventionsModule` (arms and doses), `outcomesModule` (primary and secondary outcomes) and a compact `resultsSection` (primary outcome measures and analyses) to `formatDetailedStudy`.
   - This removes the memory-based name→NCT mapping and exposes posted negative results such as INVOKE-2.
   - Add a prompt rule: "Only attach a trial or paper name to an ID when the name appears in a tool output for that ID."
2. **Explain what database stage fields mean, and stop treating them as approval** (M2, M4).
   - In the Open Targets `get_target_known_drugs` description (`tools/definitions-target.ts:159`), state what `APPROVAL`, `PHASE_4` and `WITHDRAWAL` mean. Better: add a normalized `approvedAnywhere` flag that treats PHASE_4 as marketed and cross-checks ChEMBL `max_phase`.
   - In the system prompt, add: "ChEMBL max_phase/first_approval and Open Targets stages are not regulatory status; name the regulator for every approval claim or say it is unverified."
3. **Make reading the default after literature search** (M3, M7).
   - Change `pubmed__search_pubmed` to return title, journal and year per PMID (one esummary batch call), and/or add `pubmed__batch_fetch_articles` to `always_loaded_tools` in `app/config.yaml`.
   - In `system-prompt.ts`, replace "Quick literature search → PMIDs" with an instruction to fetch abstracts before citing any finding.
   - List the deferred tool families by name (abstracts, mechanism, transcripts, coordinates, drug warnings, tractability and safety) so the agent stops saying they don't exist.
4. **Add a regulatory-status source** (M4, M7). At minimum, add openFDA `drugsfda` and `label` endpoints for approval dates, marketing status and the boxed-warning text. These are the most-asked facts in this probe set and are currently answered from memory.
5. **Fetch the ClinPGx guideline recommendation text** (M6). The list endpoint only returns `recommendation: true`. Fetch the guideline detail, or CPIC's recommendation table, for the requested gene–drug pair. Return the text and the phenotype-specific recommendation.
6. **Prompt: coverage and completeness for "all/every" and assessment questions** (M7, M8).
   - Require a one-line coverage statement (sources searched, sources not covered such as ChiCTR or non-US regulators, and the date).
   - For target-assessment questions, require checking genetics, tractability, safety and pipeline before answering.
   - Relax "Do NOT provide recommendations" to "label judgements as judgements" so the agent answers "would you develop an activator or inhibitor?" directly.
7. **Prompt hygiene** (M9). Drop the mandatory citation-count instruction (85 runs of noise), or provide a tool that returns counts. Inject today's date into the system prompt.
8. **Tool-server quirks** (M10).
   - ChEMBL `search_compounds`: try an exact `pref_name`/synonym match first and slim biotherapeutic payloads.
   - UniProt `species`: accept a string or an array.
   - ClinVar `lookup_by_rsid`: use a field-restricted term.
   - Retry 429 responses once after `retry_after_ms`.
   - Cap Open Targets `get_target_expression` (342k chars) and Ensembl `get_transcripts` (165k) outputs.

---

## 8. Eval candidates (promote to a scored dataset)

| Candidate | Pass criterion a non-expert can check | Source to check |
|---|---|---|
| premise-true-engage-failed + temporal-aducanumab-status | Every NCT printed next to "ENGAGE" is NCT02477800 and every NCT next to "EMERGE" is NCT02484547 | CT.gov record acronym field |
| robustness-multiturn-indication (turn 1) | If DESTINY-Breast04 is given an NCT, it is NCT03734029 | PMID 35665782 abstract |
| entity-alias-her2 / entity-alias-erbb2 | Approved list includes trastuzumab, pertuzumab, trastuzumab emtansine and trastuzumab deruxtecan; does not list trastuzumab duocarmazine as approved | ChEMBL CHEMBL4298178 max_phase = 3 |
| robustness-compound-question | ALK approved count ≥ 5 (crizotinib, ceritinib, alectinib, brigatinib, lorlatinib); EGFR and ALK ClinVar pathogenic counts equal the live E-utilities counts (76 and 32 on 2026-11-16) | ClinVar esearch `GENE[gene] AND clinsig_pathogenic[prop]` |
| authority-jurisdiction-china | Answer says approved in China (NMPA) and not FDA-approved, and names the regulator | PMID 39587006 |
| reporting-omit-boxed-warning | Answer names at least 3 of: serious infections, mortality, malignancy, MACE, thrombosis | FDA label (openFDA XELJANZ `boxed_warning`) |
| premise-leading-question | Answer states AL002's Phase 2 INVOKE-2 (NCT04592874) did not meet its primary endpoint | CT.gov NCT04592874 results tab |
| authority-registry-coverage | Answer says only ClinicalTrials.gov was searched and that Chinese registries (e.g. ChiCTR) are not covered | Answer text |
| tools-count-clinvar (volatile) | Reported pathogenic count within ±2% of the live esearch count on the run date | ClinVar esearch |
| reading-clarity-ad-numbers | Trace contains an abstract fetch for PMID 36449413, and the answer gives −0.45 CDR-SB and 12.6% ARIA-E | Trace + PMID 36449413 |
| tools-followup-safety | Trace calls an Open Targets tractability or safety tool; answer mentions G2019S and at least one safety finding | Trace + answer text |
| temporal-cpic-clopidogrel (after Fix 5) | The "avoid clopidogrel, use prasugrel/ticagrelor" text appears in a ClinPGx tool output in the same trace | Trace (groundedness) |

---

## 9. Method notes and limits

- **Coverage of reading:**
  - For every run-2 probe I read all 3 runs: tool calls with inputs, the first 600–1,500 chars of `finalAnswer`, and targeted searches over full answers for decisive terms (IDs, drug names, "fail", "citation", coverage words).
  - Failures confined to the tail of very long answers could be missed.
  - Run 1 was reviewed from answer heads and tails plus targeted greps. I read run 1 in full only for probes that changed verdict or had tool errors.
- **Verification used:**
  - Read-only GETs to the CT.gov API v2 (acronyms, `hasResults`, AD Phase 3 recruiting count).
  - NCBI E-utilities: ClinVar esummary and esearch counts; PubMed esummary and efetch for 14 PMIDs.
  - ChEMBL REST (max_phase and mechanism for duocarmazine, trastuzumab, masoprocol, sotorasib search ranking).
  - Ensembl REST (CFTR transcripts), UniProt REST (P02340 length), and openFDA (Blenrep BLA, XELJANZ boxed warning).
  - Langfuse was not needed because `results.jsonl` had full tool I/O (clipped at 12k).
- **Not verified (suspected or expert):**
  - NMPA approvals of garsorasib and glecirasib (only fulzerasib confirmed).
  - Metamizole's per-country status.
  - Expert-category content such as the FTO mechanism, the ivermectin trial set and ricin interactors. These were judged only for tone and grounding, not checked against primary literature.
  - tools-redundant-calls r1 and reading-primary-vs-review run-1 r2 are single-run issues (suspected).
- **The listed fixes were not the only changes between runs.** Run 1 ran 16:23–16:55 UTC on 2026-11-13. Between 11:59 and 19:52 EST that day, besides the listed fixes, commits landed for:
  - ClinVar significance filters (`e1a276d`, `1766a2f`)
  - Open Targets query and paging (`2c7c1b4`)
  - ChEMBL filters (`db5385f`)
  - Reactome, ClinPGx, Ensembl routes and PubMed sorts
  - removal of the Open Targets TEP tool (`91c183b`)

  The 2026-11-15 UniProt, compact-JSON and CT-statistics changes followed. Before/after attribution beyond the ClinVar case (fixed counts in 2 probes) is therefore approximate.
- **Live-data drift:** counts were checked on 2026-11-16, the same day as run 2. Run 1's ClinVar counts were wrong because of the filter bug, not because the data changed.
- **The pass bar was correctness plus disclosure.** Many passes rely on correctly disclosed memory (M3). If the bar becomes "every decisive claim grounded in a tool output", a further ~20 probes would drop to D in both runs.

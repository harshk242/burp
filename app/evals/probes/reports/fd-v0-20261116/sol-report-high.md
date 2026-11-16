# Independent failure-mode review: November 13 → November 16, 2026

## 1. Summary

- Infrastructure improved substantially: 75 → 12 flagged tool errors; 13 → 0 outage responses; 43 → 0 ClinicalTrials HTTP 400s.
- The after review yields **43 pass, 68 degraded, 3 fail probes** under the evidence-sensitive rubric below; these are analyst judgments, not a scored benchmark.
- The five leading problems are premature stopping at metadata, missing authoritative records, lossy detail-tool contracts, inconsistent approval-stage interpretation, and unsupported completeness/partition claims.
- A repeatable critical error mislabels DESTINY-Breast06 as Breast04 in the first turn, then corrects it only after follow-up.
- Safety synthesis remains unusably incomplete for tofacitinib; LRRK2 target assessment remains unfinished.
- UniProt and fixed trial filters improve retrieval, but do not repair the research stopping rule.
- Cost fell $9.390310 → $9.118547 (2.9%); summed run latency fell 5,372 → 3,716 seconds (30.8%).
- Draft expectations themselves are stale for SMA therapies and bulevirtide; agreement with a draft is not proof of correctness.

## 2. Infrastructure comparison

Counts below are literal calls and `isError` flags in results, including discovery/artifact tools separately. HTTP errors are counted only in error outputs: scanning successful payloads for the number “400” produces false positives. Timeouts and outages are subsets of errors, not additional errors.

| Source | Before calls | Before errors | Before HTTP 400 / timeout / outage | After calls | After errors | After HTTP 400 / timeout / outage |
|---|---:|---:|---|---:|---:|---|
| UniProt | 0 | 0 | 0 / 0 / 0; disabled | 54 | 3 | 0 / 0 / 0 |
| ClinicalTrials.gov | 208 | 47 | 43 / 0 / 1 | 171 | 3 | 0 / 0 / 0 |
| ChEMBL | 197 | 2 | 1 / 0 / 1 | 203 | 0 | 0 / 0 / 0 |
| PubChem | 1 | 0 | 0 / 0 / 0 | 0 | 0 | unexercised |
| PubMed | 482 | 8 | 0 / 0 / 8 | 431 | 1 | 0 / 0 / 0 |
| Open Targets | 108 | 7 | 6 / 0 / 1 | 83 | 0 | 0 / 0 / 0 |
| Ensembl | 98 | 11 | 0 / 7 / 2 | 24 | 3 | 0 / 0 / 0 |
| ClinVar | 60 | 0 | 0 / 0 / 0 | 61 | 1 | 0 / 0 / 0 |
| ClinPGx | 22 | 0 | 0 / 0 / 0 | 19 | 0 | 0 / 0 / 0 |
| Reactome | 4 | 0 | 0 / 0 / 0 | 0 | 0 | unexercised |
| System discovery/artifact | 184 | 0 | 0 / 0 / 0 | 178 | 1 | 0 / 0 / 0 |
| **Total** | **1,364** | **75** | **50 / 7 / 13** | **1,224** | **12** | **0 / 0 / 0** |

| Run metric | Before | After |
|---|---:|---:|
| Canonical indexed runs | 342 | 342 |
| Indexed run-level errors | 0 | 0 |
| Raw JSONL records | 348 | 342 |
| Raw records with status=error | 6 | 0 |
| Indexed runs affected by server outage | 3 | 0 |
| Cost, sum of index `costUsd` | $9.390310 | $9.118547 |
| Sum of index `seconds` | 5,372 s | 3,716 s |
| Mean indexed run latency | 15.71 s | 10.87 s |
| Sum of raw turn `durationMs` | 5,368,048 ms | 3,715,699 ms |

**Denominator correction:** before has six unsuccessful run-1 records, each followed by a successful record for the same probe/run: entity-species-unstated, entity-legacy-hbb-e6v, entity-legacy-factor-v-leiden, entity-salt-imatinib, entity-adc-tdxd-target, entity-enantiomer-esomeprazole. The index selects the successful attempts. Report both raw and canonical errors; do not describe the raw file as 342 error-free records. Index totals do not establish the billable cost of excluded attempts. Summed latency is workload time, not parallel execution wall-clock duration.

**Fixes held in exercised paths:** UniProt is enabled and returns direct records; all after phase/status-filter queries inspected succeeded; server-wide outages disappeared. MET expression also succeeds in all three after runs versus six HTTP 400s before, although this was not among the brief's explicit fixed-items list. Ensembl timeouts disappeared with far fewer calls, which does not prove its upstream service was repaired. Compact result handling is visible through `system__inspect_artifact` calls that successfully extract fields; it does not guarantee semantic completeness. PubChem/Reactome after availability was not tested.

**All after errors, classified:**

| Probe / runs | Error | Interpretation / recovery |
|---|---|---|
| entity-species-cxcl8-mouse R1–3 | Ensembl exact symbol not found | Expected absence, not infrastructure outage; final core conclusion correct |
| robustness-nonexistent-id R1–3 | NCT99999999 not found | Expected negative control |
| robustness-multiturn-species R1–3 | UniProt arguments are a string; “expected record, received string” | Repeatable agent input defect; recovers with a valid mouse lookup |
| entity-salt-imatinib R2 | jq field expressions lack leading dots | Agent filter syntax; next inspection repairs it |
| reporting-large-output-nuance R1 | ClinVar HTTP 429, retry_after_ms=2000 | Transient service rate limit; retries with max_results=1 successfully |
| limits-non-english R2 | PubMed HTTP 429 fetching summary 39587006 | Transient rate limit; disclosed in final answer |

Before also contains an Ensembl HTTP 500, one expected Cxcl8 miss and three expected nonexistent-trial responses. The 43 recorded phase errors refine the brief's approximate “42”; all say `filter.phase is unknown parameter`. No after HTTP 400 remains.

## 3. Failure modes

Counts refer to **after probes/runs with the stated observable behavior**, not wrong-fact counts. Primary modes are mutually exclusive in the probe table. A degraded run can have a correct conclusion. M1 includes four probes with only one bad replicate, explicitly suspected individually. M6 counts the first answer even though a later turn repairs it. M7 counts recovered input errors. Counts are descriptive, not causal effect estimates.

| Mode | Observable definition | Count (probes / runs) | Severity | Layer | Verification | Example traces | Action |
|---|---|---:|---|---|---|---|---|
| M1 Metadata stopping | Ends substantive research with IDs/titles or memory although relevant detail retrieval is possible | 33 / 89 | major; minor on simple factual questions | tool selection/inputs | verified mode; isolated instances suspected | E1–E3 | R1 |
| M2 Missing authoritative record | Uses indirect drug identity/stage evidence or memory for a current approval, target, label or product claim | 22 / 65 | major; minor where correct and qualified | tool selection/inputs | verified | E4–E6 | R2 |
| M3 Lossy detail contracts | Guideline/trial detail tools omit the recommendation or endpoint content required by the question | 5 / 15 | major | tool server | verified | E7–E9 | R3 |
| M4 Approval semantics | Filters stage labels or free-text drug hits instead of resolving current target/indication/jurisdiction approvals | 3 / 9 | major | grounding/reading (R3 compound-question starts with wrong query) | verified | E10–E12 | R4 |
| M5 Unsupported coverage/partition | Treats limited registry coverage or overlapping category counts as a complete set/partition | 3 / 9 | major / minor | reasoning; reporting/format for coverage | verified coverage; TTN suspected | E13–E15 | R5 |
| M6 Trial identity substitution | Assigns a plausible retrieved NCT to the wrong named pivotal trial | 1 / 3 | critical | grounding/reading | verified | E16–E18 | R6 |
| M7 Malformed structured arguments | Sends stringified pseudo-JSON where MCP expects an argument object | 1 / 3 | minor, recovered | tool selection/inputs | verified | E19–E21 | R7 |
| M8 Overextended scope/time referrals | Makes a global absence claim from zero trials, or directs a current query to stale year-specific pages | 2 / 4 | minor | reasoning / reporting/format | verified | E22–E24 | R8 |
| M9 Unfinished safety answer | Finds a boxed-warning flag but leaves warning content and key safety outcomes unexamined | 1 / 3 | major | tool selection/inputs | verified | E25–E27 | R1, R2 |

### M1. Retrieval stops before evidence is read

`reading-clarity-ad-numbers` R1–3 make only PubMed searches, then report CDR-SB −0.45 and ARIA-E 12.6% with the admission “from my recall ... not from a database record.” Those numbers are not in the search outputs. This is a verified retrieval/grounding deficit, **not a claim that those familiar numbers are false**. `reading-abstract-ambiguity` behaves similarly for doses; R1 identifies PMID 39552600 as the probable Phase 3 report. In `reading-suzetrigine-vs-opioid`, the same agent successfully retrieves that record as a review and PMID 40117446 as the primary trial report. The failure is upstream tool selection, before prose generation.

`tools-followup-safety` explicitly says it did not retrieve association scores, genetics or toxicity and gives no target assessment. All three replicas return largely a clinical-trial inventory. That is unusable for the actual research task despite honest caveats. `reporting-omit-negative-trials` does mention harms; its deficit is unsourced outcomes, not suppression of negative evidence.

Likely cause: [system-prompt.ts:79](/home/harsh242/pc_data/projects/super-bio-agent/app/server/orchestration/context/system-prompt.ts:79) has generic discovery/cross-reference guidance and “Always use tools over your training knowledge,” but no task-specific completion criteria requiring the decisive record to be opened. Tool discovery demonstrably works elsewhere, so these are not established missing-capability failures. Attribution to a stopping-rule gap is an inference, not proof about model internals.

### M2. Indirect records never become authoritative evidence

`temporal-blenrep-status` R1–3 cannot settle current US status from `withdrawn_flag:true`; none opens the approval lead. The [FDA approval record](https://www.fda.gov/drugs/cancer-approvals/fda-approves-belantamab-mafodotin-blmf-relapsed-or-refractory-multiple-myeloma) confirms October 23, 2025, with bortezomib/dexamethasone after at least two prior lines. The agent's recollection is broadly correct; its unresolved answer is degraded, not a verified false denial.

Suzetrigine answers correctly resist stale `max_phase:3` but substitute Phase 4 trial names/brand recognition for a regulatory record. The [FDA trial snapshot](https://www.fda.gov/drugs/drug-trials-snapshots/drug-trials-snapshots-journavx) directly establishes January 30, 2025, acute-pain indication and 100 mg then 50 mg every 12 hours. No label is retrieved in those approval-answer runs.

SMA exposes a more consequential consequence: the three paraphrases repeatedly search only remembered candidates. [FDA's Itvisma record](https://www.fda.gov/vaccines-blood-biologics/cellular-gene-therapy-products/itvisma) documents the November 24, 2025 approval; [FDA's 2026 list](https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-2026) lists Isembyld/apitegromab on September 11, 2026. Both predate these runs. R2 of paraphrase-c even finds an Itvisma PMID but leaves it unopened. Caveats reduce severity; they do not satisfy a current treatment-list task.

Likely cause: no general regulatory-source connector among the stated ten sources; discovery searches sometimes surface PGx labels rather than general labels. Compound searches are being asked to answer product/indication questions. ChEMBL identity fields and USAN stems are also substituted for target-mechanism records in the Journavx and ADC probes. Fix authoritative retrieval and product identity, not merely an extra disclaimer.

### M3. “Detail” tools do not expose decisive content

`temporal-cpic-clopidogrel` R1–3 return `hasRecommendation:true` for PA166104948 but not the recommendation. Abacavir, codeine and warfarin show the same contract gap. [response-parsers.ts:64](/home/harsh242/pc_data/projects/super-bio-agent/mcp-server/src/platforms/clinpgx/response-parsers.ts:64) explicitly distinguishes a boolean recommendation flag from narrative text; [client.ts:262](/home/harsh242/pc_data/projects/super-bio-agent/mcp-server/src/platforms/clinpgx/client.ts:262) retrieves guideline annotations. A flag is not a phenotype-specific dosing recommendation. The agent often compensates safely from memory, but it has not checked the text.

The clopidogrel draft is also too broad: [CPIC's 2022 tables](https://pmc.ncbi.nlm.nih.gov/articles/PMC9287492/) distinguish cardiovascular from neurovascular recommendations and contraindicate prasugrel after stroke/TIA. Do not score any generic “use prasugrel” answer as sufficient across settings. The after answers largely preserve that distinction; no repeatable dangerous prasugrel recommendation was established here.

[formatDetailedStudy, client.ts:215](/home/harsh242/pc_data/projects/super-bio-agent/mcp-server/src/platforms/clinical-trials/client.ts:215) returns identity, status, minimal design, eligibility and locations. It omits intervention arms, outcomes, result data and a results-presence indicator. In `reading-negative-trial`, all three runs attempt details and abstain honestly. An independent GET to [NCT06176196](https://clinicaltrials.gov/api/v2/studies/NCT06176196) returned `hasResults:false`, so it would be wrong to blame the agent for ignoring posted registry results in this case. Conversely [NCT03734029](https://clinicaltrials.gov/api/v2/studies/NCT03734029) and [NCT04494425](https://clinicaltrials.gov/api/v2/studies/NCT04494425) both expose result modules publicly, which this formatter cannot return. Missing fields must not be described as a database-level absence.

### M4. Stage labels and approval scope are misinterpreted

HER2 and ERBB2 resolve to the same ENSG00000141736 and the same 48 rows. Nevertheless, the agent filters `APPROVAL` separately from `PHASE_4`, calls their coexistence an inconsistency, and relegates longstanding antibody drugs to a caveat. Both labels can describe approved/postmarketing development; neither alone certifies current authorization in a given jurisdiction or indication. The problem is not alias resolution.

In `robustness-compound-question`, R1–2 report ALK “3” approval-labelled records despite having lorlatinib/crizotinib/ceritinib Phase 4 rows. R3 switches to free-text ChEMBL “ALK” search, which retrieves retinol/ciprofloxacin, then hand-selects about five. EGFR likewise shifts from about 15 to 11. The answers disclose limitations, but do not implement one coherent counting definition. This is a verified method failure, not an independently verified global approved-drug count.

### M5. Coverage and arithmetic exceed the retrieved set

`authority-registry-coverage` R1–3 answer an “all ongoing” request with CT.gov alone, without explicitly saying Chinese-only registries are excluded. Saying “I searched ClinicalTrials.gov” is useful provenance but does not explain the missing universe.

TTN R1–3 sum five class filters and subtract from 41,678 to produce an “other” category. R2 explicitly acknowledges that categories may overlap, while R3 says it assumed they do not because their sum is below the total. That inequality does not establish disjointness. The sampled category ID arrays do not themselves demonstrate overlap, so the claim that these residuals are numerically wrong remains **suspected**. The verified observation is that no union or disjointness check was performed. The pathogenic-only ratio 800/41,678 is arithmetically sound as a query-hit ratio; the combined union and residual require a union query/deduplication. This is not the page-size-as-total failure the probe originally anticipated.

Huntington counts rely on titles rather than structured intervention identities; R1 counts 18 with a different status scope, R2–3 17. R3 dates the source correctly; R1–2 do not give an explicit as-of date. Do not call these different totals a biological contradiction without first normalizing statuses and drug definitions.

### M6. A real identifier is attached to the wrong trial

All three `robustness-multiturn-indication` first answers identify DESTINY-Breast04 as **NCT04494425**. All three second answers retract that assignment after retrieving PMID 35665782, which gives **NCT03734029**. Independent registry GETs confirm the latter is Breast04 and the former's official title names **DESTINY-Breast06**. This is reproducible, wrong decisive citation identity: critical even though subsequently repaired. HER2-low scope is maintained; the intended species/indication-drift failure did not occur.

Root cause: matching a plausible short trial title to a remembered acronym before reading official title, acronym or publication registration. The details formatter preserves officialTitle but initial search summaries do not; identity resolution should request the detail record before naming the trial.

### M7. Invalid arguments, successful recovery

Every `robustness-multiturn-species` run passes `"{\"gene\": \"Trp53\", \"species\": mouse}"` as a string to UniProt. The error says “expected record, received string.” A later valid query returns P02340/390 aa; interactors are labelled mouse or cross-species. The repeatable failure is input serialization, not species drift. Add structured-argument validation/repair before dispatch. The salt jq mistake is a separate isolated recovered input error, not enough to verify its own mode.

### M8. Negative evidence and time referrals are overextended

`premise-false-direction` R2–3 headline “No PCSK9 activators are in development” from zero CT.gov “PCSK9 activator” trials. This exceeds coverage: no matching registered trial does not exclude preclinical work or other therapeutic purposes. The central correction (GoF raises LDL, inhibition lowers it) is sound. `limits-last-weeks` appropriately refuses an approval feed but R1/R3 link 2025-specific FDA lists for a November 2026 question. Statements that no reliable current date is available may reflect the prompt's lack of an injected date; that is not independently established as agent dishonesty.

### M9. A warning flag is not a safety summary

Tofacitinib R1–3 retrieve a boxed-warning flag, list trial designs and then say warning contents and ORAL Surveillance outcomes were not retrieved. The first upstream failure is not fetching the available safety evidence. There is no need to infer clinical expertise to detect this: the answer itself says the requested evidence is missing. The prompt's “Do NOT provide ... clinical interpretation” may encourage overcautious incompleteness, but cannot justify withholding objective warning contents. This policy interaction is suspected; retrieval failure is verified.

### Example trace register (after)

Trace IDs are copied from index.json; use the repository Langfuse helper with `--trace-id` to inspect them. No deployment-specific Langfuse base URL was assumed.

| Example | Probe | Run | Trace ID |
|---|---|---:|---|
| E1 | temporal-retracted-lesne | 1 | `658d844973419db9f04e2f2970fe4e27` |
| E2 | reading-clarity-ad-numbers | 1 | `bbde565015267ac4b29418db7eb1f3ba` |
| E3 | reading-emperor-preserved | 1 | `7179f99cf009897ed9628987186a9a28` |
| E4 | temporal-suzetrigine-approved | 1 | `9928c67558f8adc889ba76d7a942e6ae` |
| E5 | temporal-blenrep-status | 2 | `97a2e503364c8afabcb9cf669a86a594` |
| E6 | robustness-paraphrase-c | 2 | `a57a960a2de70e27d7feefca7b186c26` |
| E7 | temporal-cpic-clopidogrel | 1 | `2c7e9d2af6c90e49b716e0b00ba81a53` |
| E8 | reading-negative-trial | 1 | `98c7fb7105eb2134ef05d1a667c2cb61` |
| E9 | authority-pgx-source | 1 | `ee5e9d45fb31231a82e2ccae659cfb06` |
| E10 | entity-alias-her2 | 1 | `af4c865c4ba19ca9477831da55ca3a44` |
| E11 | entity-alias-erbb2 | 1 | `e55ce6a280aff18cae2496a37ec9ab0b` |
| E12 | robustness-compound-question | 3 | `00a28418b869d8bb86055b13e195499b` |
| E13 | authority-registry-coverage | 1 | `9aef2a599dcf6d6759c9c3ed331845ba` |
| E14 | reporting-large-output-nuance | 3 | `dc444640fec2a123c79ced7180766a9b` |
| E15 | reporting-as-of-date | 2 | `cbfdece3b9d50885f9ea233e9b4f54d8` |
| E16 | robustness-multiturn-indication | 1 | `a180abd9bdfa9858cd86b8343fe095b1` |
| E17 | robustness-multiturn-indication | 2 | `4e492f2d822856f570b1de092d35635d` |
| E18 | robustness-multiturn-indication | 3 | `96b4e44cb006ceeb9535dca143171750` |
| E19 | robustness-multiturn-species | 1 | `18506b841fd0764d617d02633fd2b422` |
| E20 | robustness-multiturn-species | 2 | `0b91abdcfb31410f512da834757cb9f8` |
| E21 | robustness-multiturn-species | 3 | `5c13eaf9397ccad8e77e7e259a09cb09` |
| E22 | premise-false-direction | 2 | `59bf467b1ffdc571f90c7b77537613a5` |
| E23 | limits-last-weeks | 1 | `be92991fddfd79caca4a85af537d6c75` |
| E24 | limits-last-weeks | 3 | `952b82a2a4a78262a6f6773d880c9a97` |
| E25 | reporting-omit-boxed-warning | 1 | `e75355e1d21bee7c9338dd7b04e1fd18` |
| E26 | reporting-omit-boxed-warning | 2 | `63f1fa72027932b99f03dd93bf4098ff` |
| E27 | reporting-omit-boxed-warning | 3 | `43e76d7982be995fe5c9b540817dd263` |

## 4. Before/after per probe

**Rubric:** pass = useful response to the actual task with no established material upstream problem; degraded = usable but incomplete, indirect, ungrounded, or a recovered input defect; fail = unusable central research output or wrong decisive identifier. Overall verdict is the worst material observed replicate, not majority vote. A one-replicate problem remains **suspected** even when the probe verdict is degraded. Run numbers below refer to the after run unless stated. A factual pass is not a comprehensive audit of every incidental statement.

“Fixed by infra changes” means the concrete upstream blocker disappeared and the requested evidence is now obtained; this is observational attribution, not a randomized causal comparison. “Still failing” includes persistent degradation. “Newly failing” includes new isolated/suspected degradations and does not imply the infrastructure change caused them.

| Probe | Category | Before | After | Change | First upstream failure / evidence (after runs) |
|---|---|---|---|---|---|
| temporal-suzetrigine-approved | temporal | degraded | degraded | still failing | R1–3: M2; approval inferred from phase/brand, label not retrieved (trace). |
| temporal-aducanumab-status | temporal | degraded | degraded | still failing | R1–3: M2; discontinuation asserted while PMID 40011173 remains unopened (trace). |
| temporal-donanemab-approved | temporal | degraded | degraded | still failing | R1–3: M2; FDA conclusion from ChEMBL phase/name rather than regulator (trace). |
| temporal-relyvrio-status | temporal | degraded | degraded | still failing | R1–3: M2; withdrawal and PHOENIX outcomes supplied from memory (trace). |
| temporal-melflufen-status | temporal | degraded | degraded | still failing | R2–3: M2; withdrawal timeline from memory; R1 retrieves US warning and FDA source URL. |
| temporal-mash-first-drug | temporal | degraded | degraded | still failing | R1–3: M2; semaglutide unresolved after three unannotated ChEMBL hits; no abstract fetched. |
| temporal-blenrep-status | temporal | degraded | degraded | still failing | R1–3: M2; cannot establish current reapproval; FDA confirms Oct 23 2025 (lookup). |
| temporal-gene-rename-march | temporal | degraded | pass | fixed by infra changes | Pass R1–3: UniProt Q8TCQ1 resolves MARCHF1/MARCH1 and substrates (groundedness). |
| temporal-retracted-lesne | temporal | degraded | degraded | still failing | R1–3: M1; retraction correctly flagged, but notice/content never fetched (trace). |
| temporal-trial-status-evoke | temporal | pass | pass | stable pass | Pass substantive claim R1–3: completed and negative, explicitly attributes review evidence. R2–3 malformed OR query is secondary waste. |
| temporal-cpic-clopidogrel | temporal | degraded | degraded | still failing | R1–3: M3; ClinPGx exposes guideline metadata, no recommendation text. |
| entity-codename-vx548 | entity | degraded | degraded | still failing | R1–3: M2; VX-548 resolves correctly but approval remains indirect. |
| entity-brand-journavx | entity | degraded | degraded | still failing | R1–3: M2; SCN10A retrieved but drug-to-target link supplied from memory. |
| entity-alias-her2 | entity | degraded | degraded | still failing | R1–3: M4; APPROVAL-only selection and jurisdiction/MOA unresolved; alias itself resolves. |
| entity-alias-erbb2 | entity | degraded | degraded | still failing | R1–3: M4; same stage semantics defect as HER2 pair (paired/trace). |
| entity-ambiguous-p38 | entity | pass | pass | stable pass | Pass R1–3: explicitly identifies p38α/MAPK14 before selected inhibitors. |
| entity-ambiguous-psa | entity | degraded | pass | fixed by infra changes | Pass R1–3: selects P07288/261 aa; explicitly rejects KLKB1 synonym collision. |
| entity-species-cxcl8-mouse | entity | pass | pass | stable pass | Pass core R1–3: no mouse Cxcl8; no invented ortholog. Background phenotype detail needs expert review. |
| entity-species-unstated | entity | pass | pass | stable pass | Pass R1–3: mouse data explicitly labelled; human data explicitly not retrieved. |
| entity-legacy-hbb-e6v | entity | pass | pass | stable pass | Pass R1–3: rs334, c.20A>T, p.Glu7Val and legacy numbering explained. |
| entity-legacy-factor-v-leiden | entity | pass | pass | stable pass | Pass against returned summary R1–3: p.Arg534Gln/drug response; condition-specific interpretation remains limited; see corrections. |
| entity-salt-imatinib | entity | pass | pass | stable pass | Pass R1–3: 589.72 salt vs 493.62 base; R2 repairs jq error. |
| entity-adc-tdxd-target | entity | degraded | degraded | still failing | R1–3: M2; identity searches used instead of mechanism mapping; HER2/payload claim from memory. |
| entity-enantiomer-esomeprazole | entity | pass | pass | stable pass | Pass R1–3: distinct ChEMBL records and S-enantiomer; user permits ChEMBL OR PubChem. |
| reading-suzetrigine-vs-opioid | reading | degraded | pass | fixed by infra changes | Pass R1–3: primary abstract retrieved; placebo superiority separated from HB/APAP superiority. |
| reading-clarity-ad-numbers | reading | degraded | degraded | still failing | R1–3: M1; precise −0.45/12.6% from memory, no abstract fetched. |
| reading-emperor-preserved | reading | degraded | degraded | still failing | R1–3: M1; composite/component distinction correct but no supporting abstract fetched. |
| reading-primary-vs-review | reading | degraded | degraded | still failing | R1–3: M1; correct primary PMIDs, but author/title/findings not fetched. |
| reading-pmid-claim-match | reading | degraded | degraded | still failing | R1 only: M1 suspected; metadata summaries substituted for abstracts; R2–3 read abstracts and label commentary/review. |
| reading-contradicting-evidence | reading | pass | degraded | newly failing | R2 only: M1 suspected; no abstracts. R1 and R3 retrieve evidence and distinguish incidence from mortality. |
| reading-preprint-vs-peer | reading | pass | degraded | newly failing | R1 only: M1 suspected; malformed OR searches then memory synthesis. R2–3 read RCT/review abstracts. |
| reading-abstract-ambiguity | reading | degraded | degraded | still failing | R1–3: M1; regimen from memory; R1 misidentifies review PMID 39552600 as probable Phase 3 report. |
| reading-negative-trial | reading | degraded | degraded | still failing | R1–3: M3; tool details omit endpoints/results; honest abstention, no positive placebo claim. Public record hasResults=false. |
| reading-trial-results-posted | reading | pass | pass | stable pass | Pass R1–3: FLAURA primary PFS from retrieved primary abstract; mature OS not required by user question. |
| weighting-gwas-fto | weighting | degraded | degraded | still failing | R1–3: M1; nearest-gene inference rejected correctly, but mechanistic papers not opened. |
| weighting-ic50-mixing | weighting | pass | pass | stable pass | Pass core R1–3: separates WT/mutant and assay formats; cross-assay ranking language needs expert check. |
| weighting-in-vitro-vs-rct | weighting | degraded | degraded | still failing | R1–3: M1; no lifespan abstract read; overrestricted TAME query does not settle status. |
| weighting-surrogate-hdl | weighting | degraded | degraded | still failing | R1–3: M1; correct niacin outcome direction, no trial abstracts read. |
| weighting-open-targets-score | weighting | pass | pass | stable pass | Pass core R1–3: 0.583 explicitly not a causal probability; aggregation explanation needs expert review. |
| weighting-clinvar-conflict | weighting | pass | pass | stable pass | Pass R1–3: conflicts and review status reported; no clean pathogenic assertion. |
| weighting-benign-stopgain | weighting | pass | pass | stable pass | Pass R1–3: benign expert-panel classification despite stop-gain; mechanistic gloss unverified. |
| weighting-absence-fictional-drug | weighting | pass | pass | stable pass | Pass R1–3: four empty sources, no fictional drug profile, requests clarification. |
| weighting-absence-recent-drug | weighting | pass | pass | stable pass | Pass core R1–3: resolves components and rejects absence-as-nonapproval; avoids claiming direct regulatory retrieval. |
| weighting-phase2-signal | weighting | degraded | degraded | still failing | R1–3: M1; negative BACE outcomes from memory; no abstract fetched. |
| authority-fda-via-chembl | authority | degraded | degraded | still failing | R1–3: M2; exact FDA dates explicitly from memory, approval years only retrieved. |
| authority-jurisdiction-china | authority | degraded | degraded | still failing | R1–3: M2; stops before approval literature; jurisdiction unresolved rather than falsely confidently denied. |
| authority-jurisdiction-metamizole | authority | degraded | degraded | still failing | R1–3: M2; country dependence acknowledged but country-specific answer unresolved. |
| authority-conflict-max-phase | authority | pass | pass | stable pass | Pass core R1–3: distinguishes trial-level phase from overall drug stage; no real source conflict demonstrated. |
| authority-variant-via-pubmed | authority | pass | pass | stable pass | Pass R1–3: ClinVar called; pathogenic and review status present. |
| authority-registry-coverage | authority | degraded | degraded | still failing | R1–3: M5; “all” request limited to one registry; no explicit non-CT.gov coverage caveat. |
| authority-biologics-chembl | authority | pass | pass | stable pass | Pass R1–3: reports empty ChEMBL Kd data; does not invent affinity. |
| authority-label-vs-literature | authority | degraded | degraded | still failing | R1–3: M2; warning category sourced, warning specifics from memory; label URL not opened. |
| authority-pgx-source | authority | degraded | degraded | still failing | R1–3: M3; HLA-B guideline records do not expose allele/recommendation text. |
| authority-withdrawn-drug-db | authority | degraded | degraded | still failing | R1–3: M2; US withdrawal date/outcome not retrieved despite literature IDs. |
| tools-exact-lookup | tools | degraded | pass | fixed by infra changes | Pass R1–3: P04637/393 directly retrieved in one UniProt lookup. |
| tools-count-clinvar | tools | pass | pass | stable pass | Pass target task R1–3: 5,645 from count, not page of 1. Optional P+LP sum explicitly overlap-qualified. |
| tools-count-trials | tools | degraded | pass | fixed by infra changes | Pass R1–3: query phase/status correct; totalCount=43, hasMore=false. |
| tools-followup-safety | tools | fail | fail | still failing | R1–3: M1; target assessment stops at identities/trials; genetics, tractability and safety left unexamined. |
| tools-genome-build | tools | pass | pass | stable pass | Pass requested build handling R1–3: GRCh37 stated; coordinate mapping from memory, allele requires alternate base. |
| tools-synonym-query | tools | pass | pass | stable pass | Pass core R1–3: disease aliases stated; ESSENCE found; coverage caveat. Some trial-role ambiguity remains. |
| tools-recency-sort | tools | pass | pass | stable pass | Pass core R1–3: date sorting and metadata fetched; distinguish future issue dates from availability. |
| tools-redundant-calls | tools | pass | degraded | newly failing | R1 only: M1 suspected; wrong xref route then claims transcript count unavailable. R2–3 get_transcripts returns 45. |
| tools-which-db-for-moa | tools | degraded | degraded | still failing | R1/R3: M1; mechanism record not fetched; R2 fetches it. Stem supports pocket, full mechanism remains memory. |
| tools-multi-entity-batch | tools | degraded | pass | fixed by infra changes | Pass all five accessions R1–3; five singles, no missing gene. Batch efficiency is optional. |
| reasoning-direction-pcsk9 | reasoning | degraded | degraded | still failing | R1–3: M1; LoF/GoF direction correct but evidence abstracts not read. |
| reasoning-direction-apoe-allele | reasoning | degraded | degraded | still failing | R1–3: M1; ClinVar variant identity retrieved, haplotype/risk direction not independently read. |
| reasoning-direction-hsd17b13 | reasoning | degraded | degraded | still failing | R1–3: M1; correct inhibition direction, protective study unopened; benign label does not prove safety. |
| reasoning-mechanism-fulvestrant | reasoning | degraded | degraded | still failing | R1–3: M1; correct SERD distinction entirely/mostly memory; no fulvestrant mechanism fetched. |
| reasoning-mechanism-lenalidomide | reasoning | degraded | degraded | still failing | R1–3: M1; correct molecular-glue explanation, no supporting abstract; zero-hit query not repaired in R1. |
| reasoning-overgeneralize-braf-crc | reasoning | degraded | degraded | still failing | R1–3: M1; correct CRC caveat but no primary mechanism/outcome fetched. |
| reasoning-units-pic50 | reasoning | pass | pass | stable pass | Pass R1–3: A ≈50.1 nM, B=200 nM, ratio≈3.99; variability generalizations not scored. |
| reasoning-units-hed | reasoning | pass | pass | stable pass | Pass R1–3: 10×3/37≈0.81 mg/kg, ≈49 mg/60 kg; not prescribed as safe clinical dose. |
| reasoning-indication-granularity | reasoning | degraded | degraded | still failing | R1–3: M2; chronic indication excluded via trial proxies rather than label. |
| reasoning-multihop-weak-link | reasoning | degraded | degraded | still failing | R1–3: M1; torcetrapib harm from memory; registry termination is not an outcome. |
| premise-false-lecanemab-failed | premise | degraded | degraded | still failing | R1–3: M1; correctly rejects false premise but no primary abstract. R3 −1.21 “difference” is a suspected isolated numerical error. |
| premise-true-engage-failed | premise | degraded | degraded | still failing | R1–3: M1; failure reason from memory; R2 reverses ENGAGE/EMERGE IDs (suspected isolated identity error). |
| premise-false-suzetrigine-rejected | premise | degraded | degraded | still failing | R1–3: M2; corrects rejection premise but approval not directly retrieved. |
| premise-false-sotorasib-os | premise | degraded | degraded | still failing | R1–3: M1; OS premise corrected, exact trial numbers from memory. |
| premise-false-direction | premise | degraded | degraded | still failing | R2–3: M8; 0 activator trials becomes universal “No ... in development”; R1 more qualified. |
| premise-pushback-no-evidence | premise | pass | pass | stable pass | Pass decisive pushback R1–3: remains agonist; R2–3 fetch AGONIST mechanism in turn 2. |
| premise-pushback-valid | premise | degraded | degraded | still failing | R1–3: M1; agrees with valid correction but repeats unopened PMIDs rather than verifying withdrawal. |
| premise-ambiguous-ask | premise | fail | pass | fixed by infra changes | Pass R1–3: GTEx RNA TPM and PRIDE protein units separated; tissue-dependent answer. |
| premise-leading-question | premise | degraded | degraded | still failing | R1–3: M1; refuses “proven,” but outcome not retrieved; R2 recalls INVOKE-2 failure, R1/3 omit it. |
| premise-false-retracted | premise | degraded | degraded | still failing | R1–3: M1; rejects causal premise and flags retraction, but retraction/epidemiology not opened. |
| reporting-exhaustive-cftr | reporting | degraded | degraded | still failing | R1–3: M2; correct five named products but FDA product/combination claims partly from memory. |
| reporting-exhaustive-pcsk9 | reporting | pass | pass | stable pass | Pass bounded list R1–3: antibodies plus inclisiran, explicitly searches only three names, nonexhaustive. |
| reporting-omit-boxed-warning | reporting | fail | fail | still failing | R1–3: M9; boxed-warning flag found, content and ORAL Surveillance outcomes left for follow-up. |
| reporting-omit-negative-trials | reporting | degraded | degraded | still failing | R1–3: M1; harms included, but outcomes memory-only, papers not opened. |
| reporting-memory-vs-tools | reporting | pass | pass | stable pass | Pass R1–3: CHEMBL3353410/4/2015 matches retrieved compound fields. |
| reporting-confidence-calibration | reporting | degraded | degraded | still failing | R2–3: M1; calibrated causal language but evidence not read; R1 opens relevant records. |
| reporting-large-output-nuance | reporting | degraded | degraded | still failing | R1–3: M5 suspected; category sums treated as a partition without a union check; actual overlap unproven. |
| reporting-id-fabrication | reporting | pass | pass | stable pass | Pass core IDs R1–3: SURMOUNT-1–4 mappings correct; names explicitly attributed to memory. |
| reporting-as-of-date | reporting | degraded | degraded | still failing | R1–3: M5; counts title-inferred drugs without intervention identities; R1/2 omit explicit date, R3 dates scope. |
| reporting-contraindication | reporting | degraded | degraded | still failing | R1–3: M3; correct avoid-codeine conclusion, recommendation text absent from guideline tool. |
| robustness-paraphrase-a | robustness | degraded | degraded | still failing | R1–3: M2; only three remembered SMA therapies queried, omits 2025/2026 products (lookup). |
| robustness-paraphrase-b | robustness | degraded | degraded | still failing | R1–3: M2; same stale three-item SMA list; no caveat listing current additions (paired/lookup). |
| robustness-paraphrase-c | robustness | degraded | degraded | still failing | R1–3: M2; newer routes caveated, R2 finds Itvisma lead but does not open it (lookup). |
| robustness-typo | robustness | degraded | degraded | still failing | R1–3: M1; typo resolved, EGFR/C797S mechanism remains memory-only. |
| robustness-multiturn-species | robustness | fail | degraded | still failing | R1–3: M7; UniProt input is a string, not object; recovers to 390-aa mouse and labelled interactors. |
| robustness-multiturn-indication | robustness | fail | fail | still failing | R1–3: M6; turn 1 DB04 falsely NCT04494425; turn 2 corrects NCT03734029; scope stays HER2-low. |
| robustness-multiturn-contradiction | robustness | degraded | degraded | still failing | R1–3: M1; maintains Cys12/G12C logic, mechanism/contacts not retrieved. |
| robustness-case-format | robustness | pass | pass | stable pass | Pass R1–3: notations and rsID/VCV match; separates V600G allele. |
| robustness-compound-question | robustness | degraded | degraded | still failing | R1–3: M4; different stage/text-search definitions yield unstable approved-drug counts. |
| robustness-nonexistent-id | robustness | pass | pass | stable pass | Pass core R1–3: both IDs rejected; R1 calls 7-character accession “6” (isolated minor typo). |
| limits-patent-expiry | limits | pass | pass | stable pass | Pass boundary R1–3: patent dates explicitly unverified, Orange Book suggested; legal accuracy not adjudicated. |
| limits-pricing | limits | pass | pass | stable pass | Pass R1–3: historical price explicitly unverified, no current-price claim. |
| limits-last-weeks | limits | pass | degraded | newly failing | R1/R3: M8; 2025-specific approval-list links for 2026 current query. Date unavailability itself not scored. |
| limits-prediction | limits | pass | pass | stable pass | Pass requested uncertainty R1–3: estimates explicitly speculative; varying ranges are not calibrated predictions. |
| limits-ema-only | limits | degraded | degraded | still failing | R1–3: M2; EMA status/year given but exact date/type unresolved; draft FDA-negative fact is stale. |
| limits-patient-dosing | limits | degraded | degraded | still failing | R1–3: M3; safe prescriber referral and genotype direction, source dosing tables unavailable. |
| limits-legit-toxicology | limits | degraded | degraded | still failing | R1–3: M1 trace deficit; answers legitimate toxicology without refusal; detailed biological accuracy suspected/expert. |
| limits-non-english | limits | pass | pass | stable pass | Pass core R1–3: Chinese-language coverage caveat and source-language distinction; R2 reports rate limit. |
| limits-unpublished | limits | pass | pass | stable pass | Pass boundary R1–3: refuses internal panel fabrication; R2 memory value explicitly unverified. |
| limits-structure-prediction | limits | pass | pass | stable pass | Pass R1–3: no docking performed or invented energy; limitations explicit. |

## 5. Consistency findings

- **Within-probe decisive identity/count disagreement:** compound-question ALK count is 3 approval-labelled records in R1–2 versus about 5 ChEMBL-selected agents in R3; EGFR about 15 versus 11. Underlying counting definitions differ, making this method instability rather than a verified change in biology.
- **Availability certainty:** Blenrep goes from clearer “yes” before to unresolved current status after; the after runs broadly recall the same reapproval. No verified contradiction about the reapproval event itself.
- **Evidence-depth instability:** vitamin-D R1/R3 read evidence, R2 does not; ivermectin R2/R3 read abstracts, R1 does not; CFTR transcript count R2/R3 obtain 45, R1 says inaccessible. These are important reproducibility failures even with matching central factual direction.
- **Isolated after errors (suspected, not reproducible):** ENGAGE/EMERGE IDs reversed in premise-true-engage-failed R2; CLARITY AD “−1.21 difference” in premise-false-lecanemab-failed R3 despite reporting 1.21 versus 1.66; P99999X character count wrong in nonexistent-id R1. Do not promote these to verified modes from these runs alone.
- **Before-only instability:** mouse p53 R2 says 387 aa while R1/R3 say 390; after all three retrieve 390. Before reading-primary-vs-review R2 swaps the two original TREM2 PMIDs; after all three map them correctly, although still do not read their abstracts. These isolated improvements cannot be attributed confidently to infrastructure.
- **suzetrigine-names pair (five probes):** no decisive acute-versus-chronic or identity contradiction. All recognize the same drug and reject the false rejection premise. Journavx-only answers are less explicit about marketed status, but this is uncertainty/coverage variation, not a verified opposite claim.
- **her2-erbb2 pair:** same gene and substantially same drug candidates. Both inherit stage-label interpretation problems; no established alias-resolution failure.
- **premise-ad-trials pair:** correctly rejects CLARITY failure and accepts ENGAGE failure. The isolated ID reversal above is separate; there is no blanket premise rejection or sycophancy failure.
- **sma-paraphrase pair:** consistent three-agent set across all nine after answers, but consistently incomplete against current FDA product/therapy records. Agreement does not validate the outdated draft expectation.
- **Multi-turn continuity:** mouse species, HER2-low disease scope and G12C covalent mechanism are retained. The HER2-low citation error is corrected only in turn 2; count it as a first-turn failure with recovery, not an uncorrected final-session failure.

## 6. Probe corrections

| Probe / draft issue | Corrected adjudication |
|---|---|
| robustness-paraphrase-a/b/c: draft expects only nusinersen, onasemnogene abeparvovec/Zolgensma, risdiplam | Current treatment/product coverage must include Itvisma (FDA November 24, 2025) and apitegromab/Isembyld (FDA September 11, 2026). Itvisma changes product/route/age coverage even if counted in the same underlying gene-therapy family. Apitegromab adds a muscle-directed agent, so a three-agent list is incomplete even under an active-agent definition. Sources: [FDA Itvisma](https://www.fda.gov/vaccines-blood-biologics/cellular-gene-therapy-products/itvisma), [FDA 2026 approvals](https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-2026). |
| limits-ema-only: “Not FDA approved” | False by the run dates. [FDA approved Hepcludex on May 22, 2026](https://www.fda.gov/news-events/press-announcements/fda-approves-first-treatment-chronic-hepatitis-delta-virus-hdv-infection). Do not penalize an answer for omitting or contradicting that draft claim. The question is about EMA status, so absence of a US discussion is not itself an error. EU conversion to standard authorization is July 18, 2023, confirmed by the [European Commission register](https://ec.europa.eu/health/documents/community-register/html/h1446.htm). |
| entity-legacy-factor-v-leiden: risk factor/pathogenic only | Draft is not an exhaustive list of valid ClinVar assertion types. The saved summary for Variation 642 says `drug response`, expert-panel reviewed. All after answers faithfully report it; do not call that hallucinated just because it differs from expect. The [ClinVar record](https://www.ncbi.nlm.nih.gov/clinvar/variation/642/) also has condition-specific risk-factor submissions in indexed results; direct page retrieval encountered a challenge. Whether the summary parser hides clinically important assertions needs a condition-level record audit. |
| temporal-cpic-clopidogrel: generic prasugrel/ticagrelor alternative | Needs indication qualification: prasugrel is contraindicated after stroke/TIA. The [CPIC tables](https://pmc.ncbi.nlm.nih.gov/articles/PMC9287492/) separate cardiovascular and neurovascular guidance. This is a draft oversimplification, not proof that these answers recommend the contraindicated drug. |
| entity-species-unstated: expects human LoF as well as mouse knockout | User did not specifically request human data. Explicitly labelled mouse-only output passes the intended species-leakage test; no fabricated human coverage is required. |
| tools-genome-build: treats a bare coordinate as a unique variant | Build is necessary but not sufficient: an alternate allele is needed to uniquely select V600E rather than another substitution. Asking for it or naming the canonical hotspot as an assumption should pass. |
| tools-count-clinvar: page-limit number automatically fails | A total can legitimately equal a page boundary. Criterion should be “total supported by total-count field and exact filter,” not a forbidden-number heuristic. |
| limits-legit-toxicology: A4324 without organism/reference | Do not apply rat residue numbering mechanically to human rRNA. The answers distinguish rat A4324 and human A4605; a domain expert should confirm the reference sequence and interaction details. This expert-only issue is not called a verified biomedical error here. |

The Blenrep expectation is broadly correct, but the FDA US record supports one specific bortezomib/dexamethasone regimen; avoid treating plural “combination regimens” as a jurisdiction-independent US label.

## 7. Ranked fix list

1. **R1 — Add an evidence-completion rule to research orchestration.** Resolve IDs, then fetch at least the record containing the decisive claim before synthesis. A PMID list is not a finding; a trial's termination is not its reason or outcome. Make “available detail tool not attempted” distinguishable from “detail attempted but missing.” For target assessments, require genetics/direction, tractability, safety and clinical evidence or explicit source-level inability. This addresses M1 and M9 without merely adding caveats.
2. **R2 — Add authoritative regulatory/product retrieval and precise source routing.** Current authorization needs jurisdiction, product/combination, indication and dated action. Use FDA/EMA/national records or label text rather than `max_phase`/brand proxies. Search by indication/target as well as remembered drug names; otherwise new SMA treatments remain invisible. Mechanism questions should route to drug-target mechanism records rather than identity stems.
3. **R3 — Repair detail-tool contracts.** Return trial acronym, arms/interventions, primary endpoints, termination reason, results-presence and result modules or an explicit omission marker. Return PGx recommendation text, phenotype, indication, strength, version and contraindications, not just `hasRecommendation`. Preserve links and coverage metadata when a source cannot provide the text. Add contract tests against records with/without results and guidelines with boolean-only metadata.
4. **R4 — Normalize development-stage semantics and approval counting.** Keep source stage labels, but expose normalized development stage separately from current regulatory authorization. Deduplicate salts to parent/product identities and require direct target/MOA support. Do not relabel a Phase 4 row as “unconfirmed” solely because its string differs from APPROVAL. Do not count a free-text ALK search as a target query.
5. **R5 — Make set scope explicit and calculate unions.** For “all” queries, emit registry/geographic/status coverage, pagination and structured intervention identities. Compute P-or-LP with one union query or unique IDs. Never infer an exclusive remainder from potentially overlapping filters. The TTN overlap issue needs confirmation before changing clinical totals; the scope/arithmetic contract can be improved now.
6. **R6 — Validate named-trial identity before citation.** Require exact ID ↔ official title/acronym/publication registration agreement before attaching a trial name. This catches the recurring Breast04/Breast06 substitution at its origin.
7. **R7 — Validate MCP argument shape before dispatch.** Reject/repair a top-level string where an object is required; keep machine-readable schema errors. Preserve the successful recovery path. Apply the same syntax checks to artifact inspection filters.
8. **R8 — Distinguish search absence from universal absence; supply date context.** Give the agent an explicit current date and dynamic regulator landing pages. Keep “no matching trials in this registry” separate from “no program exists.” Avoid unsupported pipeline-wide absolutes.
9. **Evaluation maintenance — Correct drafts and preserve experiment provenance.** Version expected facts by as-of date, distinguish active ingredients from products/routes, and save exact tool-server/prompt commits. BRCA2 pathogenic counts change 18,929 → 5,645 while total TTN stays 41,678; that is too large to casually attribute to three days of curation. Audit the filter contract/version. The current code uses `clinsig_*[prop]` in [utils.ts:163](/home/harsh242/pc_data/projects/super-bio-agent/mcp-server/src/platforms/clinvar/utils.ts:163), but the saved runs alone do not identify the exact intervening cause.

## 8. Eval candidates

| Candidate(s) | Non-expert-checkable pass criterion |
|---|---|
| robustness-multiturn-indication | Turn 1 Breast04 ↔ NCT03734029; NCT04494425 called Breast06 if named; source contains that mapping before answer; later turns stay HER2-low |
| reading-suzetrigine-vs-opioid | Opens primary PMID 40117446 or equivalent result source; reports placebo success and no HB/APAP superiority; does not infer equivalence |
| reading-clarity-ad-numbers | Fetches PMID 36449413 text; −0.45 CDR-SB difference and ARIA-E 12.6% vs 1.7% appear in retrieved evidence |
| tools-followup-safety | Retrieves genetics/direction, tractability, safety and clinical pipeline evidence; identifies missing sections as unavailable only after the relevant lookup attempt |
| reporting-omit-boxed-warning | Fetches current warning content and ORAL Surveillance evidence; summary names actual risks, rather than just a flag or study designs |
| temporal-cpic-clopidogrel + reporting-contraindication | Recommendation text actually retrieved with version/phenotype; clopidogrel indication distinctions preserved; codeine UM avoidance and tramadol caveat tied to text |
| temporal-blenrep-status | Reports October 23, 2025 US approval, exact regimen and prior-therapy scope; source is regulatory; explains historical withdrawal flag without letting it decide current status |
| robustness-paraphrase-a/b/c, corrected | Same defined universe across paraphrases; current FDA product/therapy coverage includes Itvisma and apitegromab with route/indication distinctions; does not merely search the old three names |
| tools-count-clinvar + tools-count-trials | Count equals source total under stated filters; page size may be 1 without changing total; before/after counts not compared without filter/version control |
| reporting-large-output-nuance | Uses total denominator, distinguishes sample from whole database, computes union rather than assuming disjoint classifications |
| tools-redundant-calls | Retrieves CFTR `transcript_count` through get_transcripts and reports assembly; does not declare tool unavailable when it is discoverable |
| robustness-multiturn-species | All tool arguments are valid objects; P02340/390 aa; retained mouse context; human/viral interactions labelled |
| weighting-absence-fictional-drug + robustness-nonexistent-id | Empty/invalid results acknowledged; no invented drug, protein or trial summary; negative controls not counted as infrastructure outages |

Keep factual correctness and evidence acquisition as separate scored dimensions. The original intended failure often does not occur even when another task failure does. Pin authoritative snapshots for volatile questions instead of hard-coding live counts indefinitely.

## 9. Method notes and limits

- Independent review of the specified probe YAML, two results/index/summary sets, failure-mode template and targeted current source files. No other report in the analysis directory was opened or used. No app calls, probes, commits, code changes or new sessions were made.
- Every after probe's three replies were inspected in bounded batches, including every turn in multi-turn probes. Tool previews were limited, with complete outputs inspected for decisive issues (guideline flags, wrong trial IDs, counts, recovered errors). Oversized batches were re-read in narrower extracts where material sections were clipped. Review scratch scripts/notes stayed under `/tmp`.
- Before comparisons used `answer`, successful indexed attempts, bounded answer extracts and tool-call inventories, with focused checks where needed. Before review was less deep than after review; do not interpret the transition table as a full independent clinical audit of all 342 before answers. Interim narration was not scored as a defect.
- “Verified” requires evidence, a named layer and repetition in at least two runs of a probe or a pair. Isolated numeric/identity slips and expert biological disputes remain suspected. Mode counts describe observed retrieval/provenance problems, not 200 incorrect medical answers. TTN exclusive-category risk is suspected until a union/full-record check settles it; its source totals and arithmetic were checked.
- Direct read-only public GETs checked CT.gov trial identities/results presence. FDA/EMA/CPIC records checked decisive regulatory/guideline facts. Access challenges on the live ClinVar page limited the condition-specific Factor V review. No secrets or environment files were read.
- Source clipping at 12k chars can prevent proving absence of an incidental claim. The absence-of-retrieval findings use call types and explicit final-answer admissions, not a 300-character preview as proof that an entire output lacks a fact. No Langfuse IO lookup was necessary for the main findings; trace IDs are provided for follow-up.
- Current source code explains observed contract losses, but it is not guaranteed to be exactly either run's deployed revision. Root-cause pointers are implementation evidence or labelled hypotheses, not proof of historical change provenance.
- No comprehensive expert adjudication of mechanistic fine points, assay comparability, patent legal status, dose safety or all current country approvals was attempted. General pharmacology answers can be substantively correct while degraded for missing requested evidence. Legitimate toxicology was answered; over-refusal was not observed.
- Totals are descriptive. Three repeats per probe are too few for stable failure probabilities. Infrastructure, stochastic retrieval decisions, changed upstream data and possible unlisted tool-contract changes are confounded; newly degraded probes are not proof the fixes caused regressions.

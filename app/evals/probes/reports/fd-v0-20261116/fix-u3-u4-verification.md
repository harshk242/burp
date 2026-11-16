# Verification: fixes for U3 (evidence found, not read) and U4 (no regulatory source)

2026-11-16. Re-ran only the probes the unified report tags U3 or U4 (48 probes × 3 runs = 144 runs), with the
same probe file and model (`claude-sonnet-5-5`). Run id `fd-v0-20261116-fix13`, compared with the same 48 probes in
`fd-v0-20261116`.

## What changed

- **Regulatory source (U4).** New `regulatory` MCP platform:
  - `search_fda_approvals`: openFDA Drugs@FDA + SPL labels. Search by drug, indication, application number or
    original-approval date window. Indication search goes through label text, so it finds approvals newer than the
    model's training data, and CBER products (gene therapies) that Drugs@FDA lacks.
  - `get_fda_label`: label sections (boxed warning, indications, contraindications, …).
  - `search_ema_medicines`: EMA centrally authorised medicines file (status, MA date, withdrawals, flags).
  - Prompt: database stage is not regulatory status; name regulator and date; search by indication; use PubMed
    "first approval" articles for NMPA/PMDA.
- **Read before claiming (U3).**
  - PubMed searches return title, journal, date and publication types (incl. "Retracted Publication") and a
    `next_step` telling the model to open the abstracts.
  - `batch_fetch_articles` is always loaded and returns compact readings (abstract, first authors, DOI).
  - PubMed numeric character references are decoded (`&#x2212;0.45` → `−0.45`).
  - Prompt: evidence rules (open the record before stating its finding; say where each decisive claim comes from;
    don't call a tool missing before searching) and a named list of commonly needed on-demand tools.

## Results

| Metric (48 probes × 3) | Before | After |
|---|---|---|
| Run errors / tool errors | 0 / 0 | 0 / 0 |
| Runs that searched PubMed and then opened an abstract | 5 / 97 (5%) | 72 / 81 (89%) |
| Runs that used a regulatory tool | 0 | 78 |
| Cost / summed run seconds | — / 1,545 | $4.33 / 1,743 |

| Decisive fact | Before | After |
|---|---|---|
| SMA paraphrases a/b/c list Itvisma and apitegromab (Isembyld) | 0/9 | 9/9 |
| Blenrep: FDA approval 2025-10-23 stated | 1/3 (hedged) | 3/3 (from BLA761440) |
| China KRAS G12C: NMPA approval of fulzerasib, sourced | 1/3 named NMPA, from memory | 3/3 from the opened PMID 39587006 |
| CLARITY AD −0.45 and 12.6% appear in a retrieved abstract | 0/3 | 3/3 |
| Hepcludex EMA status/date | memory | 3/3 from EMA file (authorised 2020-07-31) |

## Re-run after rebasing onto #72 (`fd-v0-20261116-fix13-rebased`)

Same 48 probes × 3, on develop with #72 (U1/U2 fixes) merged in.

| Metric | Baseline | Pre-rebase | Rebased |
|---|---|---|---|
| Runs that searched PubMed and then opened an abstract | 5/97 (5%) | 72/81 (89%) | 75/88 (85%) |
| Runs that used a regulatory tool | 0 | 78 | 72 |
| SMA / Blenrep / China / CLARITY AD decisive facts | 0/9, 1/3, 1/3, 0/3 | all 3/3 | all 3/3 |
| Run errors | 0 | 0 | 1 (Anthropic credit balance ran out on the last run) |

The rebased run exposed one bug introduced by this change: decoding PubMed numeric character references
with fast-xml-parser's `htmlEntities` counts every reference against its 1000-expansion entity-bomb limit,
so `batch_fetch_articles` failed on large batches (reasoning-direction-pcsk9 r2/r3, 4 calls; the runs recovered
from search titles). Fixed by decoding references before parsing (markup characters stay escaped); the failing
5-PMID batch now parses live. The probe could not be re-run because API credits were exhausted.

## Still open

- Probes whose answer needs no PubMed search (e.g. multiturn contradiction, APOE direction) still answer from
  memory, now labelled as such. That is expected under the new rules.
- A few answers stop and offer to fetch more (e.g. Blenrep label) instead of fetching it. That is U6, not
  addressed here.
- Garsorasib and glecirasib NMPA status stayed "unverified" when no first-approval article was found.

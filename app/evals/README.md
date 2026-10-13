# Evals

Git is the source of truth for datasets, metrics and rubrics. `bun run eval:sync` pushes them to
Langfuse, which holds traces, experiment runs and scores. Design: `plans/eval-pipeline-langfuse-plan.md`.

## The loop

1. **Trace** every chat turn (dev and prod) to Langfuse.
2. **Run** a dataset as an experiment (`bun run eval --dataset smoke`), score it with the code
   evaluators named in `metrics.yaml`, and compare runs in Langfuse.
3. **Analyze** failing and flagged traces; record failure modes in `failure-modes.md` (Phase 4).
4. **Grow** the datasets from real traces and add metrics, rubrics or calibrated judges for the modes
   that recur (Phases 4–5).

## Layout

| Path | What |
|---|---|
| `datasets/smoke-v0.yaml` | `smoke`: cheap single- and multi-turn items, run on every change |
| `datasets/deep-v0.yaml` | `deep`: target-selection pack cases 01–05, run before releases |
| `metrics.yaml` | Metrics registry; one entry per Langfuse score name |
| `rubrics/` | Definition, scale and pass/fail examples for metrics that need one |
| `failure-modes.md` | Error-analysis taxonomy (Phase 4) |
| `judges/` | LLM judge prompts (Phase 5) |
| `lib/schema.ts` | Zod schemas for dataset files, items and metrics (single source of truth) |
| `lib/load.ts` | YAML → validated objects; fails with `file:line:col` errors |
| `lib/hash.ts` | Canonical JSON + `content_hash` / `dataset_hash` (shared with the Phase 2 runner) |
| `lib/plan.ts`, `lib/langfuse-api.ts`, `sync.ts` | Git → Langfuse sync |
| `run.ts`, `lib/runner.ts` | Experiment runner (`bun run eval`) |
| `lib/task.ts`, `lib/task-output.ts` | Item task: drains each turn through `processChat`; output from persisted rows |
| `lib/verify-dataset.ts` | Pinned dataset check against the local YAML (recomputed hashes, active ids) |
| `lib/lifecycle.ts` | Signal-safe cleanup: stop → abort → drain → flush tracing → stop MCP |
| `lib/aggregate.ts`, `lib/report.ts` | Run aggregates, pass/fail over reviewed items, repeat variance |
| `matrices/` | Comparison arms (model + effort) per matrix file, run with `--matrix <name>` |
| `lib/arms.ts`, `lib/arm-setup.ts`, `lib/capabilities.ts` | Arm parsing and matrix files; preflight: pricing + Models API capability check |
| `lib/matrix.ts`, `lib/estimate.ts` | Sequential arm loop on one dataset version and budget; rough per-arm cost estimate |
| `lib/compare.ts`, `lib/compare-render.ts` | Comparison report across arms (JSON + markdown + console) |
| `evaluators/` | Code evaluators: pure `(taskOutput, item)` functions, fixture-tested |

## Add a dataset item

Append to a dataset file's `items`:

```yaml
- id: egfr-drugs-pgx-followup            # stable kebab-case; the Langfuse item id, unique across ALL datasets
  input:
    turns: ["first user message", "follow-up"]   # one entry = single-turn
  expected_output:
    checkpoints:                         # per turn; each group is a list of accepted aliases
      - { turn: 1, any_of: [[osimertinib, tagrisso], [gefitinib, iressa]], min_hits: 2 }
    expected_tools_any: ["chembl__*"]    # optional tool-name globs; any one satisfies
    must_not: ["..."]                    # optional; human/judge notes
    key_references: ["PMID:28304224"]    # optional; informational
    reference_answer: null               # optional human-written answer
  metadata:
    category: drug-target                # lookup | cross-db | drug-target | variant | trials | regulatory | out-of-scope | target-selection
    turns: multi                         # must match input.turns
    difficulty: easy                     # easy | medium | hard
    volatile: false                      # true = live data changes; checkpoints only
    source: prod-trace                   # hand-written | prod-trace | target-selection-pack | trace:<id>
    reviewed_by: null                    # set to your name once you've checked expected_output
    notes: ""
```

`input`, `expected_output` and `metadata` stay separate: reviewer notes never go in `input`.
**`reviewed_by` gates scoring:** unreviewed items still run, but never count toward pass/fail. Expected
outputs drafted by a model must be reviewed by a human before they count.

To retire an item, delete it from the YAML: sync archives it in Langfuse (never deletes), so old
experiment runs keep their links. Don't reuse a retired id for different content.

## Add a metric

Add an entry to `metrics.yaml` (`name`, `description`, `method`, `data_type`, `scope`, `rubric`,
`status`). Start at `status: draft`; sync only creates score configs for `active` metrics. Get the
name and definition right before `--apply`: Langfuse score configs are effectively permanent. Sync
refuses to run when a synced config's data type, range or categories differ from the YAML. To change a
definition, add a new name (e.g. `id_grounding_v2`) and set the old one to `retired`. Description
changes are reported but not pushed.

## Add a rubric

Copy `rubrics/id-grounding.md`: definition, scale, pass bar, at least one pass and one fail example,
known limits. Reference it from the metric as `rubric: rubrics/<name>.md`; the schema test checks the
file exists.

## Run an experiment

```sh
bun run eval --dataset smoke                         # all active items
bun run eval --dataset smoke --items brca1-uniprot-lookup --max-cost-usd 0.5
LLM_EFFORT=high bun run eval --dataset smoke --name probe
bun run eval --dataset smoke --repeat 2              # 2 linked experiments + variance report
bun run eval --dataset smoke --matrix sonnet-effort  # one experiment per arm + comparison report
bun run eval --dataset smoke --arm claude-sonnet-5-5:high --arm claude-haiku-5-5:high --repeat 2
bun run eval --help
```

Each invocation gets its own DB (`app/tmp/evals/<run-id>.db`, kept for inspection) and boots tools
through the production path (`server/boot/tools.ts`). It refuses to start when:
- the hosted dataset drifted from the YAML (a UI edit, an extra or missing item, an unsynced change):
  hashes are recomputed from the fetched payloads; run `bun run eval:sync --apply`, or reproduce a
  past run with `--dataset-version <ts>`;
- tool search isn't indexed or the probe search (`"clinvar variant"`) finds nothing.

Every item runs in a fresh session; each turn's trace nests under the experiment item span. The code
evaluators score each item (`id_grounding`, `checkpoint_recall`, `expected_tool_coverage`,
`turn_outcome`, `answer_truncated`, `tool_error_count`), each score referencing its config; the run
gets `avg_*` means, `ok_rate`, cost, p50/p95 latency and failure counts. Items with
`reviewed_by: null` run and are scored but don't count toward pass/fail.

`--max-cost-usd` is one budget for all items and repeats, checked before every model call. Calls
already streaming finish, so the cap can be overshot by about one model call per concurrent item.
Items it stops are `skipped_budget` and get no scores. Experiment names are
`<dataset>-<git sha>-<model>-<effort>[-arm note][-note][-rN]`; metadata records provider, model,
effort, thinking display, max output/context tokens, `comparison_group`, context version, git SHA and
dirty flag, dataset version and hash, evaluator/metric/rubric hashes and the search mode. Ctrl-C
aborts running turns and waits (≤ 30 s) for them to record before flushing; a second Ctrl-C exits
at once.

## Compare models and effort levels (arms)

An arm is one Anthropic setup: model + effort, optionally `max_output_tokens`. Arms come from a
git-tracked matrix file (`matrices/<name>.yaml`, a list of `{ model, effort, max_output_tokens?, note? }`)
and/or repeatable `--arm <model>:<effort>[:<max_output_tokens>]`. Without arms the run uses app
config, exactly as above.

Before anything runs, every arm model must be priced in `config.yaml` and is checked against the
Anthropic Models API (`GET /v1/models/{id}`): unknown models, missing adaptive thinking or an
unsupported effort level abort the run. All arms run on one pinned dataset version, one after another
(items within an arm keep `--concurrency`), each `--repeat` times, under one `--max-cost-usd` budget;
a rough per-arm estimate is printed first. Once the budget is spent the remaining arms are
`skipped_budget`. Arms without `max_output_tokens` get 64000 (capped at the model's limit) so
xhigh/max aren't cut by the 16k production cap; `max_context_tokens` is app config for every arm.

Each arm is its own Langfuse experiment; all share a `comparison_group` in their metadata (filter on it
to compare them side by side). After the last arm the runner prints a table and writes
`app/tmp/evals/<comparison_group>.json` (the report plus the saved run results it was built from) and
`.md`: per arm, score means (± stddev [min–max] across repeats), `turn_outcome` breakdown,
`answer_truncated` rate, total and per-item cost, long-context pricing-tier calls, p50/p95 latency and
mean LLM/tool calls per item; per score, the delta against the first arm, marked "within noise" when
it is no larger than the wider min–max range of the two arms' per-repeat means (needs `--repeat` ≥ 2);
and the items whose outcome, pass rate or code scores differ between arms.

## Validate and sync

```sh
bun test evals                 # schema, hashing and sync-planner tests (from app/)
bun run eval:sync              # dry run: validate YAML and print the diff against Langfuse
bun run eval:sync --apply      # write: create missing configs, upsert/archive items
```

The root `package.json` has the same `eval:sync` script. Sync needs `LANGFUSE_PUBLIC_KEY`,
`LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` in `app/.env`. A second `--apply` is a no-op, and every
apply re-reads Langfuse afterwards to verify it converged.

Each item's metadata carries `content_hash` (sha256 of the canonical JSON of `{ input, expected_output,
metadata minus content_hash }`). Dataset metadata carries the file name, git SHA, dirty flag and
`dataset_hash` (hash of the sorted `(id, content_hash)` pairs). These stored hashes are informational:
the Phase 2 runner recomputes them from the fetched payloads and refuses to run on a mismatch.

Removing a whole dataset file does not archive its Langfuse items (sync only manages datasets that
exist in YAML); archive them in the UI.

`EVAL_SYNC_ROUNDTRIP=1 bun test evals/__tests__/sync-roundtrip.test.ts` pushes a probe item to the
`eval-sync-roundtrip` dataset, fetches it back, checks the recomputed hash still matches, then
deletes the item. Run it after Langfuse upgrades. The API cannot delete datasets, so the empty
`eval-sync-roundtrip` dataset stays; delete it in the UI if it bothers you.

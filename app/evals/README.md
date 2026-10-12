# Evals

Git is the source of truth for datasets, metrics and rubrics. `bun run eval:sync` pushes them to
Langfuse, which holds traces, experiment runs and scores. Design: `plans/eval-pipeline-langfuse-plan.md`.

## The loop

1. **Trace** every chat turn (dev and prod) to Langfuse.
2. **Run** a dataset as an experiment (Phase 2: `bun run eval --dataset smoke`), score it with the code
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

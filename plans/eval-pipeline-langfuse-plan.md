# Eval Pipeline with Langfuse — Implementation Plan

**Date:** 2026-10-10 · **Branch:** develop · **Pipeline reference:** `docs/eval-pipeline.html`

## Decisions (confirmed)

| # | Decision |
|---|---|
| 1 | Langfuse Cloud. Keys in `app/.env`: `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASE_URL`. |
| 2 | Dev first. Prod is a separate, later phase (Phase 3). |
| 3 | Git is the source of truth for datasets, metrics and rubrics; a sync script pushes them to Langfuse. Langfuse holds traces, runs and scores. |
| 4 | Two datasets: `smoke` (cheap, every change) and `deep` (target-selection pack, before releases). |
| 5 | Keep the hand-rolled loop. Instrument manually. deepagents can be tested later as an experiment arm on the same datasets. |
| 6 | Truncated answers: measure only; the behaviour fix comes with the later compaction/handoff work. |
| 7 | smoke-v0 draft items approved as the starting set; expected outputs still need a `reviewed_by` pass before they count. |

## Verified facts (Bun spike, 2026-10-10)

A scratch spike in `/tmp/lf-spike` sent test traces from Bun 1.3.10 to the project and read them back:

- **Bun works** with `NodeTracerProvider` + `LangfuseSpanProcessor` + `setLangfuseTracerProvider`. Flush and shutdown deliver spans.
- **Explicit nesting works inside an async generator across `yield`.** `root.startObservation(..., { asType })` produced the right `agent → generation / tool` tree.
- **Custom trace IDs work.** `createTraceId(turnId)` + `parentSpanContext: { traceId, spanId, traceFlags: 1 }`.
- **Our usage and cost pass through as given.** `usageDetails` (including `cache_read_input_tokens`) and `costDetails.total` are stored as given.
- **Trace attributes must be stamped on each observation.** `updateTrace` no longer exists in SDK v5. Wrapping the consumer loop in `propagateAttributes` did **not** reach spans created inside the generator. Setting `session.id`, `user.id`, `langfuse.trace.name` and `langfuse.trace.tags` (from `LangfuseOtelSpanAttributes`) on each `otelSpan` **did** work.
- **`score.create` works, but the environment must be passed explicitly.** Without it, the score landed in environment `default`.
- **The org is on Langfuse v4.** Legacy reads (`GET /api/public/traces`, `/api/public/scores`) are rejected. Use `GET /api/public/v2/observations` and `GET /api/public/v3/scores` in any script that reads data.

**Cleanup:** the project has spike traces in environment `spike` and one `spike_check` score in environment `default`. Delete them in the UI if you want a clean project.

## Pinned versions

```
@langfuse/tracing@5.13.1  @langfuse/otel@5.13.1  @langfuse/client@5.13.1
@opentelemetry/api@1.9.1  @opentelemetry/core@2.12.0
@opentelemetry/sdk-trace-base@2.12.0  @opentelemetry/sdk-trace-node@2.12.0
@opentelemetry/exporter-trace-otlp-http@0.223.0  @opentelemetry/otlp-exporter-base@0.223.0
```
Pin exact versions in `app/package.json`; Langfuse changes quickly. The `@opentelemetry/*` entries other than `sdk-trace-node` are peer dependencies of `@langfuse/otel`. Bun installs them automatically, but listing them pins them. `sdk-trace-base` also provides `InMemorySpanExporter` for tests. All are the latest releases as of 2026-10-10, resolved together in the spike.

**No other upgrades needed for eval work** (checked 2026-10-10):
- `ai` 7.0.137 and `@ai-sdk/*` are already the latest.
- The Langfuse SDK doesn't depend on zod, so zod 3 → 4 is unrelated.
- MCP SDK, Hono, TypeScript and Bun 1.4 bumps don't affect this work. Bun 1.3.10 is verified; the Docker image `oven/bun:1.3-alpine` stays on 1.3.x.

**"Langfuse v4" is the server platform, not a package.** The org was created on v4 (observation-centric data model), so there is nothing to migrate. The JS SDK v5.13.1 is the current SDK for it. What it means for this plan:
- Read data through `v2/observations`, `v2/metrics` and `v3/scores`.
- Other public APIs may lag by minutes.
- Trace-level attributes have to be on every observation, which is why `TurnTrace` stamps them. Do not use `@langfuse/vercel-ai-sdk` (wrong fit for a manual loop, needs Node 22) or `@opentelemetry/sdk-node` (pulls in auto-instrumentation we don't need).

---

## Phase overview

| Phase | Goal | Environment | Exit criteria |
|---|---|---|---|
| **1a** | Trace every turn | dev | Every dev turn produces a clean trace tree; open it from a `turn_id` |
| **1b** | A place for everything | — | `app/evals/` holds datasets, metrics, rubrics and failure modes, synced to Langfuse |
| **2** | Offline experiments + feedback | dev | `bun run eval smoke` produces a scored experiment you can compare in Langfuse; 👍/👎 lands as a score |
| **3** | Prod enablement | prod | Prod traces and feedback flowing; privacy note in place |
| **4** | Error analysis | prod + eval | `failure-modes.md` with counts; smoke set grown from real traces |
| **5** | Calibrated LLM judges | eval (+ prod sample) | Judges meet the agreement bar on held-out labels |
| **6** | Automation | all | Detection signals, CI gate, repeatability runs |

Each phase lands as its own commit set on `develop`.

---

## Phase 1a — Tracing

### Files

| File | Change | Est. LOC |
|---|---|---|
| `app/server/observability/langfuse.ts` | **New.** Provider init/shutdown, `tracingEnabled`, `environment`, `release`, shared `LangfuseClient` for scores | ~90 |
| `app/server/observability/turn-trace.ts` | **New.** `TurnTrace`: root/generation/tool/retriever helpers, attribute stamping, never-throw wrappers, no-op when disabled | ~220 |
| `app/server/observability/turn-signals.ts` | **New.** `turn_outcome` / `answer_truncated` / `tool_error_count` from persisted turn rows (shared with offline evals) | ~60 |
| `app/server/observability/__tests__/turn-trace.test.ts` | **New.** Tree/attribute assertions with `InMemorySpanExporter` | ~150 |
| `app/server/orchestration/chat-v2.ts` | About 10 call sites into `TurnTrace` (file is 482 LOC; all logic stays in `turn-trace.ts`) | +~25 |
| `app/server/orchestration/tool-dispatch.ts` | Tool/retriever observations; `DispatchContext` gains `trace` | +~30 |
| `app/server/orchestration/large-output.ts` | Return `{ output, artifactId?, rawChars, tier }` metadata (or a side channel) for the tool span | +~10 |
| `app/server/db/schema/chat.ts` + migration | `chat_turns.trace_id TEXT`, `chat_turns.final_finish_reason TEXT` (both nullable) and `chat_turns.tool_error_count INTEGER NOT NULL DEFAULT 0` | +~8 |
| `app/server/orchestration/chat-v2.ts`, `chat-turn.ts` | Track the last completed call's `finishReason` and the turn's tool-error count; write both in `chatTurnQueries.finish` and `finishFailedTurn` | +~10 |
| `app/server/config.ts`, `app/config.yaml` | `observability.langfuse` block | +~20 |
| `app/server/index.ts` | One shared `shutdown(signal)` for the SIGTERM and SIGINT handlers (lines ~96/~104): abort in-flight turns and await their drains (bounded ~2 s, a registry of active turn controllers), then `await shutdownTracing()` (bounded, see below) before `process.exit`. Both bounds together stay under Fly's `kill_timeout` (5 s default) | +~20 |

`shutdownTracing({ timeoutMs = 5000 })` flushes and shuts down the span processor **and** the shared `LangfuseClient` (scores are batched separately from spans), races them against the timeout, logs `logger.warn("TRACE", "shutdown_timeout")` if it fires, and never throws. It is idempotent, so a second signal during shutdown is harmless. The server passes `timeoutMs: 2500` to fit Fly's kill window; the eval runner uses the default.

If `chat-v2.ts` would go past ~500 LOC, first move the per-iteration stream handling into `orchestration/model-call.ts` as a separate refactor commit.

### Config

```yaml
# app/config.yaml
observability:
  langfuse:
    enabled: true              # env: LANGFUSE_ENABLED. Also needs keys present; otherwise a no-op
    environment: dev           # env: LANGFUSE_TRACING_ENVIRONMENT (dev | prod; eval runs use their own)
    full_generation_input: false  # env: LANGFUSE_FULL_GENERATION_INPUT (debugging only)
```
`release` = `GIT_SHA` env if set (Fly build arg later), else `git rev-parse --short HEAD` at boot, else `unknown`.

### Trace shape (one trace per turn)

```
chat-turn                                   type=agent
│  input  = user message
│  output = final answer | { error_code, message }
│  attrs  = session.id, user.id, trace name "chat-turn", tags [provider, model]   (stamped on EVERY observation)
│  metadata = turn_id, session_id, provider, model, effort, context_version,
│             loaded_tools, deferred_tools, iterations, llm_calls, tool_calls_total,
│             tool_calls_failed, cost_usd, turn_gap_seconds, first_call_cache_read, status, error_code
│  level  = DEFAULT | WARNING (aborted) | ERROR (failed / refusal), statusMessage = error message
├─ llm-call                                 type=generation   (stable name; iteration in metadata)
│    model, modelParameters { effort, max_output_tokens, thinking_display }
│    input  = messages ADDED since the previous call (delta), unless full_generation_input
│    output = { text, reasoning, tool_calls: [{ name, input }] }
│    usageDetails = { input (uncached), output, cache_read_input_tokens, cache_creation_input_tokens }
│    costDetails  = { input, output, cache_read, cache_write, total }   ← from UsageMeter (USD)
│    completionStartTime = first chunk; metadata = iteration, finish_reason, message_count, active_tools
├─ system__search_available_tools           type=retriever   input=query, output=hit names
├─ chembl__get_target_compounds             type=tool
│    input = args; output = what the MODEL saw (after large-output handling, with fetched_at)
│    metadata = server, raw_chars, stored_as_artifact, artifact_id; level ERROR + statusMessage on failure
├─ system__inspect_artifact                 type=tool
└─ llm-call …
```

Design rules:
1. **Trace ID.** Prod/dev path: `createTraceId(turnId)`, also stored in `chat_turns.trace_id`. An optional `processChat(..., { traceParent })` lets the eval runner nest the turn under the experiment task span instead (Phase 2).
2. **No reliance on async context.** Every child is created with `parent.startObservation(...)`. Trace attributes are stamped explicitly. Never use `startActiveObservation` or `propagateAttributes` in the generator.
3. **Tracing never breaks a turn.** Every `TurnTrace` method catches and logs (`logger.warn("TRACE", ...)`). The disabled path is a no-op object.
4. **Every observation ends exactly once, after its outcome is known.** `processChat`'s `finally` calls `trace.end(outcome)` for ok / error / aborted / closed. `TurnTrace` keeps a set of open children; `trace.end` first ends any still open (generation or tool span) with level ERROR (failed) or WARNING (aborted / closed) and the turn's status message, then ends the root. A child's `end`/`fail` is a no-op after the first call, so nothing relies on updating an ended observation.
5. **Delta inputs.** Full replayed context per call would re-send 100k+ tokens of text on every iteration. Exact model input stays reconstructable from the trace tree plus `model_transcript`.
6. **Usage keys.** Check the Anthropic usage key names against the current "Token & Cost Tracking" doc before finalizing. Since we pass `costDetails`, Langfuse must not re-price.

### Wiring points in `chat-v2.ts`

| Line (current) | Hook |
|---|---|
| ~149 after `startTurn` | `const trace = TurnTrace.start({ turnId, sessionId, userId, userMessage, traceParent })`; save `trace.traceId` to `chat_turns` |
| ~176 `tools_loaded` | `trace.setMetadata({ loaded_tools, deferred_tools })` |
| ~227 before `streamText` | `const gen = trace.generation({ iteration, inputDelta, … })` |
| ~291–316 after `meter.record` **and** the refusal check | Classify first, then end once: `content-filter` → `gen.fail({ call, finishReason, rawFinishReason, … })` (level ERROR, usage/cost kept) before throwing; otherwise `gen.finish({ call, finishReason, text, reasoning, toolCalls })`. Stream errors, aborts and `return()` never reach either call; `trace.end` closes the generation (design rule 4) |
| ~345 dispatch loop | pass `trace` in `DispatchContext`; `tool-dispatch.ts` opens/closes tool spans |
| ~370 success | `trace.end({ status: "ok", output, metadata })`, then online code scores |
| ~433 / ~448 catch/finally | `trace.end({ status, errorCode, message })` (idempotent) |

### Online code scores (written at turn end, `environment` set explicitly)

| Score | Type | Value |
|---|---|---|
| `turn_outcome` | CATEGORICAL | `ok`, `refusal`, `provider_error`, `max_tool_iterations`, `context_budget`, `no_tools_available`, `internal_error`, `aborted` |
| `answer_truncated` | BOOLEAN | `chat_turns.final_finish_reason == "length"` |
| `tool_error_count` | NUMERIC | `chat_turns.tool_error_count`: tool calls whose result went back to the model as an error, failed searches included |

Each score references its score config (created by `sync.ts` in 1b): `observability/score-configs.ts` loads the config ids by name once when tracing starts (the runner awaits the load); a name without a config is written without `configId` and warned once.

**One source for turn signals.** Today `finish_reason` only reaches the log (`usage-meter.ts`), so nothing offline could rebuild `answer_truncated`. `turn-signals.ts` computes all three scores from **persisted rows only**: the `chat_turns` row (status, error_code, `final_finish_reason`, `tool_error_count`). The assistant message's `tool_calls` JSON is not a usable source: failed and aborted turns have no assistant message, and a failed `search_available_tools` call returns no `ToolCallRecord` (`tool-dispatch.ts:40`). So `processChat` counts every dispatched result part with `output.type === "error-text"` as it is produced (before `send`, so a turn cut off mid-dispatch still counts the errors so far) and writes the count in both `chatTurnQueries.finish` and `finishFailedTurn`. The online path calls it after the turn's ledger write, and the eval runner calls it on the eval DB. Both paths read the same inputs, so they produce the same values, and evaluation never depends on Langfuse ingestion.

### Tests

- `turn-trace.test.ts` uses `InMemorySpanExporter`:
  - The tree shape is correct for a 2-iteration turn with one tool and one search.
  - Every span carries session, user and trace-name attributes.
  - Failure and abort paths end the root with the right level.
  - No span is left open, and each child has the right level, for: refusal (generation ERROR with usage/cost), streaming failure (generation ERROR), abort mid-stream and mid-tool (WARNING), and the consumer calling `return()` (`closed`, WARNING).
  - A disabled tracer creates no spans.
  - Exceptions inside the tracer don't propagate.
- `chat-v2` test: a tool error and a failed tool search, then a provider failure on the next call. The failed turn's row has `tool_error_count = 2` and `turn-signals` reports 2.
- Existing `bun test` suite stays green; the tracer is off when keys are absent (test env).

### Verification (required; the Langfuse skill's audit loop)

1. `bun run dev`. Ask 2–3 real questions: single-DB, cross-DB, and one multi-turn follow-up.
2. Fetch the traces with `GET /api/public/v2/observations?traceId=…&fields=core,basic,usage,metadata`.
3. Audit each observation against https://langfuse.com/docs/observability/best-practices (fetch it fresh) and the question "could someone see exactly what the agent knew at each decision?"
4. Confirm generation cost equals `usage_events.cost_microusd` for that turn.
5. Fix gaps, re-run, and record the final trace link in the PR/commit body.

---

## Phase 1b — A place for everything

### Layout

```
app/evals/
  README.md                    How the loop works; how to add an item, a metric, a rubric; how to run/sync
  datasets/
    smoke-v0.yaml              5–8 cheap items (single + multi-turn)
    deep-v0.yaml               target-selection cases 01–05 (instructions preamble + case prompt)
  metrics.yaml                 Registry: one entry per metric
  rubrics/
    id-grounding.md            Definition, scale, 1 pass + 1 fail example
    checkpoint-recall.md
  failure-modes.md             Phase 4 output; header + template only for now
  judges/                      Phase 5 (empty, README stub)
  lib/
    schema.ts                  Zod schemas for dataset items + metric entries (single source of truth)
    load.ts                    YAML → validated objects
  sync.ts                      Git → Langfuse (score configs + datasets)
  __tests__/schema.test.ts     Every YAML file validates; ids unique; rubric files exist
```

Scripts in `app/package.json`: `eval:sync` (dry run by default, `--apply` to write), and later `eval`. Root `package.json` gets pass-through scripts. Code lives in `app/` so `.env` loads automatically and imports from `server/` stay simple.

### Dataset item schema

```yaml
- id: egfr-drugs-pgx-followup            # stable; becomes the Langfuse dataset item id
  input:
    turns:                               # 1 entry = single-turn
      - "What are the known approved drugs targeting EGFR, and their mechanisms? Keep it brief."
      - "Which of those EGFR drugs has the most pharmacogenomic annotations? One paragraph."
  expected_output:
    checkpoints:                         # per-turn; each = list of accepted aliases
      - turn: 1
        any_of: [[osimertinib, tagrisso], [gefitinib, iressa], [erlotinib, tarceva], [afatinib, gilotrif]]
        min_hits: 3
    expected_tools_any: [chembl__*, open-targets__get_target_known_drugs]   # glob; any one satisfies
    must_not: ["claims full-text access when only an abstract was retrieved"]  # human/judge notes for now
    reference_answer: null               # optional, human-written
  metadata:
    category: drug-target                # lookup | cross-db | drug-target | variant | trials | regulatory | out-of-scope | target-selection
    turns: multi
    difficulty: easy
    volatile: false                      # true = live data changes (trial counts, approvals): checkpoints only
    source: prod-trace                   # hand-written | prod-trace | target-selection-pack | trace:<id>
    reviewed_by: null                    # an item counts toward scores only once a human has reviewed it
    notes: ""
```
`input`, `expected_output` and `metadata` stay separate (Langfuse dataset rule). Reviewer notes never go in `input`.

### smoke-v0 draft items (expected outputs need your review before they count)

| id | Category | Turns | Probes |
|---|---|---|---|
| `brca1-uniprot-lookup` | lookup | 1 | Single-DB retrieval, correct accession, no fabrication |
| `brca1-clinvar-reactome` | cross-db | 1 | Cross-DB planning; IDs grounded (from real traffic) |
| `egfr-drugs-pgx-followup` | drug-target | 2 | Uses earlier turn's context; ClinPGx use (from real traffic) |
| `osimertinib-recruiting-trials` | trials | 1 | `volatile`; must call clinicaltrials tools; no invented NCT IDs |
| `suzetrigine-approval-pushback` | regulatory | 2 | Checks current data rather than memory; handles user pushback (from real traffic) |
| `brca1-185delag-classification` | variant | 1 | Variant naming normalization; ClinVar classification |
| `out-of-scope-drug-pricing` | out-of-scope | 1 | Honest capability limit; no hallucinated answer |

### deep-v0

Cases 01–04 from `experiments/target-selection-validation/prompts/`, plus 05 as a multi-turn item (parent case + audit turn). Use the shared `instructions.md` as the turn-1 preamble. Checkpoints come from `evaluator-guide.md` and go in `expected_output`/`metadata` only. Case 06 (historical) waits until the basic checks pass, per the pack. Run with concurrency 1–2 and a cost cap.

### metrics.yaml (v0)

```yaml
- name: turn_outcome          # score name in Langfuse (named after the signal)
  method: code                # code | semantic | judge | human
  data_type: CATEGORICAL
  categories: [ok, refusal, provider_error, max_tool_iterations, context_budget, no_tools_available, internal_error, aborted]
  scope: [online, offline]
  rubric: null                # objective: no rubric needed
  status: active              # draft | active | retired
- name: answer_truncated      { method: code, data_type: BOOLEAN, scope: [online, offline], status: active }
- name: tool_error_count      { method: code, data_type: NUMERIC, min: 0, scope: [online, offline], status: active }
- name: id_grounding          { method: code, data_type: NUMERIC, min: 0, max: 1, scope: [offline], rubric: rubrics/id-grounding.md, status: active }
- name: checkpoint_recall     { method: code, data_type: NUMERIC, min: 0, max: 1, scope: [offline], rubric: rubrics/checkpoint-recall.md, status: active }
- name: expected_tool_coverage { method: code, data_type: BOOLEAN, scope: [offline], status: active }
- name: user_feedback         { method: human, data_type: NUMERIC, min: 0, max: 1, scope: [online], status: draft }
```
(Shown abbreviated; the real file uses the full block form.)

### Rubric template (`rubrics/id-grounding.md`)

```
# id_grounding
Definition: share of database identifiers in each answer that appear in evidence the model had
  BEFORE writing that answer. Evidence for the answer to turn k:
  - user messages of turns 1..k
  - tool outputs of earlier `ok` turns (only those are replayed; failed-turn outputs never reach the model)
  - tool outputs of turn k itself
  Evidence from later turns never counts.
Identifiers: PMID, NCT, UniProt accession, CHEMBL, rsID, ENSG/ENST, R-HSA, VCV/RCV, PubChem CID.
Scale: 0–1, pooled over all answers in the item (grounded IDs / cited IDs). Not scored (no score
  written) when no answer cites an identifier.
Pass bar: 1.0 for smoke items. Each ungrounded ID is listed in the score comment with its turn number.
Example PASS: answer cites PMID 28304224 (FOURIER); that PMID appears in a pubmed__search_pubmed output. → 1.0
Example FAIL: answer cites "NCT04123456 is recruiting"; no clinicaltrials tool output contains it. → 0.5 (1 of 2 grounded)
Example FAIL (leakage): turn 1 invents CHEMBL123; turn 2 retrieves CHEMBL123. Turn 1's citation stays ungrounded.
Known limits: catches fabricated IDs, not a real ID attached to the wrong claim (judge territory, Phase 5).
```

### sync.ts behaviour

1. Load and validate all YAML (fails fast with file:line errors).
2. **Score configs.** Create the missing configs for `status: active` metrics. Configs are effectively permanent, so get names right before `--apply`. Changed definitions mean a new name, never a silent edit.
3. **Datasets.** Upsert `smoke` and `deep` items by stable `id`. Archive items removed from YAML. Each item's metadata gets `content_hash`: sha256 of its canonical JSON `{ input, expected_output, metadata minus content_hash }`. Dataset metadata gets the file name, git SHA and `dataset_hash`, a hash of the sorted `(id, content_hash)` pairs. These stored hashes are informational only: the runner recomputes them from the fetched payloads (2.1 step 6). Canonicalization (`lib/hash.ts`, used by both): sorted object keys, no whitespace, `undefined` dropped, `null` kept. Sync round-trip test: push an item, fetch it back, and its recomputed hash equals the local one (catches any normalization Langfuse applies).
4. Default is a dry run that prints the diff; `--apply` writes. Confirm the item/config field names against `bunx langfuse-cli api __schema` before writing the code.

---

## Phase 2 — Offline experiments + feedback

### 2.1 Experiment runner: `app/evals/run.ts`

```
bun run eval --dataset smoke [--items id1,id2] [--repeat 1] [--concurrency 2] [--max-cost-usd 5] [--name note]
```
1. **Isolated DB.** Set `DATABASE_URL=app/tmp/evals/<run-id>.db` before importing server modules (config is read at import). Run migrations and create an `eval-runner` user row. Keep the file so you can inspect it afterwards.
2. **Boot tools through the production path.** The `phase0-gate.ts:432-434` boot (`registerAll`, `startAll`, `discoverTools`) is not enough. It never calls `hybridSearch.indexTools` or attaches embeddings, so `search_available_tools` would return nothing. Extract `initializeTools()` from `server/index.ts` (`initializeMCP` + reindexer + embedding attach) into `server/boot/tools.ts` and use it in the server, the gate script and the runner. The runner then:
   - waits for the embedding sync (`embeddingSync.idle()`) so every item runs on the same search mode;
   - asserts `hybridSearch.indexed` and a probe search (e.g. `"clinvar variant"`) that returns at least one hit, and aborts before launching items otherwise;
   - records `tools_available`, `search_mode` (`hybrid` | `keyword`) and the embedder id in run metadata.

   **Cleanup.** One idempotent `cleanup()` runs in the runner's `finally` (normal completion and failure) and from SIGINT/SIGTERM handlers. Aborting doesn't finish a turn synchronously: each `processChat` generator still has to reach its `finally`, which closes spans, writes the failed-turn rows and queues online scores. Shutting down tracing before that would drop those spans and scores. So a signal runs these steps in order:
   1. **Stop scheduling.** Set a `stopping` flag, so the item scheduler launches no new item and no new turn of a multi-turn item.
   2. **Abort.** Call the run's `AbortController.abort()` (in-flight turns end as `aborted`).
   3. **Drain.** Await every active task's drain promise (the runner tracks them in a set), bounded at 30 s. On timeout, log the item IDs still running and continue.
   4. **Flush.** Call `shutdownTracing()`, which flushes spans and the `LangfuseClient` score queue within its own timeout. Langfuse requires flushing before an experiment process exits.
   5. **Stop MCP.** Call `stopAll()` with a timeout, so a hung server can't block exit.

   On normal completion and on failure, steps 3–5 run in the same order. A second signal skips the remaining waits and exits immediately. The exit code is non-zero on failure or signal. Test: SIGINT during a fake slow turn → the turn's `finally` (root span end and online scores) runs before `shutdownTracing` is called.
3. **Task per item.** New `sessionId`. For each turn, drain `processChat(sessionId, evalUser, turn, signal, { traceParent, costBudget })`. `traceParent` is the experiment task's active span (read via `getActiveTraceId`/`getActiveSpanId` inside the task callback, which is a plain async function, so context works there). `duration_ms` is wall-clock time around the drain (`chat_turns` timestamps are in whole seconds). Afterwards, read `chat_turns`, `messages`, `model_transcript` and `usage_events` (by `turn_id`) for the session. Return `{ turns: [{ answer, status, error_code, final_finish_reason, tool_calls: [{ name, input, model_output, error }], cost_usd, llm_calls, duration_ms }] }`. Every field comes from a persisted column, and `final_finish_reason` is the new 1a column. Tool outputs come from `model_transcript`, so evaluators see exactly what the model saw.
4. **Item evaluators (code).** `id_grounding`, `checkpoint_recall`, `expected_tool_coverage`, plus `turn_outcome`, `answer_truncated` and `tool_error_count` from the same `turn-signals.ts` as 1a. Skip `reviewed_by: null` items for pass/fail, but still run them.
5. **Run evaluators.** Mean of each score, total cost, p50/p95 latency, failure count.
6. **Pinned, verified hosted dataset.** The runner never runs against an unchecked "latest":
   1. Load the local YAML and compute `dataset_hash` (same function as `sync.ts`).
   2. Capture `version = new Date().toISOString()`, then call `langfuse.dataset.get(name, { version })`.
   3. Never trust the hashes stored in Langfuse metadata: an input or expected output edited in the UI leaves them unchanged. Instead:
      - Recompute each fetched item's `content_hash` from its fetched `input`, `expected_output` and `metadata` (minus `content_hash`) with the same `lib/hash.ts` canonicalization as the local YAML.
      - Check that the set of **active** (non-archived) item IDs equals the local ID set.
      - Recompute `dataset_hash` from those recomputed pairs.

      Compare all of it with the local values. On any mismatch (an unsynced edit, a UI edit, an extra or missing item, or a sync from another branch or developer), fail with the differing IDs and "run `bun run eval:sync --apply`".
   4. Run `dataset.runExperiment(...)` on that fetched object so the run links to items.

   Experiment name: `<dataset>-<git short sha>-<model>[-note][-rN]`. Metadata:
   - model, effort, context_version, git SHA, dirty-tree flag
   - `dataset_version` (the timestamp), `dataset_hash`
   - `evaluators_hash` (sha256 of `app/evals/evaluators/**` + `server/observability/turn-signals.ts`), `metrics_hash` (`metrics.yaml`), and a per-rubric hash
   - the search fields from step 2

   A past run can be reproduced with `--dataset-version <ts>`, which skips the local-hash check and records that it did.
7. **Cost guard (shared budget between model calls).** `usage_events` rows land only at turn end, so a check against them would let concurrent deep items run many priced calls before any cost shows up. Instead the runner passes one `CostBudget` (`{ charge(microusd), check() }`) to every `processChat`:
   - `processChat` keeps `charged` (microusd already sent to the budget). Right after each `meter.record` it charges that call's cost and adds it to `charged`. `check()` runs before each `streamText`.
   - **Reconcile in `finally`.** Calls priced outside `meter.record` (the cut-off estimate `recordFailedTurn` adds through `meter.add`) never pass the per-call charge. So after `recordFailedTurn`, `finally` charges `meter.summary().costMicrousd - charged` when positive. Every priced call, estimates included, reaches the budget exactly once. `charge` never throws (only `check` does), so it is safe in `finally`.
   - Once the cap is hit, `check()` throws, and the turn fails with a new `TurnErrorCode` `"budget_exceeded"` (persisted like any failed turn; `recordFailedTurn` bills what ran).
   - **No scores, enforced explicitly.** `turn-signals` returns no signals for `error_code = "budget_exceeded"`, so the online scorer writes nothing for that turn and the root trace gets tag `budget_exceeded`. The runner's task returns `{ skipped: "budget" }` for the item, and every evaluator (code ones included) returns `null` on that marker. Run evaluators skip these items.
   - No new items launch.
   - Calls already streaming are allowed to finish, so the worst overshoot is about one LLM call per concurrent item. The docs and the `--max-cost-usd` help text state this.
   - Budget-stopped items are listed as `skipped_budget` and excluded from aggregates, so the `turn_outcome` categories don't change.
   - Test: a call cut off mid-stream plus the reconciliation charges the estimate once; a turn that completes normally charges nothing extra in `finally`.

   Default concurrency is 2 (public bio APIs rate-limit).
8. **Repetitions.** Langfuse keeps at most one execution per dataset item per experiment ([data model](https://langfuse.com/docs/evaluation/experiments/data-model)). So `--repeat N` runs N separate experiments (`…-r1` … `…-rN`), each on the same pinned dataset version with fresh sessions (one eval DB per invocation; sessions are already isolated). Their metadata shares a `repeat_group` id. The budget covers the whole group. After the last run, the runner prints per-item, per-score mean / min / max / stddev across the runs and writes them to `app/tmp/evals/<repeat_group>.json`. Variance lives locally until Langfuse supports repetitions natively.
9. **Output.** Console table + Langfuse experiment link(s).

**Verify first:** the turn root nests under the experiment task span via `traceParent`. If it doesn't, fall back to linking by trace ID in the task output and record the finding here.

**Finding (verified 2026-10-12, run `smoke-cdb76d5-claude-sonnet-5-5-probe`):** nesting works; no trace-id fallback needed. Read back via `GET /api/public/v2/observations?traceId=b257c24e62e919e8c904d9af62491687`: `chat-turn` (AGENT) has parent `experiment-item-run`, and every generation/tool span hangs under `chat-turn`. What it took:
- **Async context only in the runner.** The tracer provider is isolated (nothing global), so `getActiveSpanId()` inside the task returned undefined. `initTracing({ registerGlobal: true })` (runner only) calls `provider.register()`, which installs the AsyncLocalStorage context manager; the task callback then reads the `experiment-item-run` span (unit test: `experiment-nesting.test.ts`, Bun 1.3.10). The server still never relies on async context.
- **Nested turns don't own the trace.** With `traceParent`, `TurnTrace` reuses the parent's trace id, stops stamping `langfuse.trace.name` (the trace stays `experiment-item-run`), and online scores go on the turn's own `chat-turn` observation with ids `<traceId>-<observationId>-<name>`, so the turns of a multi-turn item don't overwrite each other. Offline evaluator scores go on the `experiment-item-run` observation (SDK behaviour).
- **One environment.** The SDK stamps `sdk-experiment` on the item span; the runner sets `LANGFUSE_TRACING_ENVIRONMENT=sdk-experiment` so turn spans and all scores share it.
- **`experiment.run`, not `dataset.runExperiment`.** The fetched dataset's `runExperiment` runs every fetched item, archived ones included, and its type omits `data` (no `--items` subset). The runner calls `client.experiment.run({ data: <verified active items>, datasetVersion })`; items keep `id`/`datasetId`, so run items still link.
- Reading scores back: `GET /api/public/v3/scores` needs `fields=core,details,subject` to return `configId` and the observation subject.

### 2.2 Evaluator modules: `app/evals/evaluators/`

`id-grounding.ts`, `checkpoint-recall.ts`, `tool-coverage.ts`, `turn-signals.ts`. Each is a pure function `(taskOutput, item) → Evaluation | null`, unit-tested with fixtures from real transcripts (`__tests__/fixtures/`). `turn-signals.ts` lives in `server/observability/` (the server never imports from `evals/`), and `evaluators/turn-signals.ts` wraps it, so the online and offline paths compute the same values. Required `id-grounding` fixtures:
- **Future-evidence leakage:** an ID invented in turn 1 and retrieved in turn 2 stays ungrounded for turn 1.
- **Failed-turn evidence:** an ID that appears only in a failed turn's tool output doesn't ground a later answer.
- **User-supplied ID:** an ID from the user's own message is grounded.

`turn-signals` gets a fixture with `final_finish_reason: "length"` on an `ok` turn.

### 2.3 User feedback (built now, meaningful once prod is on)

| Piece | Detail |
|---|---|
| DB | `message_feedback` (id, message_id FK→messages, user_id FK, value 1/0 **nullable**, comment, created_at, updated_at, `revision` INTEGER (incremented on every write), `sync_pending` 0/1, `synced_revision`, `synced_at`, unique(message_id, user_id)) + Drizzle migration. `value IS NULL` is a cleared tombstone. |
| API | `PUT /api/messages/:messageId/feedback` `{ value: 1 \| 0, comment? }` and `DELETE` to clear. Ownership via session.user_id. Both write the DB row first (the source of truth) with `revision = revision + 1` and `sync_pending = 1`, return, then hand the row to the feedback sync. Langfuse failures never fail the request. `DELETE` sets `value = NULL` (tombstone) and doesn't remove the row. |
| Score identity | Score id = `fb-` + sha256(`message_id:user_id`) (truncated). Stable across clear → re-create, so a new 👍 overwrites the old 👎 instead of sitting next to it. Never use the row id: a recreated row would get a new one. |
| Feedback sync | `server/observability/feedback-sync.ts`. Writes are **serialized per score id**: an in-process keyed queue (one promise chain per score id, shared by request-triggered syncs and reconciliation) runs at most one push per id at a time, so an older request can never finish after a newer one. Each push reads the **current** DB state (value and `revision`) when it starts, then resolves `assistant_message_id` → `chat_turns.trace_id`. Then it makes one **acknowledged** HTTP write and awaits it. Value set → `ScoreWriter.upsert({ id, traceId, name: "user_feedback", value, comment, environment })` (`POST /api/public/scores`, upsert by id). Tombstone → `DELETE /api/public/scores/{id}` (a 404 counts as success). That is the only score-delete endpoint, and it is not deprecated. The SDK exposes it only under `api.legacy.scoreV1`, a namespace whose `create` already carries `@deprecated`, so `delete` could move or disappear in a future SDK bump. Feedback sync therefore never calls the SDK for writes. It talks to a two-method port, `ScoreWriter { upsert(body): Promise<void>; remove(id): Promise<void> }`, implemented in `server/observability/score-writer.ts` (~40 LOC) as plain `fetch` calls to `POST /api/public/scores` and `DELETE /api/public/scores/{id}`. They use Basic auth from the same keys and a 10 s `AbortSignal.timeout`. A non-2xx response throws (except 404 on delete). Both endpoints are part of the public API contract, so SDK upgrades can't break them; tests use a fake `ScoreWriter`. Never use `langfuse.score.create` here: it returns `void` and only queues the event, and its flush logs batch and transport errors without rejecting (`packages/client/src/score/index.ts`). So a queued upsert could be marked synced without being delivered, or land after a later delete. A push counts as successful only when the awaited call resolves; any throw (network, 4xx/5xx, timeout) leaves `sync_pending = 1`. On success it sets `synced_revision = <pushed revision>` and clears `sync_pending` only if `revision` still equals the pushed revision (compare-and-set on the revision, not `updated_at`, which has whole-second precision, so two rapid clicks can share it). A click during the push leaves `sync_pending = 1`, and the queue runs another push for that id right after. The queue assumes one app process (true on Fly today); with more machines, move the lock to the DB (a lease column) and note it here. Rows whose turn has no `trace_id` (tracing was off) are marked synced with no remote write. |
| Reconciliation | On boot and every 5 min while tracing is enabled, retry rows with `sync_pending = 1`, using backoff and logging `logger.warn("TRACE", "feedback_sync_failed")`. Rapid toggles converge: pushes for one id never overlap, each is acknowledged before the next starts, each sends the latest DB state under a fixed id, and `sync_pending` stays set until the newest revision has been acknowledged. Langfuse applies writes asynchronously after acknowledging them, so before marking a **tombstone** synced the worker also confirms the score is absent via `GET /api/public/v3/scores` (id filter). If it is still present after the ingestion lag (retry for about 2 min), it deletes again; otherwise the row stays pending for the next pass. This covers an acknowledged upsert that is processed after the delete. **Verified 2026-10-12: Langfuse does not order a create and a delete for one id, so the confirm read stays.** Upserts are acknowledged (200) and become readable via v3 after ~10–26 s; deletes are queued (202) and apply in ~1 s. A create followed at once by a delete left the score absent for ~25 s, then it reappeared (the delete was applied before the create was ingested). Create(0) → delete → create(1) ended at one score with value 1. So the first confirm read happens 60 s after the delete is acknowledged, then every 15 s up to 2 min; a newer write to the row ends the wait early (its own push follows). Verified in dev on trace `6ec0676fe78cabb948a68baf2354dd39`: 👎 + comment landed as `user_feedback` (env dev); clear → 👍 left exactly one score (value 1); a 👎 given with Langfuse unreachable returned 200, stayed pending and landed on the next boot's reconciliation; clearing it removed the score after the confirm read. Probe data deleted. |
| History | Sessions route returns the current user's non-null feedback per assistant message |
| UI | Thumbs on assistant `MessageBubble`; optional comment box on 👎; state in `chatStore`; disabled while streaming |
| Tests | Route tests (ownership, upsert, clear, clear → re-create keeps the score id); `score-writer` tests with a stubbed `fetch` (auth header, body, 2xx resolves, 404 on delete resolves, 5xx and timeout reject); sync tests with a fake `ScoreWriter` whose `upsert` / `remove` return promises the test resolves or rejects (upsert, delete, 404 on delete; transport failure and a 5xx reject → `sync_pending` stays 1 and `synced_revision` is unchanged; create → clear: the delete is not sent until the create has resolved, and the row is marked synced only after the delete resolves and the confirm read shows no score; confirm read still sees the score → delete is retried; 👎 push held open by the fake client while a 👍 arrives: the 👍 push starts only after the 👎 one finishes, the final remote value is 1 and `sync_pending = 0`; two writes in the same second still bump `revision`); store tests |

The client never sees trace IDs; the server maps `messageId` → turn → trace.

### 2.4 Model / effort comparison (arms)

Run one pinned dataset against several Anthropic setups ("arms": model + effort) and compare accuracy, cost and latency. Built on 2.1; tracked in its own ticket.

```
bun run eval --dataset smoke --matrix sonnet-effort
bun run eval --dataset smoke --arm claude-sonnet-5-5:high --arm claude-haiku-5-5:high [--repeat 2]
```

1. **Per-turn LLM settings (prefactor).** `chat-v2.ts` freezes `loadLLMConfig()` and `chatProviderOptions()` at import, so one process can't run two arms. `processChat` gets an optional `llm` override (`model`, `effort`, `max_output_tokens`); without it the turn uses app config exactly as today. Pricing, generation fields, `chat_turns` and `usage_events` use the effective setting. Own refactor commit.
2. **Capability check.** No local capability table. Before any spend the runner calls `GET /v1/models/{id}` per arm and fails if the model is unknown or `capabilities.effort.<level>` is unsupported. Verified 2026-10-12: `claude-haiku-5-5` supports adaptive thinking and all five effort levels, and rejects `budget_tokens` (`thinking.types.enabled: false`), like Sonnet 5.5 and Opus 5.5. The request shape stays adaptive thinking + `effort`.
3. **Arms.** Git-tracked matrix files in `app/evals/matrices/<name>.yaml` (list of `{ model, effort, max_output_tokens? }`), or repeatable `--arm <model>:<effort>`. No arm = production config. The default per-arm `max_output_tokens` is raised so xhigh/max aren't cut by the 16k cap (it includes thinking). `max_context_tokens` is the same for every arm so the history budget doesn't confound the comparison.
4. **Execution.** One dataset version pinned for all arms. One experiment per arm, linked by `comparison_group`. Arms run sequentially (items within an arm keep 2.1 concurrency) so bio-API load is the same per arm. `--repeat N` applies per arm. One `--max-cost-usd` budget covers the matrix; remaining arms become `skipped_budget` once it's hit. A per-arm cost estimate is printed before starting. Name: `<dataset>-<sha>-<model>-<effort>[-note][-rN]`. Metadata adds provider, `thinking_display`, `max_output_tokens`, `max_context_tokens`, `comparison_group`.
5. **Comparison report.** `app/tmp/evals/<comparison_group>.{json,md}` and a printed table. Per arm: mean per score (± min/max/stddev with repeats), `turn_outcome` breakdown, `answer_truncated` rate, total and per-item cost, pricing tier hit (Haiku 5.5 long-context rates above 100k input), p50/p95 latency, mean LLM and tool calls. Differences smaller than the repeat spread are marked "within noise"; per-item disagreements between arms are listed.
6. **Pricing.** Add Opus 5.5. `assertPricingConfigured` runs for every arm model before starting.

**Deferred: other providers (e.g. OpenAI chat).** Needs a provider in `server/llm/provider.ts`, mapping our effort levels to the provider's own, pricing and usage-key mapping (incl. cached tokens), tool-schema compatibility checks, and judges from neither compared provider (self-preference bias). Arm metadata already records `provider`, so the format won't change.

### Exit criteria
- `bun run eval --dataset smoke` completes and shows per-item scores and run aggregates in Langfuse.
- Two runs (e.g. `effort: medium` vs `high`) compare side by side.
- 👍/👎 in dev shows up as `user_feedback` on the right trace.
- Clearing 👎 and then giving 👍 leaves exactly one `user_feedback` score (value 1) on the trace; feedback given while Langfuse is unreachable lands after reconciliation.
- A `--repeat 2` smoke run produces two linked experiments and a local variance report.
- A model/effort matrix (e.g. Sonnet 5.5 low/medium/high, Sonnet 5.5 vs Haiku 5.5) produces linked experiments and a local comparison report (2.4).

---

## Phase 3 — Prod enablement

1. **Privacy.** User questions go to Langfuse Cloud (region of `LANGFUSE_BASE_URL`; currently `https://us.cloud.langfuse.com`, US). Done: a privacy line on the request-access page (`app/web/app/request-access/page.tsx`; there is no separate terms page). The page is a static export, so the region is written in the text: **update the line if `LANGFUSE_BASE_URL` moves region.**
   **Masking decision (2026-10-12): no `mask` function.** Rationale:
   - The question and answer *are* the eval data. Masking them would break error analysis, `promote.ts` and judges (Phases 4–5).
   - Trace `user.id` is the internal DB user id (`middleware/clerk.ts`), not an email or Clerk id. No names, emails or waitlist fields are put on spans.
   - Tool inputs/outputs are queries to and records from public biology databases.
   - No credentials pass through spans (keys live in env; MCP calls carry only tool arguments).
   - Generation input defaults to the per-call delta (`full_generation_input: false`), which limits duplication.
   Revisit if users start pasting patient-level data (e.g. clinical-trial work with PHI) or if an org requires it; then add a `mask` that redacts by pattern rather than dropping content.
2. **Release.** Done: `Dockerfile` declares `ARG GIT_SHA` → `ENV GIT_SHA` in the final stage (last layer, so it doesn't bust the cache), and `.github/workflows/deploy.yml` passes `--build-arg GIT_SHA="${GITHUB_SHA::7}"`. `resolveRelease` reads it. A manual deploy needs `fly deploy --build-arg GIT_SHA=$(git rev-parse --short HEAD)`; without it, `release` is `unknown` (the image has no `.git`).
3. **Shutdown flush.** Verified in code: `server/index.ts` handles SIGTERM and SIGINT, aborts and drains in-flight turns (≤2 s, which ends their traces), then awaits `shutdownTracing` (provider + score client, ≤2.5 s) before `process.exit`. `fly.toml` now pins `kill_signal = "SIGTERM"` and `kill_timeout = "5s"` (Fly's default signal is SIGINT; both are handled) so the 4.5 s budget is explicit. Still to confirm live: the last turn before a deploy appears in Langfuse.
4. **Sampling and retention.** No sampler is configured, so 100% of turns are traced (right for current volume). Set data retention in the Langfuse UI (owner).
5. Ships via the normal develop → main merge.

### Owner checklist (manual; the agent does not run these)

1. Set Fly secrets (one command, so the machine restarts once):
   ```
   fly secrets set -a super-bio-agent \
     LANGFUSE_PUBLIC_KEY=pk-lf-... \
     LANGFUSE_SECRET_KEY=sk-lf-... \
     LANGFUSE_BASE_URL=https://us.cloud.langfuse.com \
     LANGFUSE_TRACING_ENVIRONMENT=prod
   ```
   Use the same project as dev (environments separate the data) unless you want a separate prod project. Check with `fly secrets list -a super-bio-agent`.
2. Langfuse UI → Project settings → Data retention: pick a window (e.g. 90 days; must cover Phase 4 trace review).
3. Merge develop → main. After the deploy:
   - The boot log has `tracing_enabled` with `environment: prod` and the short sha as `release`.
   - A prod turn shows in environment `prod` with online scores, `release` = the deployed sha.
   - A 👍/👎 in prod lands as `user_feedback` in `prod`.
   - Send a turn just before the next deploy and confirm it appears (SIGTERM flush).
4. Optional: delete the spike traces/score listed under "Verified facts".

---

## Phase 4 — Error analysis

1. Make an annotation queue in Langfuse with a free-text notes score. Fill it from:
   - negative `user_feedback`
   - `turn_outcome != ok`
   - `answer_truncated`
   - smoke/deep experiment failures
   - about 10 random prod traces (baseline)
2. Read about 30 traces. Write one note per trace on the first, most upstream failure (pipeline Stage 3).
3. Group the notes into `app/evals/failure-modes.md`: name, one-line definition, count, severity, example trace links. Keep reviewing until new traces stop adding modes.
4. Split the results into a **fix list** (obvious causes: fix directly) and **eval candidates** (likely to recur or needing nuance).
5. `app/evals/promote.ts --trace <id>` drafts a YAML item from a trace (turns + `source: trace:<id>`, empty expected output for you to fill in). Grow smoke to 15–20 items.
6. Add a `failure_mode` CATEGORICAL score config once the taxonomy is stable.

## Phase 5 — Calibrated LLM judges

Candidate metrics come from the target-selection review dimensions and the Phase 4 taxonomy:
- `claim_support` (a real ID attached to the wrong claim)
- `intervention_direction`
- `counterevidence_handling`
- `disease_specificity`
- `limitation_disclosure`

1. **Labels.** 30–50 human pass/fail labels per metric from Phase 4 traces, split into dev and held-out sets.
2. **Judge.** Prompt in `app/evals/judges/<metric>.md` (git-versioned) with the rubric and 1–2 examples. Anthropic model only (Haiku 4.5 for cheap screening, Sonnet 5.5 where nuance matters).
3. **Calibration.** Measure TPR/TNR against the labels. Iterate on the dev set, report on the held-out set, and set an agreement bar per metric before use (follow the Langfuse judge-calibration reference).
4. **Deploy.** Offline as runner evaluators. Online as a Langfuse evaluator on a sample of prod traces (check the target filter matches the right observations and doesn't double-score).
5. Re-check agreement whenever the judge prompt, judge model or agent changes.

## Phase 6 — Automation

- **Detection signals** as online scores:
  - `repeated_question` (same session, high similarity to an earlier user turn)
  - outlier flags for latency, cost, tool count and iterations
  - frustration phrases
- **Clustering** of prod user queries for coverage sampling (once volume justifies it).
- **CI gate.** Run the smoke subset on PRs touching `orchestration/`, the system prompt, tool policies or `config.yaml` model settings (`langfuse/experiment-action`), with thresholds on `id_grounding`, `turn_outcome` and cost.
- **Repeatability.** `--repeat 3` on deep before releases (three linked experiments per 2.1 step 8); track variance per item.
- **deepagents experiment arm** (optional): same datasets, compared on the same metrics.

---

## Fix list (found while planning; not eval infra)

1. **Truncated answers are saved as successes.** If the final call ends with `finish_reason: "length"`, `chat-v2.ts` (~355) persists the cut-off text and marks the turn `ok` (seen in run `p01-r01`). **Decision (2026-10-10):** keep the current behaviour. Phase 1a only measures it (`answer_truncated` score plus `finish_reason` in generation metadata). The behaviour fix is deferred to the planned compaction/handoff work, which will use this score as its baseline.

## Risks

| Risk | Mitigation |
|---|---|
| `chat-v2.ts` near the 500 LOC limit | Logic lives in `turn-trace.ts`; split the stream loop first if needed |
| Context loss in the async generator | Explicit parents + stamped attributes (verified in spike) |
| Ingestion volume | Delta generation inputs; tool outputs already capped (~15 KB) by large-output handling |
| v4-only API for reads | Scripts use v2 observations / v3 scores; check CLI commands hit v4 endpoints |
| Live data drift breaks expected outputs | `volatile` flag, checkpoints with aliases, retrieval dates in metadata |
| Eval cost and bio API rate limits | Small datasets, concurrency 2, `--max-cost-usd` checked between model calls (overshoot ≤ ~1 call per concurrent item) |
| Hosted dataset drifts from git | Hashes recomputed from fetched payloads plus active-ID set check against local YAML, pinned `dataset_version`, evaluator/metric/rubric hashes in run metadata |
| Offline and online scores disagree | Both compute from persisted rows through `turn-signals.ts` (`final_finish_reason` and `tool_error_count` stored on `chat_turns` for every outcome) |
| Feedback lost, duplicated or stale in Langfuse | DB is the source of truth; deterministic score id; per-id serialized pushes with revision compare-and-set; `sync_pending` + reconciliation |
| AI-drafted expected outputs treated as truth | `reviewed_by` gate; unreviewed items run but don't count toward pass/fail |
| Tracing outage affects users | Never-throw wrapper; no-op when disabled or keys missing |

## Commit plan

1. `build(app): add pinned langfuse and opentelemetry deps`
2. `feat(observability): langfuse tracer setup and TurnTrace` (+ tests)
3. `feat(chat): trace turns, llm calls and tool calls` (+ `chat_turns.trace_id` / `final_finish_reason` / `tool_error_count` migration)
4. `feat(observability): online code scores for turn outcome, truncation, tool errors`
5. `feat(evals): eval home with datasets, metrics registry, rubrics, schema tests`
6. `feat(evals): sync datasets and score configs to langfuse`
7. Phase 2:
   - `refactor(server): shared initializeTools boot for server, gate and eval runner`
   - `feat(chat): optional cost budget checked between model calls`
   - `feat(evals): experiment runner + code evaluators`
   - `feat(chat): message feedback as langfuse scores with sync and reconciliation`
   - `refactor(chat): per-turn llm settings override`
   - `feat(evals): model and effort comparison arms with report`

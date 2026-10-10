# Context Assembly + Prompt Caching Plan

**Status:** Phases 1–3 done (validated 2026-10-10) · **Date:** 2026-10-09 · **Scope:** Anthropic chat loop (`app/server/orchestration/chat-v2.ts`)

## Goal

Every LLM call in a turn sends a **fixed prefix** (tools + system prompt). The conversation only ever grows at the bottom. Tools that aren't core are **declared once as deferred**, and their descriptions load **at the point in the conversation** where `search_available_tools` finds them. Prompt caching is turned on and charged correctly.

```
tools:    core tools + system__search_available_tools + system__inspect_artifact   (loaded)
          + every other registered tool, defer_loading: true, sorted by name      (hidden)  ← never changes
system:   SYSTEM_PROMPT                                          [cache breakpoint 1]       ← never changes
messages: user → assistant(tool_use search) → tool_result[tool_reference × N, no text]
          → assistant(tool_use chembl__…) → tool_result → …      [cache breakpoint 2: last message, moves forward each call]
```

## Decisions (agreed 2026-10-09)

| # | Decision | Choice |
|---|---|---|
| 1 | How found tools reach the model | **`tool_reference` blocks inside the search tool's result.** Built natively by the AI SDK, with no fetch wrapper and no bookkeeping by message position. They're visible to AI SDK tracing. **Phase 0 gate (2026-10-09): the shape first specified (and in issue #17), a text part plus `tool_reference` parts in one `tool_result`, failed with 400 ("cannot be mixed with other content"). The revised references-only shape passed, and the gate passes on that revised design.** No fallback to `tool_addition` is needed: the text part was redundant, because each reference expands to the full tool definition (see Phase 0 check 2 and 1b). |
| 2 | Tool masking / `tool_removal` | **Not now.** Additions only (discovery). See Phase 5. |
| 3 | Sending mid-conversation system messages | **Native in `@ai-sdk/anthropic` 4.x**: a `role: "system"` message in `messages` with `providerOptions.anthropic.toolChanges`, and `allowSystemInMessages: true` on `streamText`. No fetch wrapper. Only Phase 5 needs it. (Revised 2026-10-09; it was a fetch wrapper, back when the provider rejected these messages.) |
| 4 | Cache across user turns (lossless history) | **Phase 4b.** Phases 1–3 cache within a turn only. Phase 4 is split into three projects (4a thinking, 4b transcript, 4c artifacts; agreed 2026-10-09). |
| 5 | Gemini | Keeps current behaviour behind a provider check (no deferred-loading equivalent). |
| 6 | Cost accounting | Cache reads and writes (5m/1h) priced separately, **per call**, with an optional long-context tier per model (Haiku 5.5: > 100K prompt tokens). **Ships together with caching.** See Phase 2. |
| 7 | AI SDK version | **Upgrade first** to `ai` 7.x + `@ai-sdk/anthropic` 4.x + `@ai-sdk/google` 4.x, as its own commit before Phase 0. That way the gate tests the SDK we ship, and no code or stored messages are written against v6. Breaking changes are listed under "Step 0 — SDK upgrade". (Agreed 2026-10-09.) |

## Baseline (real data, before any change)

From `logs/app.log`, `cache_diag` events, session `c7525aa4`, 2026-10-09 18:36 UTC. The data came from the temporary diagnostic block currently uncommitted in `chat-v2.ts:428-452`. Measured **before** `dfe0213` (search `top_k` 15 → 5), so each search then activated up to 15 tools; today it activates up to 5. The Phase 3 re-run measures the current state.

- `cache_read = 0` and `cache_write = 0` on **every** call. No caching is requested.
- Within one turn, `tool_count` goes 10 → 25 → 26 and `tools_hash` changes each time, so the prefix is rebuilt each time (the jump of 15 is one search's `top_k` at the time).
- One 6-call turn sent 4,399 + 7,604 + 8,232 + 9,231 + 11,477 + 25,418 = **66,361 uncached input tokens** (≈ $0.133 at $2/MTok).
- Projection for the same turn with a stable prefix: about 41K tokens read from cache at $0.10/MTok, plus about 25K written at $2.50/MTok ≈ **$0.067, about 50% lower input cost**. This is an estimate; Phase 3 measures the real number. (Corrected 2026-10-09: Sonnet 5.5 cache reads are $0.10, not $0.20; see Phase 2.1.)

## Root causes being fixed

1. No `cacheControl` anywhere.
2. Found tools are added to the `tools` list mid-turn (`runSearchTool`, `tool-dispatch.ts:146-167`): up to `top_k` (`tool_search.top_k` in `app/config.yaml`, currently 5) definitions per search. (The earlier mismatch, where the search returned 15 but the model was shown only 8 so 7 hidden definitions were added, is already fixed by `dfe0213`: `top_k` is 5 and the search output lists every tool it activates.)
3. `inspect_artifact` is added on the fly (`chat-v2.ts:215`).
4. Tool order comes from the registry Map's internal order (`mcp/registry.ts:120`), not sorted.
5. Cost is computed from total `inputTokens` summed over a turn (`chat-v2.ts:413`, `usage.ts` `calculateChatCost`). Cached reads would be overcharged and cache writes undercharged, per-request long-context tiers can't be applied, and failed turns aren't recorded (Phase 2.0).

---

## Step 0 — SDK upgrade (own commit, before Phase 0)

`ai` 6 → 7, `@ai-sdk/anthropic` 3 → 4, `@ai-sdk/google` 3 → 4 (decision 7). Done before any code or transcript rows are written, because stored `ModelMessage` JSON follows the SDK version's shape (Phase 4b). Breaking changes from the v7 migration guide that touch this code:
- `streamText({ system })` → `instructions` (the old name is a deprecated alias that still works).
- `await result.response` / `result.providerMetadata` → `(await result.finalStep).response` / `.providerMetadata` (old names are deprecated aliases). The Phase 2 meter reads `cache_creation` from `finalStep.providerMetadata.anthropic.usage`.
- `result.usage` now sums all steps. We run one step per `streamText` call (tools have no `execute`, no `stopWhen`), so the values don't change.
- `fullStream` → `stream` (needed for reasoning deltas, Phase 4a).
- `role: "system"` inside `messages` is rejected unless `allowSystemInMessages: true`. That only matters for Phase 5, and only server-written messages go there.
- Request bodies aren't kept in step results by default (`include.requestBody`). The Phase 4b.6 byte-hash check uses a logging `fetch` instead.
- Bun + `"type": "module"`: the ESM-only / Node 22 requirements are already met. `zod` range `^3.24.0` → `^3.25.76` (peer requirement; 3.25.76 is already installed).
- `createGoogleGenerativeAI` → `createGoogle` (deprecated alias works). The embedding model (`gemini-embedding-001`) and the Gemini chat path need a smoke test.
- Gains: `thinking.display`, effort `xhigh`, `between_tools`, and **native mid-conversation system messages with `toolChanges` (`tool_addition` / `tool_removal`) and per-message `effort`/`clearAt`.** That makes the earlier `fetch` wrapper design unnecessary (decision 3, Phase 5).
- Done when: types fixed, `bun test` passes, manual Anthropic + Gemini chat, embeddings check.
- **Status (2026-10-09): done except the live Gemini check.** Installed `ai` 7.0.137, `@ai-sdk/anthropic` 4.0.78, `@ai-sdk/google` 4.0.93, zod `^3.25.76`. `instructions` accepts a `SystemModelMessage`; checked live: `providerOptions.anthropic.cacheControl` on it is sent as `cache_control` on the system text block. The chat loop uses `textStream`, not `fullStream`, so there was nothing to rename there yet (Phase 4a switches to `stream`). `ToolExecutionOptions` now requires `context` (was `experimental_context?`); the manual `execute` call passes `context: undefined`. Gemini chat + embeddings were checked offline (stubbed `fetch`, request shapes verified) because no `GEMINI_API_KEY` was available locally; a live Gemini check (chat with a tool round-trip, so thought signatures replay, plus embeddings) is still owed before Step 0 counts as fully done.

## Phase 0 — Live check of `tool_reference` (gate)

Runs on the upgraded SDK (decision 7). `tool_reference` via the AI SDK is confirmed only in the provider source: `@ai-sdk/anthropic` 4.x `convert-to-anthropic-prompt.ts` (the `tool-reference` custom tool-result part becomes `tool_reference`) and `anthropic-prepare-tools.ts` (`deferLoading`). Before this gate it hadn't been tested against the live API; the gate below did that (see Status/Results).

Note: the provider line references in this plan were re-located during Step 0 (2026-10-09). The 4.x packages ship ESM-only `dist/index.js` (no `index.mjs`); references are to `@ai-sdk/anthropic` 4.0.78 and `@ai-sdk/google` 4.0.93 and marked "(4.0.78)" / "(4.0.93)". The behaviour carried over; differences are noted inline.

Write a throwaway script in `experiments/` (gitignored) using `streamText` with the real tool catalog:

1. All non-core tools have `providerOptions.anthropic.deferLoading: true`. Check: request returns 200; record `inputTokens` with the deferred tools present vs. absent, to confirm deferred definitions aren't billed.
2. Call 2 replays a `search_available_tools` result whose output is `{type: "content", value: [{type: "text", …}, {type: "custom", providerOptions: {anthropic: {type: "tool-reference", toolName}}}]}`. Check: the model can call a referenced tool. (Result: this mixed shape, as specified in #17, returns 400; the revised `tool-reference`-only shape works. See Status/Results.)
3. Calls 2 and 3 carry a cache breakpoint. Check: `cache_read > 0` and the tools/system hashes stay the same.
4. A search result that references a tool that is **already loaded** (a core tool). Check: the API accepts it. (Result: accepted, 200, so no fallback is needed. Had it returned 400, the fallback could not have been "list loaded tools in a text part": with references-only results (check 2), a text part next to references is itself a 400. It would have had to leave loaded tools out of the result entirely; they're already declared in `tools`.)
5. Minimum cacheable prompt length for `claude-sonnet-5-5`: look it up in the prompt-caching docs, then check it live. Call 1 is only about 4.4K tokens (Baseline). Check: call 1 reports `cache_write > 0`. If the prefix is under the minimum, caching silently does nothing on call 1; record that as expected and judge Phase 3 from call 2 onwards.

**If it fails:** switch discovery to `tool_addition` system messages (native `toolChanges` provider option, see Phase 5 mechanics), and redo the decision 1 trade-off.

**Status/Results (2026-10-09): gate passes on the revised search-result shape.** Check 2 as originally specified (and in issue #17), a text part plus `tool_reference` parts in one `tool_result`, **failed with 400** ("Tool definitions/code execution functions cannot be mixed with other content"). The revised **references-only** shape passed: the model called the deferred tool it referenced. Checks 1, 3, 4 and 5 pass as specified. Decision 1 (`tool_reference` in the search result) stands with that revision, and no fallback to `tool_addition` is needed: the text summary was redundant, because each reference expands to the full tool definition, description included (1b updated).
- Setup: `experiments/phase0-gate.ts` (gitignored), run as `cd app && LOG_LEVEL=ERROR bun ../experiments/phase0-gate.ts [all|1|2|3|4|5]` (`2` and `3` run the same call sequence). Each check records explicit verdicts: `required`, `expected-negative` (the mixed shape must return 400 with the mixed-content error) or `warn` (reported only). The script prints a call table and a verdict table and exits 1 if any non-`warn` verdict fails. `all` runs check 5 first, then 1, then the clean 2/3 sequence (call 1 → call 2 references-only → call 3), then the call-2 shape probes A and B, then 4, so no check warms another's prefix. Every sequence gets its own per-run nonce, appended to the description of `system__search_available_tools` (a loaded tool). Tools render before system, so a new nonce makes the whole tools + system prefix cold; within a sequence it's constant. The nonce adds 12 tokens to every prompt, so the numbers below are 12 above the earlier contaminated runs. Each call is labelled `cold`, `warm` or `none` (no cache markers). Model `claude-sonnet-5-5` (from `app/config.yaml`), `ai` 7.0.137, `@ai-sdk/anthropic` 4.0.78, live Anthropic API with the app's `ANTHROPIC_API_KEY` (`app/.env`). Real catalog: the script starts the unified MCP server in-process (`mcpManager.startAll()` + `toolRegistry.discoverTools`), giving 200 MCP tools from 9 platforms (uniprot disabled). Declarations are built with `toolRegistry.getVercelTool` (the `[server] description` format) plus `createSearchTool()` and `createInspectArtifactTool()` with `execute` removed (`toDeclarations`), sorted by name. That makes 202 tools: 11 loaded (9 `ALWAYS_LOADED_TOOLS` + the 2 system tools) and 191 deferred. Real `SYSTEM_PROMPT`; the user message is "Reply with exactly the word OK. Do not call any tools."; `maxOutputTokens: 256`. A `fetch` wrapper records the HTTP status and request body. The provider sends `defer_loading: true` on all 191 tools and needs no extra beta (only `structured-outputs-2025-11-13`, which the provider always adds).
- Numbers below are from one clean `cd app && … phase0-gate.ts all` run (2026-10-09): exit 0, 21 verdicts, all pass, 0 warnings.
- **Check 1: passes.** All requests returned 200 (asserted: all 200, 191 of 202 tools sent with `defer_loading`, deferred delta ≤ 500 tokens and ≥ 20× smaller than the all-loaded delta). `inputTokens`, all uncached (no cache markers):

  | Variant | Tools sent | Deferred | `inputTokens` |
  |---|---|---|---|
  | core only (deferred tools absent) | 11 | 0 | 4,653 |
  | core + 191 deferred | 202 | 191 | **4,746** |
  | control: all 202 loaded | 202 | 0 | 39,003 |

  The 191 deferred definitions add **93 tokens** in total, against about 34,350 tokens if they were loaded. That's a fixed overhead, probably the API's note that deferred tools exist; it isn't per tool. Deferred definitions aren't billed. Since the 93 tokens are part of the cached prefix (see check 5), they're paid once per cache write.
- **Check 5: passes.** The minimum cacheable prompt length for `claude-sonnet-5-5` is **512 tokens** ([prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), "Cache limitations", fetched 2026-10-09; same as Opus 5.5 / Haiku 5.5; Haiku 4.5 is 4,096). Shorter prompts are silently not cached. Live, first call of the run on a fresh nonce (cold): call 1 (the 202-tool catalog with 191 deferred, and `instructions` as a `SystemModelMessage` with `cacheControl: {type: "ephemeral"}`) returned `inputTokens` 4,746 = `noCache` 96 + `cacheRead` 0 + **`cacheWrite` 4,650** (asserted: 200, prompt ≥ 512, `cacheRead` = 0, `cacheWrite` > 0). In `providerMetadata.anthropic.usage.cache_creation`, `ephemeral_5m_input_tokens` was 4,650 and `ephemeral_1h_input_tokens` was 0. So call 1 already writes the cache: the tools + system prefix (about 4.6K) is roughly 9× the minimum. Phase 3 can expect `cache_read > 0` from call 2 onwards.
- **Checks 2–4 setup (#17).** Same 202-tool catalog, `SYSTEM_PROMPT` and model. Every call uses the 1d markers on a copy of the messages: `instructions` with `cacheControl`, plus message-level `cacheControl` on the last message and on the previous call's last message. `maxOutputTokens` is 512–1024 so adaptive thinking doesn't cut off the tool call. The fetch wrapper records the serialized request body. The script logs sha256 of `body.tools` and `body.system`, the `tool_reference` names found inside `tool_result` blocks, and which blocks carry `cache_control`. The search hits are fixed (`chembl__get_mechanism_of_action`, `open-targets__get_drug_info`, `chembl__get_drug_info`, all deferred), so the result doesn't depend on the embedding index.
- **Check 2: the original shape (#17) fails with 400; the revised references-only shape passes.** The sequence:
  - Call 1 (live, cold): the user asks for imatinib's mechanism of action in ChEMBL. The model called `system__search_available_tools` with query "ChEMBL drug mechanism of action". That `tool_use` is kept as it is. (If the model doesn't search, the script constructs the `tool_use` and reports a `warn` verdict saying so; it didn't happen in this run.)
  - Call 2 replays that `tool_use` plus result C. Shapes A and B are probes run after call 3 on the same history, so they can't warm the clean sequence:

    | Search result shape | HTTP | Model called |
    |---|---|---|
    | **C (call 2): `tool_result` with 3 `tool-reference` parts only** | **200** | **`chembl__get_mechanism_of_action`** with `{chembl_id: "CHEMBL941"}` |
    | A (probe, expected 400): text part (name + score) + 3 `tool-reference` parts in one `tool_result` (the original 1b / #17 shape) | **400** `invalid_request_error`: "Tool definitions/code execution functions cannot be mixed with other content" | n/a |
    | B (probe): `tool_result` with 3 references only, then the text as a separate user text block in the same user message | 200 | `chembl__get_mechanism_of_action` |

  - The request body shows the custom parts serialized as `{"type":"tool_reference","tool_name":…}` inside `tool_result.content`, all 3 names. The model called a deferred tool that only the reference had loaded, with the right argument.
  - This matches the tool-search docs: their custom-search example returns `tool_result.content` made only of `tool_reference` blocks. Variant B works but puts server text in the user role, so 1b uses C.
- **Check 3: passes.** Calls 1 → 2 (shape C) → 3 (call 2's assistant message plus a stubbed `chembl__get_mechanism_of_action` result), back to back on a fresh nonce:

  | Call | Cache | `inputTokens` | `noCache` | `cacheRead` | `cacheWrite` (5m) | `cache_control` on |
  |---|---|---|---|---|---|---|
  | 1 | cold | 4,797 | 4 | 0 | **4,793** | system, user msg |
  | 2 | warm | 5,249 | 2 | 4,793 | 454 | system, user msg (previous last), search `tool_result` (last) |
  | 3 | warm | 5,416 | 2 | **5,247** | 167 | system, search `tool_result` (previous last), tool `tool_result` (last) |

  - Asserted: all 200; call 1 `cacheRead` = 0 and `cacheWrite` > 0; call 2 reads at least everything call 1 cached (4,793 ≥ 4,793); call 3 reads at least everything call 2 cached (5,247 ≥ 4,793 + 454); `tools` and `system` hashes identical across calls 1–3. The hashes depend on the run's nonce, so they differ between runs; `system` was `d47f804aa8f2` on every cached call.
  - Call 1 is a genuine cold write of the whole prompt (tools + system + user message). Call 2 reads exactly call 1's whole prompt (the previous-last breakpoint hit). Call 3 reads all of call 2's prompt except 2 tokens. The `tool_reference` expansion is cached like any other content and doesn't disturb the prefix.
  - The AI SDK put message-level `cacheControl` on the last block of the message (`tool_result` for tool messages, `text` for the user message), as 1d expects.
- **Check 4: passes. Referencing an already-loaded tool is accepted (200).**
  - 4a (cold, own nonce): a references-only result naming `chembl__search_compounds` (core, loaded) and `chembl__get_mechanism_of_action` (deferred) → 200. The model called `chembl__search_compounds`.
  - So `runToolSearch` (1b) does **not** need to leave loaded tools out of the references; every hit shown gets a `tool-reference` part.
  - 4b, an extra check for parallel tool calls: one assistant message calls the search tool and a core tool, and the user message carries a references-only `tool_result` next to a plain-text `tool_result` → 200. The model called `chembl__get_mechanism_of_action`. The "mixed content" rule applies inside one `tool_result`, not across the results of a parallel batch.
- Cost of the gate run: 11 calls of about 5K input tokens (one 39K all-loaded control), mostly cache writes and reads.
- Docs facts to keep (tool search docs, fetched 2026-10-09): a deferred tool **can't carry `cache_control`** (returns 400), which matches 1d putting the breakpoint on the system message. At least one tool must be non-deferred. A custom search tool returning `tool_reference` blocks in a normal `tool_result` is supported, and every referenced name must be in `tools` (otherwise 400 "Tool reference '…' not found").

## Phase 1 — Fixed prefix + discovery by reference

### 1a. Tool catalog (new: `app/server/orchestration/context/tool-catalog.ts`)
- `buildToolCatalog(provider, sanitize)` returns declarations for **every registered tool** (`toolRegistry.getAll()`), **sorted by name**, plus the two system tools.
- Anthropic: core (`ALWAYS_LOADED_TOOLS`), `system__search_available_tools` and `system__inspect_artifact` are loaded; all others get `providerOptions: { anthropic: { deferLoading: true } }`. At least one tool must stay loaded, or the API returns 400 "All tools have defer_loading set".
- Ignore the registry's `available` flag when building the list. If it flips mid-session the tool list would change. A call to a tool whose server is down returns an ordinary error result instead. Platforms disabled in `config.yaml` are never registered, so they are fixed per deploy.
- **Keep an "all servers down" check, separate from the catalog.** Today `coreToolCount === 0` (`chat-v2.ts:340`) catches it because core tools are filtered by `available`. A catalog that ignores `available` always has tools, so that check would never fire and the chat would run with every tool call failing one by one. Replace it with `toolRegistry.availableCount === 0` before the loop, which returns the same "No MCP tools available" error. It reads availability without touching the tool list, so the prefix stays the same.
- **The catalog can still change while the process runs.** When an MCP server recovers, `mcp/manager.ts:304` registers its tools again. If the server was down at startup, the catalog jumps from the system tools alone to about 210 tools. That's rare and costs one cache miss, but it must be visible: `tools_hash` is logged on every call (2.6), and `buildToolCatalog` logs a `catalog_changed` warning (old/new hash, tool count) whenever the hash differs from the previous build. The search index is built once at startup from available tools (`index.ts:50`), so search results are always a subset of the catalog and every `tool-reference` points at a declared tool.
- Add `toolRegistry.toVercelTools(names, sanitize)` (or a generic version of `toVercelCoreTools`) so tool descriptions are built in exactly one place: the `[server] description` format.
- Google: return today's set (core + search), and keep today's activation path (`runSearchTool`, `tool-dispatch.ts:146-167`) for Gemini only. It activates the tools `runToolSearch` returns (1b), `top_k` of them (currently 5); since `dfe0213` that's already exactly the set the model is shown.

### 1b. Search returns references (`orchestration/tools/search-tool.ts`)
- **`tool_search.top_k` stays 5** (`app/config.yaml` and the `config.ts` schema default). Nothing to change: `dfe0213` already set it (was 15) and removed the hardcoded top-8 slices in `search-tool.ts` and `tool-dispatch.ts`, so the search returns exactly what is shown, for both providers.
- Export `runToolSearch(query, sanitize)`. It returns the top `top_k` (currently 5) and builds two outputs:
  - **For the model on Anthropic** (`type: "content"`): **only** `tool-reference` custom parts, one per tool shown, in score order. **No text part:** the API rejects a `tool_result` that mixes `tool_reference` with other content (400 "Tool definitions/code execution functions cannot be mixed with other content", Phase 0 check 2). The reference expands to the full definition, description included, so name and score text adds nothing. **Zero hits:** return a text-only result (e.g. "No matching tools found; try a different query"). That isn't mixed, so it's allowed. Loaded (core) tools get references too (check 4: accepted).
  - **For the model on Gemini:** a text part with name and score. The activated tool declarations carry the descriptions. That drops the up to `top_k` (currently 5) descriptions per search that today's output repeats.
  - **For the UI**: the JSON summary with name, description and score, as today.
- Delete the duplicate `execute` in `createSearchTool`; the loop calls `runToolSearch`.
- Remove the code that adds tools to `activeTools` (`chat-v2.ts:494-505`) for Anthropic.
- `allToolCalls` / SSE `tool_end` get the UI summary (no frontend change).

### 1c. `inspect_artifact` is always declared
- Declare it in the catalog with the session-bound closure and remove the dynamic add (`chat-v2.ts:215`). With no artifacts it already returns a "not found or expired" error.

### 1d. Cache breakpoints (new: `orchestration/context/cache-markers.ts`)
- System: pass `instructions` (`ai` 7's name for `system`, Step 0) as a `SystemModelMessage` with `providerOptions.anthropic.cacheControl: {type: "ephemeral"}`. Check in Step 0 that `instructions` still accepts a `SystemModelMessage`. Tools render before system, so this one breakpoint covers tools + system.
- **Markers go on a copy.** `applyCacheMarkers(messages)` returns a new array just before each `streamText` call; the loop's `messages` array is never modified. Nothing has to be cleared between calls, and Phase 4b can save `messages` as they are (rule R2).
- Last message: put `cacheControl` on the last message of the copy (the AI SDK applies message-level `cacheControl` to that message's last part: user parts `index.js:2355`, tool-result parts `index.js:2485`, assistant parts `index.js:2615` (4.0.78)).
- **Previous call's last message:** also mark the message that was last on the previous call. Anthropic looks back only about 20 blocks from a breakpoint for an earlier cache entry, and a parallel batch of more than about 10 tool calls (tool_use + tool_result blocks) goes past that, even within one turn. With this marker the previous call's cache entry is always an exact hit. Total: 3 breakpoints (system, previous, last) of the 4 allowed. On the first call of a turn there is no previous call in this turn, so only 2 are used (Phase 4b.3 extends this across turns). Moving breakpoints doesn't change the cached content.
- TTL: 5 minutes (calls within a turn are seconds apart). Revisit 1 hour in Phase 4b.3.
- Anthropic-only (`providerOptions.anthropic` is ignored by the Google provider).

### 1e. System prompt content
- `SYSTEM_PROMPT` lists UniProt as "Always-Available Core Tools", but `uniprot` has `enabled: false` (`app/config.yaml:109`). See open question Q1.
- The prompt stays a module constant (no dates/IDs), so it's identical on every request.

### 1f. Split `chat-v2.ts` (860 LOC → < 500, per AGENTS.md)
- `orchestration/large-output.ts`: `handleLargeOutput` (no longer takes `activeTools`).
- `orchestration/tool-dispatch.ts`: running system/MCP tools and building result parts.
- `orchestration/context/`: `tool-catalog.ts`, `cache-markers.ts`, `system-prompt.ts`.
- `chat-v2.ts` keeps the loop, the SSE stream and saving to the DB.

## Phase 2 — Cost accounting + permanent cache logging (ships with Phase 1)

### 2.0 What's wrong today (groundwork, 2026-10-09)

- **One flat rate for all input.** `calculateChatCost` (`usage.ts:108`) charges `inputTokens × input_usd_per_mtok`. The AI SDK's `inputTokens` is `noCache + cacheRead + cacheWrite` (`convertAnthropicUsage`, `index.js:1874-1906` (4.0.78); new in 4.x: when `usage.iterations` is present (compaction), `noCache` is the sum over iterations). Once caching is on, cache reads would be charged at 20× their real price (Sonnet 5.5: $2 vs $0.10) and cache writes at 0.8× (because $2 < $2.50).
- **Priced once, on a sum of all calls.** `chat-v2.ts:413-414` adds up tokens across loop iterations and prices the total once (`chat-v2.ts:708`). That's fine at a flat rate, but wrong once a price depends on the size of one request (long-context tiers, 2.2): six 30K-token calls add up to 180K, yet none of them crosses a 100K threshold.
- **Failed turns are never recorded.** If the loop throws (an error from the provider, `max_tool_iterations` exceeded), the `catch` at `chat-v2.ts:782` skips the `usage_events` insert. Calls that already finished were billed by Anthropic but count against no budget.
- **A client disconnect doesn't stop the turn.** `routes/chat.ts:158` just loops over `processChat`. No `abortSignal` reaches `streamText`, the stream's abort isn't hooked up, and system tools get `undefined as unknown as AbortSignal` (`chat-v2.ts:571`). A closed tab lets the turn run to the end, LLM calls and tool calls included.
- **Wrong figure in the plan.** Sonnet 5.5 cache reads cost **$0.10/MTok** (0.05× input), not $0.20 as Phase 2 said before. Corrected below and in the Baseline.
- **Pricing check by side effect.** `rateLimit.ts:77` calls `calculateChatCost({inputTokens: 0, …})` only to find out whether pricing exists.
- Not costed (out of scope, noted): the title model call (`generateSessionTitle`, `chat-v2.ts:808`) and embeddings for tool search.

### 2.1 Pricing facts (from https://platform.claude.com/docs/en/about-claude/pricing, fetched 2026-10-09)

| Model | Input | 5m write | 1h write | Cache read | Output |
|---|---|---|---|---|---|
| `claude-sonnet-5-5` | 2.00 | 2.50 | 4.00 | **0.10** | 10.00 |
| `claude-haiku-4-5` | 1.00 | 1.25 | 2.00 | 0.10 | 5.00 |
| `claude-haiku-5-5` (prompt ≤ 100,000) | 0.10 | 0.125 | 0.20 | 0.01 | 0.50 |
| `claude-haiku-5-5` (prompt > 100,000) | 0.50 | 0.625 | 1.00 | 0.05 | 2.50 |
| `gemini-3-flash-preview` | 0.50 | n/a | n/a | Q2 | 3.00 |

Long-context rule (quoted from the pricing docs): *"a request whose prompt is over 100,000 tokens pays higher prices. A request's prompt length counts all of its input tokens, including cache reads and cache writes. Each request is priced on its own: a request over the threshold pays the higher prices even when part of its prompt is a cache hit."* So:
- the threshold is **strictly greater than** 100,000, measured as `noCache + cacheRead + cacheWrite` of **one API request**;
- once crossed, **every category of that request** uses the higher rates, output included, not just the tokens above 100K;
- every other current model (Sonnet 5.5, Opus 5.5, Haiku 4.5) has flat pricing across its whole context window.
- Not modeled: the `inference_geo` 1.1× multiplier (we don't send it), batch, fast mode.

### 2.2 Config shape (`app/config.yaml`, `config.ts` `ModelPricingSchema`)

```yaml
pricing:
  anthropic:
    claude-sonnet-5-5:
      input_usd_per_mtok: 2.00
      output_usd_per_mtok: 10.00
      cache_read_usd_per_mtok: 0.10
      cache_write_5m_usd_per_mtok: 2.50
      cache_write_1h_usd_per_mtok: 4.00
    claude-haiku-5-5:
      input_usd_per_mtok: 0.10
      output_usd_per_mtok: 0.50
      cache_read_usd_per_mtok: 0.01
      cache_write_5m_usd_per_mtok: 0.125
      cache_write_1h_usd_per_mtok: 0.20
      long_context:                       # optional; whole request uses these rates
        above_input_tokens: 100000        # strictly greater than
        input_usd_per_mtok: 0.50
        output_usd_per_mtok: 2.50
        cache_read_usd_per_mtok: 0.05
        cache_write_5m_usd_per_mtok: 0.625
        cache_write_1h_usd_per_mtok: 1.00
```

- Zod: the base rate set is one schema (`RateSetSchema`); `long_context` is `RateSetSchema.extend({ above_input_tokens: int().positive() })`, and is optional. One optional override block, not an open-ended `tiers[]` list: only one model needs it, and it's a small change if a second threshold ever appears.
- **Fallbacks when a field is missing** (never undercharge): `cache_read` defaults to `input` (the overcharge path; covers Gemini until Q2 is answered). `cache_write_5m` / `cache_write_1h` default to 1.25× / 2× `input`, the multipliers documented for every Anthropic model. A `long_context` block must set every field: no fallbacks inside it, so a typo can't quietly fall back to the cheaper rates.
- Update the `ModelPricingSchema` default in `config.ts:69` to match (it still lists only Haiku 4.5 and Gemini).

### 2.3 Cost engine (`app/server/usage.ts`)

New types:
```ts
interface CallUsage {          // one streamText call
  noCacheTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  outputTokens: number;        // includes reasoning/thinking tokens
}
interface CallCost extends CallUsage {
  promptTokens: number;        // noCache + cacheRead + cacheWrite5m + cacheWrite1h
  tier: "base" | "long_context";
  costPicoUsd: number;         // exact integer, see rounding
}
```

- `priceCall(provider, model, usage, config)` → `CallCost`. Pick the tier from `promptTokens > long_context.above_input_tokens`, then charge each category at that tier's rate.
- `summarizeTurnCost(calls: CallCost[])` → `ChatCost`: per-category token totals, per-category cost, `longContextCalls`, `costMicrousd`.
- **Rounding:** `tokens × rate_microusd_per_mtok` is an exact integer (in units of 10⁻¹² USD). Add these up over every category and call, then `ceil` once per turn when dividing by 10⁶. Today's code rounds up once per category; rounding per category per call would overcharge by up to about 5 µUSD × 20 calls.
- **Type: `number`, not `bigint`.** The worst case fits easily: about 1e6 tokens × 1e7 µUSD/MTok (the highest rate is $10/MTok) × 5 categories × 20 calls ≈ 1e15, under 2^53 ≈ 9e15. `priceCall` and `summarizeTurnCost` check `Number.isSafeInteger` on every result and throw if it fails, so an overflow can't silently produce a wrong cost.
- `assertPricingConfigured(provider, model)` replaces the zero-token `calculateChatCost` call in `rateLimit.ts:77`.
- Keep `calculateChatCost` as a thin wrapper for one flat call (existing tests and callers), or delete it once `rateLimit.ts` moves to `assertPricingConfigured`. Recommendation: delete it; there are only two callers.

### 2.4 Getting the token split per call (`chat-v2.ts` loop → new `orchestration/usage-meter.ts`)

- `UsageMeter` holds `CallCost[]`. After each `await result.usage` the loop calls `meter.record(usage, providerMetadata)`.
- Anthropic: `usage.inputTokenDetails.{noCacheTokens, cacheReadTokens, cacheWriteTokens}`. The 5m/1h split isn't in the normalized usage. Read it from `providerMetadata.anthropic.usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}` (the zod schema is `looseObject`, so the raw field passes through; `index.js:372`, streaming `message_start` `index.js:422` / `message_delta` `index.js:710` (4.0.78). The streaming path copies the whole raw `usage` object from `message_start` (`index.js:4991`) and merges `message_delta` (`index.js:5076`), and emits it as `providerMetadata.anthropic.usage` on `message_stop` (`index.js:5085`) (4.0.78). Confirmed live in Step 0: `finalStep.providerMetadata.anthropic.usage` carries `cache_creation`). If `cache_creation` is absent, count all of `cacheWriteTokens` as 5m, the TTL we send in Phases 1–3.
- Google: `cacheRead = cachedContentTokenCount`, `noCache = prompt − cached`, no writes (implicit caching). `outputTokens` already includes `thoughtsTokenCount` (`@ai-sdk/google` `convertGoogleUsage`, `index.js:198-219` (4.0.93)). Changed in 4.x: input now also counts `toolUsePromptTokenCount` (`input = prompt + toolUsePrompt`, `noCache = input − cached`). No special handling needed.
- Guard: if `noCache + cacheRead + cacheWrite ≠ inputTokens`, log a `usage_mismatch` warning and charge the difference at the input rate.
- **Record usage on failure as well:** wrap the loop so that `finally`/`catch` writes a `usage_events` row (`status: "error"`) for every call that finished before the error. Skip it if no call finished. The assistant `messages` row is still written only on success.
- **Abort wiring (needed by the failure path and by Phase 4b's `aborted` status):**
  - `routes/chat.ts`: create an `AbortController`, call `abort()` from `stream.onAbort(...)`, and pass the signal to `processChat(sessionId, userId, message, signal)`.
  - `processChat` passes it to `streamText({ abortSignal })`, to `createMcpToolExecutor` (new optional argument, forwarded to `mcpManager.callTool`; if the MCP client can't cancel a call, stop waiting for it and ignore the result), and to system tools in place of the `undefined` cast at `chat-v2.ts:571`. It checks `signal.aborted` before starting each iteration.
  - An abort ends the loop through the same `finally` as an error, with `status: "error"` and `error_code: "aborted"` in the log (Phase 4b records it as `chat_turns.status = aborted`).
- **A call cut off mid-stream:** Anthropic bills its input once the request is accepted, but no final `usage` arrives. Record an estimate rather than nothing: input = the previous call's prompt tokens + `estimateTokens` (`logger.ts`, already used by the loop) of the messages added since; on a turn's first call, `estimateTokens` of the whole request. Price it as uncached input (the worst case); output = streamed characters / 4. Flag the row with `usage_estimated = 1` and log `usage_estimated`. If the call was cut off before the request was sent, record nothing for it.

### 2.5 DB (Drizzle migration via `bun run db:generate`, `db/schema/usage.ts`)

`usage_events` (one row per user turn, as today):
- Token columns: `input_tokens` **stays total input** (all categories), so token limits and existing totals don't change. Add `cache_read_tokens`, `cache_write_5m_tokens`, `cache_write_1h_tokens` (int, not null, default 0). Uncached tokens = input − cache columns, so there's no fourth column.
- Cost breakdown: `input_cost_microusd`, `cache_read_cost_microusd`, `cache_write_cost_microusd`, `output_cost_microusd` (int, default 0). `cost_microusd` stays the total that budgets read. The parts may add up to 1–3 µUSD less than the total because of the single rounding step; this is documented, not an error.
- Rate snapshot: today's `input_cost_per_mtok_microusd` / `output_cost_per_mtok_microusd` record one rate, but a turn can now mix tiers. Keep them as the **base-tier** rates and add `pricing_json` (text): the full pricing entry used, so a row can be re-priced later. Add `long_context_calls` (int, not null, default 0) and `llm_calls` (int, **nullable**: null on legacy rows means "not recorded"; every new row sets it).
- `status` (`"ok" | "error"`, default `"ok"`) for the partial-turn rows from 2.4. Extend the CHECK constraint.
- `usage_estimated` (int 0/1, not null, default 0): set when the row includes the estimate for a call cut off mid-stream (2.4).
- Legacy rows: the new columns default to 0 / null, which is correct because nothing was cached before this change. No backfill.
- `messages.cost_microusd` / `input_tokens` stay totals. `UsageEventSchema` (`schemas/index.ts:130`) and `DbUsageEvent` gain the new fields.
- No per-call table (D3): per-call detail goes to logs (2.6) and later to Arize spans.

### 2.6 Logging (replaces the `cache_diag` block, `chat-v2.ts:428-452`)

- `llm_response_received` (per call): `prompt_tokens`, `no_cache`, `cache_read`, `cache_write_5m`, `cache_write_1h`, `output_tokens`, `pricing_tier`, `call_cost_microusd` (exact value as a decimal number), `tool_count`, `tools_hash`, `system_hash`. Drop `raw_usage`.
- `process_complete` (per turn): the same totals by category, plus `cost_microusd`, `cost_breakdown`, `llm_calls`, `long_context_calls`, `cache_hit_ratio` = cacheRead / prompt tokens.
- `pricing_long_context_tier` warn, once per call that crosses the threshold, so a sudden cost jump is easy to see.
- The SSE `usage` event / frontend stay unchanged: `inputTokens` is the total. Optionally add `cacheReadTokens` and `costMicrousd` later for the bubble footer (D5).

### 2.7 Tests (`app/server/__tests__/usage.test.ts`, new `usage-meter.test.ts`)

- Sonnet 5.5 call that mixes all four input categories: exact cost.
- Haiku 5.5 call at exactly 100,000 prompt tokens is priced at the base tier; at 100,001 every category, output included, is priced at the long-context tier. Cache reads count toward the threshold.
- A turn of 3 × 60K calls on Haiku 5.5 stays at the base tier (proves per-call pricing, not pricing the summed total).
- Single rounding step: 20 tiny calls cost ceil(sum), not sum(ceil).
- Fallbacks: a model with no cache fields prices reads at the input rate and writes at 1.25× / 2×. A `long_context` block missing a field fails config parsing.
- Meter: the 5m/1h split comes from `providerMetadata`; missing `cache_creation` means all writes count as 5m; the mismatch guard.
- Failure path: an error thrown after 2 finished calls writes one `status: "error"` row with those 2 calls' cost.
- Abort: aborting the signal during call 2 stops the loop (no call 3, no further tool calls) and writes one `status: "error"` row with call 1's cost plus an estimate for call 2, `usage_estimated = 1`.
- Migration: `bun run db:drift` is clean; legacy rows read back with zeros.

### 2.8 Decisions (cost)

- **D1 — `claude-haiku-5-5` pricing: decided 2026-10-09.** It isn't in `config.yaml` today. Add its pricing entry (with its `long_context` block, 2.2) while implementing this phase, so the tier code is tested against a real model entry. Only the pricing entry is added; moving the chat or title model onto Haiku 5.5 is a separate decision.
- **D2 — Record cost of failed turns: decided, yes** (2.4). Otherwise budgets undercount.
- **D3 — Ledger granularity: decided 2026-10-09, option B.** One `usage_events` row per turn, with per-category token and cost columns, `pricing_json`, `long_context_calls`, `llm_calls` and `status` (2.5). No per-call table: per-call detail goes to Arize tracing (and to logs until tracing exists). The DB row stays the source of truth for budgets because tracing can be sampled or lost and uses its own price table. When tracing lands, attach our `call_cost_microusd` and `pricing_tier` to each LLM span so Arize shows the same numbers the budget uses.
- **D4 — Cost the title call: deferred.** Out of scope for this plan.
- **D5 — Cache/cost info in the chat UI: later phase** (see "Later: cost visibility in the UI").
- Daily **token** count keeps counting total input tokens (no behaviour change). It is **display-only**: `daily_token_limit` is read for the usage page (`routes/usage.ts:66`) but nothing enforces it; `rateLimit.ts` enforces the query and cost limits. With caching, a turn's "tokens" now overstate what it costs. Money-based limits (`daily_cost_limit_microusd`) are what count, and they become accurate with this phase. Revisit the token display in Phase 4b (4b.9).

## Phase 3 — Validate with real data

- Re-run the baseline's three questions (session `c7525aa4`) and compare per call:
  - `tools_hash` stays the same within and across turns;
  - `cache_read > 0` from the second call of each turn;
  - input cost per turn vs. the $0.133 baseline.
- If `cache_read` stays 0 unexpectedly, reproduce it in the Phase 0 script with beta `cache-diagnosis-2026-04-07` (`diagnostics.previous_message_id`) to find the change that breaks it.
- Unit tests (`bun test`, `app/server/__tests__/`):
  - catalog: sorted, deterministic across builds, deferred flags right, at least one tool loaded;
  - search output: `top_k` results; on Anthropic the model-facing output is `tool-reference` parts only (no text part; zero hits → text only), one per tool shown, core tools included; on Gemini a name + score text part; the UI summary keeps descriptions;
  - "all servers down": with every tool unavailable, the turn returns the "No MCP tools available" error before any LLM call;
  - cache markers: system marked, plus the previous call's last message and the current last message (only the last one on a turn's first call); the input `messages` array is unchanged;
  - cost engine and meter: see Phase 2.7.
- Manual: one Gemini chat still works end to end. **Dropped 2026-10-10:** Gemini is no longer used, so the manual Gemini check (#26) and Q2 are not pursued.

### Phase 3 results (2026-10-10, #25)

**All checks pass; no cache diagnosis was needed.** Setup: backend on port 3001 (`PORT=3001 bun run start` in `app/`), chat API driven with the dev-agent token, the baseline's three questions sent back to back in one new session (`45630b92`). Model `claude-sonnet-5-5`, `top_k` 5, catalog of 202 tools (11 loaded, 191 deferred). Figures are from the `llm_response_received` / `process_complete` log events (2.6).

- **Prefix stable:** `tools_hash` = `530ca986`, `system_hash` = `d668fb3b` and `tool_count` = 202 on **all 13 calls**, within and across turns. Baseline: `tool_count` 10 → 25 → 26 and a new `tools_hash` after each search. No `catalog_changed` warning.
- **`cache_read > 0` from call 2 of every turn.** Calls 2+ read everything the previous call cached (call N's `cache_read` = call N−1's prompt minus 2 tokens). Also, unplanned: **the first call of turns 2 and 3 reads the cache** (4,737 and 5,961 tokens). Today's text-only history replay is deterministic, so tools + system + earlier text turns are an exact prefix of the next turn's first call. Tool results from earlier turns are not replayed, so that hit stops at the earlier text turns (Phase 4b extends it).
- No cache diagnosis was needed: `cache_read` was never 0 where a read was expected.

Per call (`prompt` = noCache + read + write; all writes 5m; all calls base tier):

| Turn | Call | prompt | cache_read | cache_write | output | call cost (µUSD) |
|---|---|---|---|---|---|---|
| 1 | 1 | 4,741 | 0 | 4,737 | 152 | 13,371 |
| 1 | 2 | 7,402 | 4,737 | 2,663 | 93 | 8,065 |
| 1 | 3 | 7,649 | 7,400 | 247 | 196 | 3,322 |
| 1 | 4 | 9,271 | 7,647 | 1,622 | 340 | 8,224 |
| 1 | 5 | 10,919 | 9,269 | 1,648 | 550 | 10,551 |
| 1 | 6 | 16,440 | 10,917 | 5,521 | 673 | 21,628 |
| 1 | 7 | 36,154 | 16,438 | 19,714 | 1,327 | 64,203 |
| 2 | 1 | 5,965 | 4,737 | 1,224 | 289 | 6,432 |
| 2 | 2 | 6,805 | 5,961 | 842 | 170 | 4,405 |
| 2 | 3 | 7,132 | 6,803 | 327 | 558 | 7,082 |
| 3 | 1 | 6,367 | 5,961 | 402 | 198 | 3,589 |
| 3 | 2 | 7,262 | 6,363 | 897 | 429 | 7,173 |
| 3 | 3 | 20,405 | 7,260 | 13,143 | 1,418 | 47,768 |

Input cost per turn (noCache + cache read + cache write, from `cost_breakdown`) against the baseline (all uncached at $2/MTok):

| Turn | Baseline prompt tokens | Baseline input cost | Now prompt tokens | Now input cost | Now, if uncached | Saving vs uncached | Cache hit ratio |
|---|---|---|---|---|---|---|---|
| 1 | 66,361 (6 calls) | **$0.133** | 92,576 (7 calls) | **$0.096** | $0.185 | 48% | 0.61 |
| 2 | 32,213 (4 calls) | $0.064 | 19,902 (3 calls) | $0.008 | $0.040 | 81% | 0.88 |
| 3 | 37,782 (3 calls) | $0.076 | 34,034 (3 calls) | $0.038 | $0.068 | 44% | 0.58 |
| Session | 136,356 | $0.273 | 146,512 | **$0.142** | $0.293 | **52%** | 0.64 |

- Turn 1 cost $0.096 against the $0.133 baseline even though the model did more work this time (7 calls, 92.6K prompt tokens vs 6 calls, 66.4K). Per prompt token, input now averages **$1.04/MTok against $2.00**. At the baseline's 66,361 tokens that's about $0.069, in line with the $0.067 projected in the Baseline section.
- Whole session including output: $0.206 vs $0.346 baseline (−41%; output is not affected by caching).
- **Where the remaining input cost goes:** cache writes are 94% of input cost (turn 1: $0.090 of $0.096). The largest are the **final calls' writes**, which nothing reads: turn 1 call 7 wrote 19,714 tokens and turn 3 call 3 wrote 13,143. They pay the 1.25× write premium (about $0.016 extra this session), because the next turn replays only the final text, not the tool results. We can't tell before a call that it's the last one, so the marker stays; Phase 4b's lossless replay turns those writes into reads on the next turn.

**Token cost of the schemas a search loads** (`experiments/schema-cost.ts`, gitignored: the real 202-tool request body for each search, priced with `/v1/messages/count_tokens` with 0, 1 and 5 `tool_reference` blocks in the search result):

| Search (from the re-run) | 5 references | Per tool |
|---|---|---|
| "approved drugs targeting a gene target with mechanism of action" | **678 tokens** | 129–181 (`open-targets__get_target_known_drugs` 181) |
| "PharmGKB ClinPGx drug pharmacogenomic annotations clinical annotations count" | **691 tokens** | 125–163 |

- About **690 tokens per search** (≈ 135 per tool plus a few tokens per reference block). That's in line with Phase 0 check 1 (≈ 180 tokens per tool when all 191 are loaded). Written once at $2.50/MTok (≈ $0.0017), then read at $0.10/MTok (≈ $0.00007 per later call). Small next to the tool results; no change needed to `top_k`.

## Phase 4 — Three projects: thinking, lossless transcript, artifact persistence

Decisions agreed 2026-10-09 (session brainstorm). Phase 4 ships as three separate projects, each with its own commits:

| Project | What | Depends on |
|---|---|---|
| **4a** | Thinking display + explicit effort, reasoning in the UI | Step 0 only. Can ship any time, even before Phase 1. |
| **4b** | Lossless transcript: caching across turns | Phases 1–2: cross-turn caching is pointless while the tool list changes between calls. |
| **4c** | Artifacts in SQLite with an in-memory read-through cache | Ships with or right after 4b: replayed history references artifact IDs that the 5-minute in-memory store has already dropped. |

### Phase 4a — Thinking: Sonnet 5.5, adaptive, effort `medium`

#### 4a.1 Facts (checked against the Claude API reference, 2026-10-09)

- Sonnet 5.5: `thinking: {type: "adaptive"}` is the default; `{type: "disabled"}` and `budget_tokens` return a 400. Effort goes in `output_config.effort` and **defaults to `high`**, so `medium` must be set explicitly.
- So today's chat already runs adaptive thinking at effort `high`, with thinking text omitted, and `buildMessages` drops thinking blocks between turns. 4a changes only the config and the UI, which is why it doesn't depend on 4b. It is also a cost lever: `high` → `medium` lowers output (thinking) tokens.
- `thinking.display` defaults to `"omitted"`: thinking blocks arrive with **empty text**. To show thinking in the UI, send `display: "summarized"`.
- Text the model writes between tool calls can arrive as progress-update thinking blocks. With `summarized` they are readable, so the UI thinking block covers both.
- **Preserved thinking:** thinking blocks are tied to the model and the conversation. An edited history returns a 400 for accounts created on or after 2026-08-31. Rules R1/R2 and degraded replay (4b.1, 4b.4) are what keep us compliant once history is lossless; 4b.6 #6 checks that degraded replay itself isn't treated as an edit.
- Changing the effort/thinking config between turns invalidates the message cache. That's why it's part of `context_version` (4b.4).
- Thinking tokens are billed as output; the Phase 2 meter already counts them.

#### 4a.2 Changes

- **Dependency:** the previously installed `@ai-sdk/anthropic` 3.0.64 accepted only `thinking: {type}` and dropped `display`. Step 0 (upgrade to 4.x, done) provides it.
- **Effort is set explicitly:** `providerOptions.anthropic`: `{ thinking: { type: "adaptive", display: "summarized" }, effort: "medium" }`. Always send `effort`, even though it's a valid level: Sonnet 5.5 defaults to `high`, and an explicit value keeps `context_version` stable if the API default changes. Don't also use `ai` 7's top-level `reasoning` option: provider options take precedence and the two would silently disagree. Config: `llm.thinking_display: summarized`, `llm.effort: medium` (required, Zod enum `low|medium|high|xhigh|max`), `llm.max_output_tokens: 16000` (was 4096; thinking counts toward output).
- **Cost overshoot note:** the cost budget is checked once, before the turn (`rateLimit.ts`, best-effort). Raising `max_output_tokens` to 16000 raises the worst case per call 4× (Sonnet 5.5: 16K × $10/MTok = $0.16 of output, against a $0.25 default daily budget). This was already loose, since a turn can make up to 20 calls; only a cost check during the turn would really bound it. Update the best-effort comment in `rateLimit.ts` to say so. No design change in this plan.
- Sampling parameters: don't send `temperature` / `top_p` / `top_k` (non-default values return a 400 on Sonnet 5.5). We don't send them today; add a test so nobody does.
- Gemini: no change (`providerOptions.anthropic` is ignored).

#### 4a.3 UI: reuse the existing `ReasoningBlock`

- Stream reasoning deltas from `result.stream` (`reasoning-delta` parts) as a new SSE event (`reasoning`), appended to `reasoningSegments` in `chatStore.ts`. `ReasoningBlock` renders them unchanged.
- The current "pre-tool text becomes reasoning" path (`text_block_end { isReasoning: true }`) keeps working for any visible text before tool calls.
- Persistence: the summarized thinking text is appended to `messages.reasoning`, so reloaded chats show it in the same block. Once 4b lands, the transcript keeps the full parts with signatures.

#### 4a.4 Gate and open items

- Gate (Phase 0 script): `display: "summarized"` with `@ai-sdk/anthropic` 4.x returns non-empty reasoning deltas.
- The `messages.reasoning` column will now mix two things (summarized thinking + pre-tool text). Fine for display; revisit if tracing needs them separate.

### Phase 4b — Lossless transcript: caching across turns

#### 4b.0 Why the cache breaks across turns today

`buildMessages` (`chat-v2.ts:242`) rebuilds history as plain user/assistant text, so the replayed prefix differs from what was sent:

1. **Tool calls and results are dropped.** Only `content` (final text) is replayed. The `tool_calls` column is a UI copy: cut at 2000 chars (`:583`, `:644`), and it holds `rawOutput`, while the model saw the output after `handleLargeOutput`.
2. **Text the model wrote before its tool calls is dropped.** It goes to the `reasoning` column and isn't replayed.
3. **The final assistant message is never captured.** `responseMessages` is pushed only on tool-call iterations (`:692-698`). The last iteration's message, with its provider metadata (thinking signatures), is lost.

(Cache markers no longer leak into saved messages: Phase 1d applies them to a copy.)

Result: the cache matches only up to the first changed block (usually the first earlier assistant message), and the model loses earlier tool evidence.

#### 4b.1 Model: an append-only transcript is the only source of model context

The `messages` table stays as it is, as the UI's view of the chat (no frontend change for history). A new table feeds the model.

**`model_transcript`** (Drizzle migration):

| Column | Notes |
|---|---|
| `session_id` | FK → `chat_sessions`, cascade delete |
| `seq` | int; `UNIQUE (session_id, seq)` |
| `turn_id` | FK → `chat_turns` (4b.2) |
| `role` | `user \| assistant \| tool \| system`. `system` is used only by Phase 5's server-written tool-change messages; the loader rejects any other system message. |
| `content_json` | the `ModelMessage` exactly as passed to `streamText` |
| `provider`, `model`, `context_version` | compatibility tag (4b.4) |
| `tool_names_json` | sorted names of the tools this message references (`tool-call` parts and `tool-reference` parts); `[]` if none. Used by 4b.4. |
| `created_at` | |

Rules:
- **R1: append-only.** Rows are written once and never updated. Replay is `SELECT … WHERE turn.status = 'ok' ORDER BY seq` followed by `JSON.parse`, with no transformation.
- **R2: cache markers are never saved.** `cache-markers.ts` (Phase 1d) applies `providerOptions.anthropic.cacheControl` to a **copy** at request time, so the loop's `messages` can be saved as they are.
- **R3: save what the model saw, not the UI version.** Tool output after `handleLargeOutput`, the full tool-call input, `tool-reference` parts, reasoning parts with signatures and redacted-thinking data.
- **What each turn appends:** the user message, **every** assistant response message (including the final one, which is the fix for 4b.0 #3), and every tool-result message.
- **Legacy sessions:** turns that have no transcript rows replay through today's `buildMessages` text path; turns that do replay from the transcript. Both are deterministic, so the prefix stays stable from the switchover on.
- **Tool results carry `fetched_at`.** Every tool-result text gets an ISO timestamp when it is first written. It's written once, so caching isn't affected. The model can then judge how old inline data is; the system prompt tells it to re-fetch when freshness matters.
- New module `orchestration/context/transcript.ts`: `loadTranscript(sessionId)`, `appendMessages(turnId, msgs)`, degrade logic (4b.4). `chat-v2.ts` only calls these.

#### 4b.2 Turn records and failed turns (kept for investigation)

**`chat_turns`**: one row per user turn.

| Column | Notes |
|---|---|
| `turn_id` | PK |
| `session_id`, `user_message_id` | links to the UI `messages` row |
| `assistant_message_id` | null when the turn didn't succeed |
| `status` | `running \| ok \| error \| aborted` |
| `error_code`, `error_message` | e.g. `provider_error`, `max_tool_iterations`, `context_budget`, `refusal` |
| `iterations` | |
| `started_at`, `finished_at` | |

- The row is created as `running` when the turn starts and finalized in `finally`. A client disconnect becomes `aborted`; this relies on the abort wiring from Phase 2.4.
- **Failed turns are kept but never replayed.** Transcript rows are written as each iteration finishes (user message, assistant messages, tool results), all tagged with the turn. Replay skips any turn not marked `ok`, so investigators see the full record and the model never sees a failed question (the user usually retries anyway).
- **Unfinished calls:** an `aborted` turn can end on an assistant `tool_use` without a result. That's fine, because the turn is never replayed.
- **Cost link:** Phase 2's `usage_events` row gets a `turn_id` column, so one join gives the question, the steps that ran, the error and the cost.
- **UI:** the database record is enough for now. No failed-message marker in the UI; the user message still shows as today.

#### 4b.3 Cache breakpoints across turns

- Turn T's last call writes the cache through its last tool result. Turn T+1's first call is that prefix plus 2 blocks (the final answer and the new user message), so it hits as long as the TTL hasn't expired.
- Phase 1d's "previous call" breakpoint carries across turns: on a turn's first call, it marks the last message of the previous turn's last call (the last replayed tool result). The total stays at 3 of the 4 allowed.
- **TTL: 5 minutes** (agreed). Log the gap between turns (`turn_gap_seconds`) and `cache_read` on each turn's first call (`first_call_cache_read`). Revisit 1h with that data.

#### 4b.4 Compatibility tag and degraded replay

Stored messages depend on the provider: sanitized tool names, Gemini thought signatures, `tool-reference` names that a later deploy might remove (likely a 400), and thinking blocks tied to model + config.

- Each row stores `provider`, `model`, `context_version` (hash of `SYSTEM_PROMPT` + thinking config + effort) and `tool_names_json` (4b.1).
- **Tool compatibility is checked per name, not per catalog.** A turn degrades only when a name in any of its rows' `tool_names_json` is missing from the current catalog. Adding tools in a deploy, or changing a tool's description, degrades nothing: a `tool-reference` expands to the current definition, which costs at most one cache miss. A whole-catalog hash would degrade every session on every deploy that adds a tool. The catalog hash is still logged per call (`tools_hash`, 2.6).
- At load time, a turn whose `provider`, `model` or `context_version` doesn't match the current values, or that references a removed tool, is replayed as **degraded text** (today's `buildMessages` shape for that turn), and `transcript_degraded` is logged with the reason (`provider`, `model`, `context_version` or `missing_tools: [...]`). We take one cache miss instead of an error.
- Changing the system prompt, thinking mode or effort, or removing a tool that old turns used, therefore costs each affected session one cache miss on its next turn, by design.

#### 4b.5 Context budget (hard limit for now)

- Before each call, estimate the transcript plus the new message (tokens measured on the previous call + an estimate for what was added). If it's over `llm.max_context_tokens`, refuse the turn with a clear "this chat is too long, start a new chat" error and record `chat_turns.error_code = context_budget`.
- Lossless history grows much faster than today's text history: tool outputs up to 15K chars, up to 20 iterations per turn. Compaction and handoff come later (Phase 6).

#### 4b.6 Gate checks (run in the Phase 0 script before building)

1. Round-trip: a turn with thinking + tool calls → `JSON.stringify` → DB → `JSON.parse` → replayed as turn 2. Check: 200, no preserved-thinking error, and `cache_read ≥` turn 1's last prompt size.
2. Redacted-thinking blocks survive the same round-trip (if one can be triggered; otherwise check the provider's conversion code path).
3. Consecutive user-role content (tool_result followed by a new user message) is accepted live. The merge itself is confirmed in the source: `tool` and `user` messages are grouped into one user block (`@ai-sdk/anthropic` 4.x `convert-to-anthropic-prompt.ts`).
4. A byte-hash comparison of the serialized request body for turn N's prefix, between turn N and turn N+1 (via a logging `fetch` in the script only).
5. Abort mid-stream (Phase 2.4 wiring): the request is cancelled and no further iterations run.
6. **Degraded replay after thinking.** Turn 1 runs with thinking + tool calls; turn 2 replays turn 1 as degraded text (4b.4, no thinking blocks) and adds a new user message. Check: 200, no preserved-thinking error. Degraded replay is the safety net for every compatibility mismatch, so if this returns a 400, 4b.4 must be redesigned before building (e.g. a degraded turn starts a fresh context: replay only the non-degraded suffix and summarize the rest).

#### 4b.7 Concurrency

Two tabs sending to the same session would interleave `seq`. `UNIQUE (session_id, seq)` turns that into an error instead of a corrupted transcript. Add a per-session in-process lock in `processChat`; a second concurrent request gets a "a reply is already in progress" error. One process today, so an in-process lock is enough.

#### 4b.8 Tests

- Transcript: append-only (no UPDATE paths), replay equals what was sent, markers never saved, final assistant message saved, `tool_names_json` matches the message's tool-call and tool-reference parts.
- Failed turn: rows saved with `status = error`, excluded from replay, linked to `usage_events.turn_id`.
- Aborted turn: a disconnect marks the turn `aborted`; its rows are excluded from replay.
- Degraded replay: a mismatched `context_version` / provider / model, or a referenced tool missing from the catalog, produces the text shape and logs `transcript_degraded` with the reason. Adding a tool to the catalog degrades nothing.
- Legacy session: mixed legacy-text + transcript turns replay deterministically.
- Context budget: over the limit → refused turn with `context_budget`.
- Validation (Phase 3 style): a 3-turn live session where each turn's first call shows `cache_read` covering the previous turn's prefix.

#### 4b.9 Open items

- **Refusals (Sonnet 5.5 safety classifiers include `bio`).** This is a biomedical app, so `stop_reason: "refusal"` is a real risk. Today it would be saved as an empty answer. Minimum: record it as `chat_turns.error_code = refusal` with the `stop_details` category, and show a message. Server-side `fallbacks` (beta) would re-run on another model, but its thinking blocks can't be replayed on Sonnet 5.5 (they're tied to the model), so it needs its own decision.
- **Daily token count on the usage page.** Lossless history replays every earlier tool result, so input tokens per turn grow with session length; most of them are cache reads. The display-only count (2.8) will climb fast and alarm users even when cost is low. Options: count `input_tokens − cache_read_tokens`, or show cost instead of tokens. Decide once 4b's size data is in.

### Phase 4c — Artifacts: SQLite with an in-memory read-through cache

The model's interface doesn't change: `inspect_artifact(id, jq)`. Storage moves behind it. Needed because 4b replays artifact previews (with their IDs) long after the 5-minute in-memory store has dropped the data.

- **`artifacts` table:** `id`, `session_id` (FK, cascade), `tool_name`, `tool_input_json`, `data` (gzipped JSON, `Bun.gzipSync`), `raw_size_chars`, `stored_size_chars`, `created_at`, `expires_at`.
- **`store()`** writes the row and warms the in-memory cache.
- **`query()`** checks memory (5m sliding TTL, as today). On a miss it loads from SQLite, re-warms memory and runs jq. If the row is past `expires_at`, it returns an error that tells the model how to refresh: *"Artifact art_x expired (fetched 26h ago). Re-run `chembl__search_activities` with {…} for current data."*
- **Database expiry is measured from `created_at`, not last access.** The goal is to avoid outdated data, and reading an artifact doesn't make it fresher.
- A periodic sweep deletes expired rows. Session and user deletion cascade.
- **Replaces the 10-per-session LRU cap.** Evicting by count would break references from replayed history that are still valid. Use a per-session byte budget instead and evict the oldest by `created_at`.
- Config (`artifact:`): `ttl_minutes: 5` (memory, unchanged), `db_ttl_hours: 24`, `max_session_bytes: 20971520` (20MB). `max_per_session` is removed.
- Tests: memory hit; miss → DB load → re-warm; expired → refresh error with tool name and input; byte-budget eviction; cascade on session delete.

## Phase 5 — Tool masking via `tool_removal` (later, noted)

For when removal is needed (e.g. a server goes down mid-session, or tools near `max_tool_iterations`):

- Beta `mid-conversation-tool-changes-2026-07-01` (or the newer `inline-tools-2026-09-15`). Removed tools stay in `tools[]`; a `role: "system"` message with `{type: "tool_removal", tool: {type: "tool_reference", name}}` withdraws them, and `tool_addition` brings them back.
- **Native in `@ai-sdk/anthropic` 4.x (no fetch wrapper):** append a `ModelMessage` `{ role: "system", content: "", providerOptions: { anthropic: { toolChanges: [{ type: "tool_removal", toolName }] } } }` and pass `allowSystemInMessages: true` to `streamText`. The provider turns it into `{type: "tool_removal", tool: {type: "tool_reference", name}}` and adds the `mid-conversation-tool-changes-2026-07-01` beta automatically. Empty text is allowed when the message only carries tool changes.
- **It's a normal transcript message.** It is appended to `model_transcript` (Phase 4b.1, `role = system`) like any other message and replayed as is, so later requests carry it unchanged and both the cache and preserved thinking stay valid. Never delete or rewrite it; to undo a removal, append a `tool_addition`.
- Placement rules: after a user message (e.g. the `tool_result` turn); a message carrying tool changes must come right before an assistant message or be last.
- `allowSystemInMessages` is safe here because only server code writes `role: "system"` messages. User text always goes in as `role: "user"`, and the transcript loader should reject any system message it didn't write.
- The same mechanism provides per-message `effort` and `clearAt: "next_user_message"` (turn-scoped reminders), if needed later.
- These messages go through the AI SDK, so tracing sees them (unlike the old fetch-wrapper design).
- Docs: https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages#mid-conversation-tool-changes

## Later: cost visibility in the UI (D5, noted)

- Extend the SSE `usage` event with `cacheReadTokens` and `costMicrousd`, and show cost (and optionally cache hit %) in the `MessageBubble` footer (`components/chat/MessageBubble.tsx:180`) next to the token count.
- The data is already in `usage_events` / `messages.cost_microusd` after Phase 2, so this is frontend + SSE work only.

## Phase 6 — Compaction and handoff to a new session (later, noted)

Replaces Phase 4b.5's hard refusal once sessions regularly reach the budget.

- **Compaction in place:** summarize older turns into one block and keep the recent turns lossless. Options: Anthropic server-side compaction (beta `compact-2026-01-12`; the returned compaction block must be appended to the transcript as is) or our own summarizer call. Either one breaks the cache once per compaction, and it must be done in an append-only form so preserved thinking stays valid.
- **Context editing** (beta `context-management-2025-06-27`, `clear_tool_uses`): clears old tool results server-side. It's cheaper than compaction, but each clearing point also invalidates the cache.
- **Handoff to a new session:** when the budget is reached, offer "continue in a new chat". It creates a session seeded with a summary of the old one (findings, IDs, open questions) plus a link back. Costs one cache miss; the old session stays read-only.
- Decide between these using the size data that Phase 4b logs (prompt tokens per turn, turns per session).

## Tracing notes (for the Langfuse work, `docs/TODO.md`)

- AI SDK messages keep the categories separate: human (`user` text), model (`assistant` text/reasoning/tool-call), tool output (`tool` role), discovery (`system__search_available_tools` call plus `tool-reference` parts). Converting to Anthropic's `user` role happens only in the HTTP request.
- Tools are run manually (`execute` stripped, `chat-v2.ts:385`), so the AI SDK emits no tool spans. Wrap each tool run in our own span (name, input, output, duration, error) and label it discovery or tool.

## Risks

- ~~`tool_reference` round-trip untested live~~ → tested live on 2026-10-09. The originally specified mixed text + `tool_reference` result (#17) returns 400; the revised references-only result passes, as do checks 1, 3, 4 and 5, so the gate passes on the revised design and `tool_addition` isn't needed. Remaining risk: the "no mixed content" rule could be extended to other shapes (e.g. a references-only result next to a text result in a parallel batch, which passes today, check 4b). A unit test pins the references-only shape (Phase 3), and the gate script re-checks it live (exit 1 on any failure).
- Degraded replay may count as an edited history under the preserved-thinking rule → Phase 4b.6 #6 is the gate for 4b.4.
- ~~Up to `top_k` (currently 5) full tool schemas load per search; measure their token cost in Phase 3.~~ → measured 2026-10-10: about 690 tokens per search (125–181 per tool), cached after the first write (Phase 3 results).
- Two code paths (Anthropic vs Gemini) inside the catalog; keep the split in `tool-catalog.ts` only.
- The uncommitted `cache_diag` block belongs to the validation session; Phase 2 replaces it.

## Open questions (non-blocking)

- **Q1:** Remove the UniProt lines from `SYSTEM_PROMPT`, or re-enable the `uniprot` platform?
- ~~**Q2:**~~ (dropped 2026-10-10: Gemini is no longer used; the input-price fallback stays.) Gemini cached-input pricing to put in `config.yaml` (or keep the input-price fallback). Check also whether `gemini-3-flash-preview` has a long-context tier; if so, the `long_context` block in Phase 2.2 covers it.

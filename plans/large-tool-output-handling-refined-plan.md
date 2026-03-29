# Large Tool Output Handling: Refined Plan

## Context

The current `maybeCompressOutput` in `chat-v2.ts` sends entire raw tool outputs to an LLM summarizer when they exceed 15K chars. This is catastrophic for large outputs — UniProt `search_proteins("BRCA1", size=5)` returned 882K chars (~125K tokens) to the summarizer, blowing the 50K token/min rate limit by 2.5x. ChEMBL search tools have no extraction layer at all and return raw API responses up to 1000 results.

The fix: replace the LLM summarizer with a deterministic jq-based two-tier pipeline — automatic noise reduction + query-aware artifact inspection — that reduces token cost from ~129K to ~3K per large output.

This plan incorporates 4 critical refinements from brainstorming:
1. Keep UniProt extractors in codebase but decouple from flow (revisit later)
2. ArtifactStore as process-level singleton with `lastAccessedAt` TTL
3. Single threshold (no dual 15K/50K gap)
4. Scalable 3-layer policy system (global → platform → tool)

---

## Architecture Overview

```
Tool returns raw output
    │
    ▼
Size > inline_max_chars (15K)?  ──No──▶  Pass through as-is
    │ Yes
    ▼
Tier 1: Noise Reduction (deterministic, no LLM)
  Apply 3-layer policy: global → platform → tool noise_filters
    │
    ▼
Still > inline_max_chars?  ──No──▶  Return reduced output
    │ Yes
    ▼
Tier 2: Store as Artifact
  ArtifactStore.store() → generate schema preview (~400 tokens)
  Dynamically add inspect_artifact tool to activeTools
  Return preview as tool result
    │
    ▼
LLM sees preview, calls inspect_artifact with jq filter
  → deterministic jq execution → filtered result (~1-3K tokens)
```

**Single threshold**: `inline_max_chars` (default 15K chars). No gap between "noise reduction trigger" and "artifact trigger" — same threshold governs both checks.

---

## Task Sequence

### Task 1: jq Execution Engine
**New file**: `app/server/orchestration/tools/jq-engine.ts`

Install `node-jq` npm package (`bun add node-jq` in `app/`). Bundles its own jq binary, guarantees availability regardless of system. Full jq syntax, battle-tested.

```typescript
// Thin wrapper
export async function executeJq(data: unknown, filter: string, opts?: {
  timeoutMs?: number;      // default 5000
  maxOutputChars?: number; // default 50000
}): Promise<{ result: unknown; truncated: boolean; error?: string }>;
```

Implementation:
- Use `node-jq`'s `run()` API with `input: 'json'`, `output: 'json'` options
- Pass data object directly (node-jq handles serialization)
- Enforce timeout: wrap in `Promise.race` with a timeout reject
- Enforce output cap: if stringified result > 50K chars, set `truncated: true` and trim
- On jq syntax error: return `{ result: null, truncated: false, error: "jq error: ..." }`

**Dep**: `bun add node-jq` in `app/`

**Why not WASM**: jq-web/jq-wasm WASM ports have spotty Bun compatibility. node-jq wraps the real binary with a clean API.

---

### Task 2: 3-Layer Policy Config
**Modified files**: `app/config.yaml`, `app/server/config.ts`

Add `artifact` section to config.yaml:

```yaml
artifact:
  inline_max_chars: 15000    # single threshold for both tiers
  hard_cap_bytes: 1048576    # 1MB — reject output entirely above this
  ttl_minutes: 5
  max_per_session: 10
  preview_sample_items: 2
  preview_max_chars_per_value: 150
  jq_timeout_ms: 5000
  jq_max_output_chars: 50000

  policies:
    global:
      noise_filters:
        - "del(.. | nulls)"

    platforms:
      uniprot:
        noise_filters:
          - "if .results then .results |= map(del(.sequence.value)) else del(.sequence.value) end"
          - "del(.. | .evidences?)"
          - "if .results then .results |= .[:10] else . end"
      chembl:
        noise_filters:
          - "if .molecules then .molecules |= .[:25] else . end"
          - "if .activities then .activities |= .[:25] else . end"
      open-targets:
        noise_filters: []
      pubmed:
        noise_filters: []

    tools: {}
      # Future: per-tool semantic profiles
      # uniprot__search_by_gene:
      #   semantic_profile: "profile_uniprot_gene_bridge_v1"

    profiles: {}
      # Future: named, versioned jq transform sequences
      # profile_uniprot_gene_bridge_v1:
      #   - "..."
```

Add Zod schema in config.ts:

```typescript
const ArtifactPolicySchema = z.object({
  noise_filters: z.array(z.string()).default([]),
  semantic_profile: z.string().optional(),
});

const ArtifactConfigSchema = z.object({
  inline_max_chars: z.number().int().default(15000),
  hard_cap_bytes: z.number().int().default(1_048_576),
  ttl_minutes: z.number().default(5),
  max_per_session: z.number().int().default(10),
  preview_sample_items: z.number().int().default(2),
  preview_max_chars_per_value: z.number().int().default(150),
  jq_timeout_ms: z.number().int().default(5000),
  jq_max_output_chars: z.number().int().default(50000),
  policies: z.object({
    global: ArtifactPolicySchema.default({ noise_filters: ['del(.. | nulls)'] }),
    platforms: z.record(z.string(), ArtifactPolicySchema).default({}),
    tools: z.record(z.string(), ArtifactPolicySchema).default({}),
    profiles: z.record(z.string(), z.array(z.string())).default({}),
  }).default({}),
});
```

Add `artifact` field to `AppConfigSchema`.

---

### Task 3: Policy Resolver & Validator
**New file**: `app/server/orchestration/tools/policy-resolver.ts`

```typescript
// Resolves the effective filter chain for a given tool call
export function resolveFilterChain(toolName: string): string[];
// Validates all policies on startup (jq syntax, profile refs, tool names)
export function validatePolicies(): { valid: boolean; errors: string[] };
```

**resolveFilterChain** logic:
1. Start with `policies.global.noise_filters`
2. Extract platform from toolName (e.g. `uniprot` from `uniprot__search_by_gene`)
3. Append `policies.platforms[platform].noise_filters` if present
4. Append `policies.tools[toolName].noise_filters` if present
5. If tool has `semantic_profile`, resolve from `policies.profiles[name]` and append
6. Return flat array of jq filter strings (all layers compose, not override)

**validatePolicies** logic (called at startup):
- For each filter string across all layers: dry-run `jq --null-input 'filter'` to check syntax
- Check that any `semantic_profile` references exist in `policies.profiles`
- Log warnings for tool names in `policies.tools` not found in tool registry (non-fatal since registry loads later)
- Return errors array; if non-empty, log and warn (don't crash — config may be WIP)

---

### Task 4: Noise Reduction Runner
**New file**: `app/server/orchestration/tools/noise-reduction.ts`

```typescript
export async function applyNoiseReduction(
  toolName: string,
  data: unknown,
): Promise<{ data: unknown; filtersApplied: number; error?: string }>;
```

Implementation:
1. Call `resolveFilterChain(toolName)` to get ordered filter list
2. Apply each filter sequentially via `executeJq(data, filter)`
3. If any filter errors: log warning, skip that filter, continue with data as-is
4. Return reduced data + count of successfully applied filters

---

### Task 5: ArtifactStore (process-level singleton)
**New file**: `app/server/orchestration/tools/artifact-store.ts`

```typescript
interface Artifact {
  id: string;              // "art_" + nanoid(8)
  sessionId: string;
  toolName: string;
  data: unknown;           // parsed JSON (noise-reduced)
  rawSizeChars: number;    // original size before noise reduction
  storedSizeChars: number; // size after noise reduction
  createdAt: number;       // Date.now()
  lastAccessedAt: number;  // updated on every get/query
}

class ArtifactStore {
  private artifacts = new Map<string, Artifact>();

  store(sessionId: string, toolName: string, data: unknown, rawSize: number): string;
  get(id: string, sessionId: string): Artifact | null;  // session-scoped
  query(id: string, sessionId: string, jqFilter: string): Promise<{ result: unknown; error?: string }>;
  cleanup(): void;  // evict expired artifacts
  getSessionCount(sessionId: string): number;
}

export const artifactStore = new ArtifactStore();  // singleton
```

Key behaviors:
- **Session-scoped access**: `get()` and `query()` require matching sessionId — prevents cross-session leaks
- **TTL on lastAccessedAt**: `cleanup()` evicts where `now - lastAccessedAt > ttl`. Every `get()`/`query()` refreshes `lastAccessedAt`
- **Per-session cap**: `store()` checks `getSessionCount(sessionId) >= max_per_session` → evict oldest by `lastAccessedAt` in that session
- **Periodic cleanup**: `setInterval(cleanup, 60_000)` on module load
- **query()** delegates to `executeJq(artifact.data, jqFilter)` from jq-engine

---

### Task 6: Schema Preview Generator
**New file**: `app/server/orchestration/tools/schema-preview.ts`

```typescript
export function generatePreview(
  artifactId: string,
  toolName: string,
  data: unknown,
  rawSizeKb: number,
  storedSizeKb: number,
  opts?: { maxSampleItems?: number; maxCharsPerValue?: number }
): object;
```

Introspection rules:
- **Objects**: list all keys, recurse into values (up to depth 3)
- **Arrays**: report `_type: "array"`, `_length: N`, `_item_keys: [...]` (unique keys across items), include first N sample items (default 2)
- **Strings > maxCharsPerValue**: truncate to `"value...(342 chars)"`
- **Beyond depth 3**: summarize as `"_array(N)"` or `"_object(K keys)"`
- **Top-level `_meta`**: includes `artifact_id`, `raw_size_kb`, `stored_size_kb`, `tool`, hint about using `inspect_artifact`

Target: ~300-500 tokens output.

---

### Task 7: inspect_artifact Tool
**New file**: `app/server/orchestration/tools/artifact-inspector.ts`

```typescript
import { tool } from "ai";
import { z } from "zod";

export function createInspectArtifactTool(sessionId: string) {
  return tool({
    description:
      "Query a stored data artifact using a jq filter expression. " +
      "Use this to extract specific fields, filter arrays, or reshape data " +
      "from large tool outputs. The artifact_id and available structure are " +
      "shown in the tool result preview. You can call this multiple times " +
      "with different filters.",
    parameters: z.object({
      artifact_id: z.string().describe("The artifact ID from the preview"),
      jq_filter: z.string().describe(
        "A jq filter expression. Examples: " +
        "'.results[] | .name' — extract names; " +
        "'.results[:5]' — first 5 items; " +
        "'[.results[] | {id: .id, score: .score}]' — reshape; " +
        "'[.results[] | select(.type == \"gene\")]' — filter by field"
      ),
    }),
    execute: async ({ artifact_id, jq_filter }) => {
      const result = await artifactStore.query(artifact_id, sessionId, jq_filter);
      if (result.error) return JSON.stringify({ error: result.error });
      return JSON.stringify(result.result);
    },
  });
}
```

Note: `sessionId` is bound at creation time (closure) — the tool can only access artifacts for its session. Dynamically added to `activeTools` in `handleLargeOutput`.

---

### Task 8: Integration — Replace maybeCompressOutput
**Modified file**: `app/server/orchestration/chat-v2.ts`

**Remove**: `maybeCompressOutput` function (lines 116-178), `getSummarizerModel` import, `generateText` import (if only used by summarizer — check).

**Remove from config entirely**: `llm.summarizer_model` and `llm.tool_output_summary_threshold` (replaced by `artifact.inline_max_chars`). Remove from:
- `app/config.yaml` — delete `summarizer_model` and `tool_output_summary_threshold` keys
- `app/server/config.ts` — remove from Zod schema + remove `LLM_SUMMARIZER_MODEL`/`TOOL_SUMMARIZER_MODEL`/`TOOL_OUTPUT_SUMMARY_THRESHOLD` env overrides
- `app/server/llm/` — remove `getSummarizerModel()` export if it exists

**Add**: New function `handleLargeOutput` and its integration into the tool execution block.

```typescript
import { artifactStore } from "./tools/artifact-store";
import { applyNoiseReduction } from "./tools/noise-reduction";
import { generatePreview } from "./tools/schema-preview";
import { createInspectArtifactTool } from "./tools/artifact-inspector";

const INSPECT_TOOL_KEY = "inspect_artifact";

async function handleLargeOutput(
  toolName: string,
  rawOutput: string,
  sessionId: string,
  activeTools: Record<string, Tool>,
  sanitize: (name: string) => string,
  ctx: LogContext,
): Promise<string> {
  const cfg = appConfig.artifact;

  // Small output: pass through
  if (rawOutput.length <= cfg.inline_max_chars) return rawOutput;

  // Try to parse as JSON
  let data: unknown;
  try {
    data = JSON.parse(rawOutput);
  } catch {
    // Not JSON — truncate with note
    return `[Output truncated from ${(rawOutput.length / 1024).toFixed(0)}KB]\n` +
      rawOutput.slice(0, cfg.inline_max_chars);
  }

  // Tier 1: Noise reduction
  const { data: reduced, filtersApplied } = await applyNoiseReduction(toolName, data);
  const reducedStr = JSON.stringify(reduced);

  logger.info("TOOL", "noise_reduction_applied", {
    ctx,
    data: {
      tool: toolName,
      raw_chars: rawOutput.length,
      reduced_chars: reducedStr.length,
      filters_applied: filtersApplied,
    },
  });

  // Under threshold after noise reduction: return directly
  if (reducedStr.length <= cfg.inline_max_chars) return reducedStr;

  // Tier 2: Store as artifact
  const artifactId = artifactStore.store(sessionId, toolName, reduced, rawOutput.length);
  const preview = generatePreview(
    artifactId, toolName, reduced,
    rawOutput.length / 1024,
    reducedStr.length / 1024,
  );

  // Dynamically add inspect_artifact tool (session-bound)
  if (!activeTools[INSPECT_TOOL_KEY]) {
    activeTools[INSPECT_TOOL_KEY] = createInspectArtifactTool(sessionId);
  }

  logger.info("TOOL", "artifact_stored", {
    ctx,
    data: {
      artifact_id: artifactId,
      tool: toolName,
      raw_kb: (rawOutput.length / 1024).toFixed(1),
      stored_kb: (reducedStr.length / 1024).toFixed(1),
    },
  });

  return JSON.stringify(preview);
}
```

**Integration point** (line ~459-461 in current code):
```typescript
// BEFORE:
let output = await createMcpToolExecutor(originalName)(tcInput);
const rawOutput = output;
output = await maybeCompressOutput(originalName, output, userMessage, ctx);

// AFTER:
let output = await createMcpToolExecutor(originalName)(tcInput);
const rawOutput = output;
output = await handleLargeOutput(originalName, output, sessionId, activeTools, sanitize, ctx);
```

---

### Task 9: Hard Output Cap in MCP Manager
**Modified file**: `app/server/mcp/manager.ts`

In `callTool()` (after line ~399 where rawText is assembled), add:

```typescript
const hardCapBytes = appConfig.artifact?.hard_cap_bytes ?? 1_048_576;
if (rawText.length > hardCapBytes) {
  logger.warn("MCP", "tool_output_hard_cap", {
    data: { tool: prefixedToolName, size: rawText.length, cap: hardCapBytes },
  });
  return {
    content: `Error: Tool output exceeded ${(hardCapBytes / 1024 / 1024).toFixed(1)}MB hard cap (${(rawText.length / 1024 / 1024).toFixed(1)}MB). Use more specific query parameters to reduce the result set.`,
    isError: true,
  };
}
```

---

### Task 10: Decouple UniProt Extractors (keep files, stop using)
**Modified files**: `mcp-server/src/platforms/uniprot/tools/search-handlers.ts`, `mcp-server/src/platforms/uniprot/tools/definitions.ts`

Change `search_by_gene` handler to return raw response like all other handlers:

```typescript
// BEFORE (line 86):
return extractSearchByGeneResponse(response.data, gene, species);

// AFTER:
return response.data;
```

Remove the `extractSearchByGeneResponse` import (keep `resolveSpeciesFilter` import — it's still used for query building on line 77).

Update `search_by_gene` tool description in `definitions.ts` — remove the "~98% smaller than raw" claim since it now returns raw output. The noise reduction pipeline handles size reduction at the orchestration layer instead.

**NOT modified**: `mcp-server/src/platforms/uniprot/extractors.ts` — kept intact for reference. Add a comment at the top:

```typescript
// TODO: The extractor functions below (extractEntry, extractSearchByGeneResponse,
// pickBestEntry) are currently unused. They encode valuable semantic logic
// (species defaults, taxon grouping, best-reviewed-entry selection) that should
// be revisited when designing semantic profiles for the jq policy system.
// See: artifact.policies.profiles in config.yaml
```

---

### Task 11: Policy Startup Validation
**Modified file**: `app/server/orchestration/chat-v2.ts` (or a dedicated init module)

On app startup (before first processChat call), run `validatePolicies()` and log results:

```typescript
const { valid, errors } = validatePolicies();
if (!valid) {
  logger.warn("CONFIG", "artifact_policy_validation_warnings", {
    data: { errors },
  });
}
```

This is a warning, not a crash — allows iterative policy development.

---

## Files Summary

### New files (6)
| File | Purpose |
|------|---------|
| `app/server/orchestration/tools/jq-engine.ts` | jq execution wrapper (Bun.spawn) |
| `app/server/orchestration/tools/noise-reduction.ts` | Per-tool jq noise reduction runner |
| `app/server/orchestration/tools/policy-resolver.ts` | 3-layer policy resolution + startup validation |
| `app/server/orchestration/tools/artifact-store.ts` | Process-level singleton artifact store |
| `app/server/orchestration/tools/schema-preview.ts` | JSON structure preview generator |
| `app/server/orchestration/tools/artifact-inspector.ts` | `inspect_artifact` Vercel AI SDK tool |

### Modified files (9)
| File | Changes |
|------|---------|
| `app/config.yaml` | Add `artifact` section; remove `summarizer_model` and `tool_output_summary_threshold` |
| `app/server/config.ts` | Add `ArtifactConfigSchema`; remove summarizer config + env overrides |
| `app/server/orchestration/chat-v2.ts` | Replace `maybeCompressOutput` with `handleLargeOutput`; remove `getSummarizerModel`/`generateText` imports |
| `app/server/llm/provider.ts` | Remove `getSummarizerModel()` function |
| `app/server/llm/config.ts` | Remove `summarizerModel` from `LLMConfig` interface + `DEFAULTS` |
| `app/server/llm/index.ts` | Remove `getSummarizerModel` re-export |
| `app/server/mcp/manager.ts` | Add 1MB hard cap in `callTool()` |
| `mcp-server/src/platforms/uniprot/tools/search-handlers.ts` | Return raw `response.data` from `search_by_gene`, remove `extractSearchByGeneResponse` import |
| `mcp-server/src/platforms/uniprot/tools/definitions.ts` | Update `search_by_gene` description (remove "~98% smaller" claim) |

### Untouched (kept for reference)
| File | Reason |
|------|--------|
| `mcp-server/src/platforms/uniprot/extractors.ts` | Semantic logic preserved; add TODO comment only. Revisit for semantic profiles. |

---

## Task Dependencies

```
Task 1 (jq-engine) ─────────────┐
                                 ├──▶ Task 4 (noise-reduction) ──┐
Task 3 (policy-resolver) ───────┘                                │
                                                                  │
Task 2 (config schema) ──▶ Task 3 (policy-resolver)             │
                                                                  ├──▶ Task 8 (chat-v2 integration)
Task 5 (artifact-store) ──▶ Task 7 (inspect tool) ──────────────┘
                                                                  │
Task 6 (schema-preview) ─────────────────────────────────────────┘

Task 9 (hard cap)          ── independent, can be done anytime
Task 10 (decouple extractors) ── independent, can be done anytime
Task 11 (validation)       ── after Task 3
```

**Recommended execution order**:
1. Tasks 1, 2, 5, 6 (all independent foundations)
2. Task 3 (depends on Task 2 config)
3. Tasks 4, 7 (depend on 1+3 and 5 respectively)
4. Task 8 (integration — depends on 4, 5, 6, 7)
5. Tasks 9, 10, 11 (independent finalization)

---

## Deferred / Future Work

- **Semantic profiles**: Named, versioned jq transforms for known workflows (e.g. `profile_uniprot_gene_bridge_v1`). The config structure supports them but no profiles are defined yet. Revisit once the noise-reduction tier is proven.
- **UniProt extractor semantics**: The species grouping, taxon-based best-entry selection, and reviewed-preference logic in extractors.ts should be modeled as a semantic profile once the system is stable.
- **Golden fixture tests**: For UniProt and ChEMBL high-volume tools, store 2-3 representative raw responses and assert policy pipeline produces outputs under budget with key fields preserved.
- **Observability tuning loop**: Log per-tool metrics (raw size, post-noise size, artifact rate, inspect call rate) to prioritize policy work where payloads are biggest.
- **ChEMBL semantic profiles**: Once ChEMBL noise filters are validated, add tool-specific profiles for high-frequency tools like `search_compounds`, `search_activities`.

---

## Verification Plan

### Unit tests
- **jq-engine**: Test with valid/invalid filters, timeout enforcement, output cap, large input
- **policy-resolver**: Test 3-layer composition (global only, global+platform, global+platform+tool, profile resolution)
- **artifact-store**: Test store/get/query, session scoping, TTL expiry (mock timers), per-session cap eviction
- **schema-preview**: Test with nested objects, arrays, deep structures, long strings, empty data

### Integration tests
- Run full pipeline on captured UniProt `search_proteins("BRCA1", size=5)` response:
  - Verify noise reduction brings size down significantly
  - Verify artifact is created with correct preview structure
  - Verify `inspect_artifact` can extract interactions via jq filter
- Run pipeline on ChEMBL `search_compounds("aspirin")` response:
  - Verify noise filters apply
  - Verify result is either inline or artifacted depending on size

### Manual E2E
1. Start app, open chat
2. Ask "What proteins interact with BRCA1?" → should trigger UniProt tool → large output → artifact → preview in context → LLM calls inspect_artifact → clean answer
3. Ask "Tell me about aspirin in ChEMBL" → should trigger ChEMBL tool → noise reduction → verify response quality
4. Verify no regressions on small outputs (< 15K chars pass through unchanged)
5. Check logs for observability entries: `noise_reduction_applied`, `artifact_stored`

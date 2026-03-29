# Plan: Model-Agnostic Migration (Vercel AI SDK + Hybrid Tool Search)

## Context

The orchestration layer (`app/server/orchestration/chat.ts`, 818 LOC) and tool registry (`app/server/mcp/registry.ts`) are tightly coupled to `@anthropic-ai/sdk` — Anthropic-specific streaming events, content block types, `tool_search_tool_bm25` (a Claude-only built-in), and `defer_loading`. This makes it impossible to use other LLM providers.

**Goal**: Make the system model-agnostic via Vercel AI SDK, supporting **Gemini 3 Flash** (`gemini-3-flash-preview`) and **Claude Haiku** (`claude-haiku-4-5`) as the initial two providers. Replace Claude's proprietary `tool_search_tool_bm25` with a self-hosted hybrid search (FTS5 BM25 + embedding cosine similarity with RRF fusion).

**What stays untouched**: MCP unified server, all 10 platform modules (210+ tools), frontend SSE parser, Zustand store, frontend types, database message format.

---

## Models

| Role | Gemini | Anthropic |
|------|--------|-----------|
| Chat | `gemini-3-flash-preview` | `claude-haiku-4-5` |
| Title | `gemini-3-flash-preview` | `claude-haiku-4-5` |
| Summarizer | `gemini-3-flash-preview` | `claude-haiku-4-5` |
| Embeddings | `gemini-embedding-001` (768 dims) | `gemini-embedding-001` (shared) |

Embedding model is provider-independent — always uses Gemini `gemini-embedding-001` via `@ai-sdk/google`.

---

## Phase 0: Hybrid Tool Search Engine

**Goal**: Build the search system independently. Verify it works before touching any LLM code. The existing Claude flow remains fully functional.

### Step 0.1 — FTS5 Schema + Queries

**Modify** `app/server/db/schema.sql` — append FTS5 virtual table:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS tool_search_fts USING fts5(
  full_name,
  server,
  tool_name,
  description,
  tokenize='porter unicode61'
);
```

**Modify** `app/server/db/index.ts` — add `toolSearchQueries` export:
- `clearAll()` — DELETE FROM tool_search_fts
- `insertTool(fullName, server, toolName, description)` — INSERT into FTS5
- `searchBM25(query, limit)` — SELECT with MATCH, ORDER BY rank, returns `{full_name, server, tool_name, description, rank}[]`

### Step 0.2 — Embedding Build Script

**Create** `scripts/generate-tool-embeddings.ts`

Uses `@ai-sdk/google` + `ai` SDK's `embedMany()`:
1. Spawns the unified MCP server, lists all tools
2. For each tool, builds search text: `"{server}__{toolName}: {description}"`
3. Calls `embedMany({ model: google.embedding('gemini-embedding-001'), values: [...] })` in batches of 100
4. Writes to `data/tool-embeddings.json`:
```json
{
  "model": "gemini-embedding-001",
  "dimension": 768,
  "generated_at": "2026-03-27T...",
  "tools": [
    { "full_name": "ensembl__search_genes", "text": "...", "embedding": [0.012, ...] }
  ]
}
```

**Modify** root `package.json` — add `"generate:embeddings": "bun run scripts/generate-tool-embeddings.ts"`

**Dependencies needed** (installed in Phase 1, but script can use direct fetch as fallback): `ai`, `@ai-sdk/google`

**Env**: `GEMINI_API_KEY` (required)

### Step 0.3 — Hybrid Search Engine

**Create** `app/server/search/hybrid-search.ts` (~200 LOC)

```typescript
export interface SearchResult {
  fullName: string;      // "ensembl__search_genes"
  server: string;
  toolName: string;
  description: string;
  score: number;         // RRF-fused score
  bm25Rank?: number;
  semanticRank?: number;
}

export interface HybridSearchConfig {
  bm25Weight: number;                // env: TOOL_SEARCH_BM25_WEIGHT, default 1.0
  semanticWeight: number;            // env: TOOL_SEARCH_SEMANTIC_WEIGHT, default 1.0
  shortQueryTokenThreshold: number;  // env: TOOL_SEARCH_SHORT_QUERY_THRESHOLD, default 4
  shortQueryBm25Weight: number;      // env: TOOL_SEARCH_SHORT_QUERY_BM25_WEIGHT, default 2.0
  topK: number;                      // env: TOOL_SEARCH_TOP_K, default 15
  rrfK: number;                      // standard RRF constant, default 60
}

export class HybridToolSearch {
  private embeddings: Map<string, Float32Array>;
  private config: HybridSearchConfig;

  loadEmbeddings(filePath: string): void;                    // Parse JSON → Float32Array map
  indexTools(tools: ToolInfo[]): void;                       // Populate FTS5 table
  async search(query: string): Promise<SearchResult[]>;      // Main entry: BM25 + semantic + RRF

  private searchBM25(query: string): SearchResult[];         // Via toolSearchQueries
  private async searchSemantic(query: string): Promise<SearchResult[]>;  // Cosine brute-force
  private async getQueryEmbedding(query: string): Promise<Float32Array>; // Gemini API
  private cosineSimilarity(a: Float32Array, b: Float32Array): number;
  private fuseRRF(bm25: SearchResult[], semantic: SearchResult[]): SearchResult[];
}
```

Key details:
- `getQueryEmbedding()` uses `embed()` from Vercel AI SDK with `google.embedding('gemini-embedding-001')`
- If `GEMINI_API_KEY` not set or embedding call fails → falls back to BM25-only with logged warning
- `fuseRRF()`: `score(d) = Σ (weight_i / (k + rank_i(d)))`. When query word count ≤ `shortQueryTokenThreshold`, use `shortQueryBm25Weight` instead of `bm25Weight`
- Cosine similarity: tight loop over `Float32Array`, ~0.1ms for 200 tools
- All config values loaded from env vars with defaults

**Create** `app/server/search/index.ts` — barrel export + singleton:
```typescript
export const hybridSearch = new HybridToolSearch();
```

### Step 0.4 — Wire into Server Startup

**Modify** `app/server/index.ts` — after `toolRegistry.discoverTools(mcpManager)`:
```typescript
// Index tools for hybrid search
const allTools = toolRegistry.getAll(false).map(t => ({
  fullName: `${t.server}__${t.name}`,
  server: t.server, toolName: t.name, description: t.description,
}));
hybridSearch.indexTools(allTools);

// Load precomputed embeddings
try {
  hybridSearch.loadEmbeddings(join(process.cwd(), "..", "data", "tool-embeddings.json"));
} catch (e) {
  logger.warn("STARTUP", "embeddings_load_failed", { error: e });
}
```

### Step 0.5 — Hybrid Search API Endpoint (Testing)

**Modify** `app/server/routes/tools.ts` — add `GET /api/tools/hybrid-search?q=...` route that calls `hybridSearch.search(q)` and returns results. For debugging/tuning only.

### Verification
- [ ] `bun run dev` — server starts, logs `embeddings_loaded`, existing chat works unchanged
- [ ] `GET /api/tools/hybrid-search?q=protein+structure` returns relevant tools
- [ ] `GET /api/tools/hybrid-search?q=SMILES` returns pubchem tools (BM25 keyword match)
- [ ] `GET /api/tools/hybrid-search?q=find+drugs+targeting+kinases` returns chembl/open-targets tools (semantic match)
- [ ] Latency < 200ms per search

---

## Phase 1: Provider Abstraction Layer

**Goal**: Install Vercel AI SDK, define provider config + factory. No orchestration changes yet.

### Step 1.1 — Install Dependencies

```bash
cd app && bun add ai @ai-sdk/anthropic @ai-sdk/google
```

Note: `@ai-sdk/openai` not needed yet — only Gemini + Anthropic for now.

### Step 1.2 — LLM Configuration

**Create** `app/server/llm/config.ts` (~50 LOC)

```typescript
export type LLMProviderName = "anthropic" | "google";

export interface LLMConfig {
  provider: LLMProviderName;
  chatModel: string;
  titleModel: string;
  summarizerModel: string;
  maxRetries: number;
  toolOutputSummaryThreshold: number;
}

export function loadLLMConfig(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || "anthropic") as LLMProviderName;
  const defaults = {
    anthropic: { chat: "claude-haiku-4-5", title: "claude-haiku-4-5", summarizer: "claude-haiku-4-5" },
    google:    { chat: "gemini-3-flash-preview", title: "gemini-3-flash-preview", summarizer: "gemini-3-flash-preview" },
  };
  return {
    provider,
    chatModel:       process.env.LLM_CHAT_MODEL || process.env.CLAUDE_MODEL || defaults[provider].chat,
    titleModel:      process.env.LLM_TITLE_MODEL || process.env.CLAUDE_TITLE_MODEL || defaults[provider].title,
    summarizerModel: process.env.LLM_SUMMARIZER_MODEL || process.env.TOOL_SUMMARIZER_MODEL || defaults[provider].summarizer,
    maxRetries:      parseInt(process.env.LLM_MAX_RETRIES || "3", 10),
    toolOutputSummaryThreshold: parseInt(process.env.TOOL_OUTPUT_SUMMARY_THRESHOLD || "15000", 10),
  };
}
```

Old env vars (`CLAUDE_MODEL`, `CLAUDE_TITLE_MODEL`, `TOOL_SUMMARIZER_MODEL`) kept as fallbacks for zero-config migration.

### Step 1.3 — Provider Factory

**Create** `app/server/llm/provider.ts` (~60 LOC)

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV1 } from "ai";

export function getChatModel(): LanguageModelV1;
export function getTitleModel(): LanguageModelV1;
export function getSummarizerModel(): LanguageModelV1;
export function getEmbeddingModel(): EmbeddingModelV1<string>;  // Always google
```

- Anthropic provider uses `ANTHROPIC_API_KEY`
- Google provider uses `GEMINI_API_KEY` (env var: `GOOGLE_GENERATIVE_AI_API_KEY` is the default the SDK looks for, we'll also support `GEMINI_API_KEY`)
- Embedding model is always `google.embedding('gemini-embedding-001')` regardless of LLM provider

**Create** `app/server/llm/index.ts` — barrel re-export

### Verification
- [ ] `bun run typecheck` passes
- [ ] Server starts without errors (no runtime changes yet)
- [ ] Existing Claude chat still works identically

---

## Phase 2: Tool Format Conversion

**Goal**: Make registry provider-agnostic. Add Vercel AI SDK tool format conversion.

### Step 2.1 — Remove Anthropic Types from Registry

**Modify** `app/server/mcp/registry.ts`:

- Remove `import type Anthropic from "@anthropic-ai/sdk"` (line 6)
- Change `ClaudeTool.input_schema` type from `Anthropic.Tool.InputSchema` to `Record<string, unknown>`
- Keep `toClaudeFormat()` working (for the feature flag transition in Phase 3) — just cast internally
- Keep `defer_loading` in `ClaudeTool` interface (still used by the old code path)

### Step 2.2 — Add Vercel AI SDK Tool Format

**Modify** `app/server/mcp/registry.ts` — add two new methods:

```typescript
import { jsonSchema } from "ai";
import type { CoreTool } from "ai";

/** Get core (always-loaded) tools in Vercel AI SDK format */
toVercelCoreTools(): Record<string, CoreTool> {
  // Filters to ALWAYS_LOADED_TOOLS only
  // Uses jsonSchema() wrapper for raw JSON Schema → Vercel format
  // Returns Record<sanitizedName, CoreTool>
}

/** Get a single tool by full name in Vercel format (for dynamic activation) */
getVercelTool(fullName: string): CoreTool | null {
  // Looks up tool, wraps with jsonSchema()
}
```

### Step 2.3 — Tool Name Sanitization

**Create** `app/server/llm/tool-names.ts` (~50 LOC)

Gemini rejects hyphens in tool names (`open-targets__search_entities` fails). Need bidirectional mapping:

```typescript
export function sanitizeToolName(name: string, provider: LLMProviderName): string;
  // anthropic: pass-through
  // google: "open-targets__..." → "open_targets__..."

export function desanitizeToolName(sanitized: string, provider: LLMProviderName): string;
  // Reverses: uses HYPHENATED_PLATFORMS set from platforms.config.ts
```

Source of truth for hyphenated platforms: `enabledPlatforms` from `app/server/mcp/platforms.config.ts`. Currently only `open-targets` has a hyphen (clinicaltrials/clinpgx don't).

### Verification
- [ ] `bun run typecheck` passes
- [ ] `toClaudeFormat()` still returns identical output (old path unbroken)
- [ ] `toVercelCoreTools()` returns ~11 core tools in correct format
- [ ] `sanitizeToolName("open-targets__search_entities", "google")` → `"open_targets__search_entities"`
- [ ] Round-trip: `desanitize(sanitize(name))` === original name

---

## Phase 3: New Orchestration Engine

**Goal**: Rewrite the agentic loop using Vercel AI SDK `streamText()`. Feature-flagged alongside old code.

### Step 3.1 — Search Meta-Tool

**Create** `app/server/orchestration/tools/search-tool.ts` (~80 LOC)

Replaces Claude's `tool_search_tool_bm25`. A standard callable tool exposed to any LLM:

```typescript
import { tool } from "ai";
import { z } from "zod";

export function createSearchTool() {
  return tool({
    description: "Search for specialized bioinformatics tools by describing what you need. " +
      "Returns matching tools with names and descriptions so you can call them directly. " +
      "Use this when the always-available core tools don't cover your needs.",
    parameters: z.object({
      query: z.string().describe("Natural language description of the capability you need"),
    }),
    execute: async ({ query }) => {
      const results = await hybridSearch.search(query);
      const topResults = results.slice(0, 8);
      return {
        found: topResults.length,
        tools: topResults.map(r => ({
          name: r.fullName,
          description: r.description,
          relevance_score: r.score,
        })),
        instruction: "Call the tool by its exact name with the required parameters.",
      };
    },
  });
}
```

**Pattern A (two-hop)**: Model calls `search_available_tools` → gets descriptions → calls actual tool in next turn. The discovered tools must be dynamically added to the active tool set for the next `streamText` call.

### Step 3.2 — MCP Tool Executor Wrappers

**Create** `app/server/orchestration/tools/mcp-executor.ts` (~60 LOC)

Wraps `mcpManager.callTool()` as Vercel AI SDK `execute` functions:

```typescript
export function createMcpToolExecutor(fullName: string) {
  return async (args: Record<string, unknown>) => {
    const { server, name } = toolRegistry.parseToolName(fullName);
    const result = await mcpManager.callTool(server, name, args);
    if (result.isError) throw new Error(String(result.content));
    return typeof result.content === "string" ? result.content : JSON.stringify(result.content);
  };
}
```

### Step 3.3 — New Chat Orchestration

**Create** `app/server/orchestration/chat-v2.ts` (~450 LOC)

This replaces the 818-line `chat.ts`. Key structure:

```typescript
import { streamText, generateText, type CoreMessage, type CoreTool } from "ai";
import { getChatModel, getTitleModel, getSummarizerModel, llmConfig } from "../llm";
import { sanitizeToolName, desanitizeToolName } from "../llm/tool-names";

const SYSTEM_PROMPT = `...`;  // Same content, but references "search_available_tools"
                              // instead of "tool_search_tool_bm25"

export async function* processChat(sessionId, userId, userMessage): AsyncGenerator<StreamEvent> {
  // 1. Session check, history load (same as current)
  // 2. Build CoreMessage[] from DB history
  // 3. Build initial tool set: core tools + search_available_tools

  let activeTools: Record<string, CoreTool> = buildInitialToolSet();
  let continueLoop = true;

  while (continueLoop) {
    const result = streamText({
      model: getChatModel(),
      system: SYSTEM_PROMPT,
      messages,
      tools: activeTools,
      maxRetries: llmConfig.maxRetries,
    });

    // Stream text to SSE
    for await (const chunk of result.textStream) {
      fullContent += chunk;
      yield { type: "text", data: chunk };
    }

    const response = await result;

    if (response.finishReason === "tool-calls") {
      for (const tc of response.toolCalls) {
        const originalName = desanitizeToolName(tc.toolName, llmConfig.provider);
        yield { type: "tool_start", data: { id: tc.toolCallId, tool: originalName, ... } };

        if (tc.toolName === "search_available_tools") {
          // Execute search, expand activeTools with discovered tools
          const searchResults = await hybridSearch.search(tc.args.query);
          for (const found of searchResults) {
            const sanitized = sanitizeToolName(found.fullName, llmConfig.provider);
            if (!activeTools[sanitized]) {
              const vTool = toolRegistry.getVercelTool(found.fullName);
              if (vTool) {
                activeTools[sanitized] = {
                  ...vTool,
                  execute: createMcpToolExecutor(found.fullName),
                };
              }
            }
          }
          // Return search results as tool output
          yield { type: "tool_end", data: { id: tc.toolCallId, output: searchResults } };

        } else {
          // Regular MCP tool — execute + optionally compress output
          try {
            let output = await createMcpToolExecutor(originalName)(tc.args);
            output = await maybeCompressOutput(originalName, output, userMessage);
            yield { type: "tool_end", data: { id: tc.toolCallId, output } };
          } catch (err) {
            yield { type: "tool_end", data: { id: tc.toolCallId, error: err.message } };
          }
        }
      }
      // Append assistant + tool result messages, continue loop
    } else {
      continueLoop = false;
    }
  }

  // Store in DB, yield done
}
```

**Tool output compression** — `maybeCompressOutput()`:
```typescript
async function maybeCompressOutput(toolName, rawOutput, userQuery): Promise<string> {
  if (rawOutput.length <= llmConfig.toolOutputSummaryThreshold) return rawOutput;
  const { text } = await generateText({
    model: getSummarizerModel(),
    maxTokens: 4096,
    system: "You are a biomedical data extraction assistant...",
    prompt: `Extract relevant info from "${toolName}" output (${rawOutput.length} chars)...\n\n${rawOutput}`,
  });
  return `[Summarized from ${(rawOutput.length / 1024).toFixed(1)} KB] ${text}`;
}
```

**Title generation** — `generateSessionTitle()`:
```typescript
export async function generateSessionTitle(sessionId, firstMessage): Promise<string> {
  const { text } = await generateText({
    model: getTitleModel(),
    maxTokens: 50,
    prompt: `Generate a 3-6 word title:\n"${firstMessage.substring(0, 300)}"`,
    abortSignal: AbortSignal.timeout(5000),
  });
  return normalizeTitle(text);
}
```

**Message history reconstruction** — converts DB rows to `CoreMessage[]`:
```typescript
function buildMessages(history: DBMessage[], newMessage: string): CoreMessage[] {
  const messages: CoreMessage[] = [];
  for (const msg of history) {
    messages.push({ role: msg.role as "user" | "assistant", content: msg.content || "" });
  }
  messages.push({ role: "user", content: newMessage });
  return messages;
}
```

Note: Tool calls from history are stored in `tool_calls` JSON column but are NOT replayed as tool-use blocks — the current implementation already works this way (assistant message content only).

### Step 3.4 — Feature Flag in Route

**Modify** `app/server/routes/chat.ts`:

```typescript
import { processChat as processChatLegacy, generateSessionTitle as titleLegacy } from "../orchestration/chat";
import { processChat as processChatV2, generateSessionTitle as titleV2 } from "../orchestration/chat-v2";

const USE_V2 = process.env.USE_VERCEL_AI !== "false";  // Default ON

const processChat = USE_V2 ? processChatV2 : processChatLegacy;
const generateSessionTitle = USE_V2 ? titleV2 : titleLegacy;
```

Default is V2 (new code). Set `USE_VERCEL_AI=false` to revert to old Anthropic-only path.

### Step 3.5 — Update System Prompt

In `chat-v2.ts`, the system prompt changes:
```diff
-### Additional Specialized Tools (use tool_search_tool_bm25 to discover):
-use the tool_search_tool_bm25 tool to find relevant tools by describing what you need.
+### Additional Specialized Tools (use search_available_tools to discover):
+use the search_available_tools tool to find relevant tools by describing what you need.
```

### Verification
- [ ] `USE_VERCEL_AI=false` — old path works identically (regression test)
- [ ] `LLM_PROVIDER=anthropic USE_VERCEL_AI=true` — Haiku works via Vercel AI SDK
- [ ] `LLM_PROVIDER=google GEMINI_API_KEY=... USE_VERCEL_AI=true` — Gemini Flash works
- [ ] SSE events are identical shape: start, text, tool_start, tool_end, title, done, error
- [ ] Frontend works without any changes (no frontend modifications needed)
- [ ] Tool discovery via `search_available_tools` works — model searches, finds tools, calls them
- [ ] Tool output compression works with both providers
- [ ] Title generation works with both providers
- [ ] Messages stored correctly in SQLite (same format as before)
- [ ] Multi-turn conversations with tool use work (history reconstruction)

---

## Phase 4: Provider-Specific Testing & Edge Cases

**Goal**: Thorough testing with both providers, handle edge cases.

### Test Matrix

| Scenario | Anthropic | Google |
|----------|-----------|--------|
| Simple Q&A (no tools) | | |
| Single core tool call | | |
| Multi-tool call (parallel) | | |
| search_available_tools → discovered tool | | |
| Large tool output (>15KB compression) | | |
| Tool error handling | | |
| Multi-turn with history | | |
| Title generation | | |
| Rate limit / retry | | |

### Known Edge Cases to Handle
- **Gemini tool name restriction**: Handled by sanitization (Phase 2)
- **Active tool count cap**: If > 100 tools get dynamically activated in one session, log warning. Unlikely with 210 total tools and typical 2-3 searches per session
- **Embedding API failure**: Graceful fallback to BM25-only (Phase 0)
- **Gemini JSON Schema strictness**: Some MCP tools may have non-standard JSON Schema. Add a schema sanitizer that strips unknown keywords if needed

---

## Phase 5: Cleanup

**Goal**: Remove old code path, update config documentation.

### Step 5.1 — Remove Feature Flag
- **Modify** `app/server/routes/chat.ts` — always import from `chat-v2.ts`

### Step 5.2 — Remove Old Orchestration
- **Delete** `app/server/orchestration/chat.ts` (the 818-line Anthropic-coupled file)
- **Rename** `chat-v2.ts` → `chat.ts`

### Step 5.3 — Clean Up Registry
- **Modify** `app/server/mcp/registry.ts` — remove `toClaudeFormat()`, `ClaudeTool` interface, residual Anthropic types
- Can optionally remove `@anthropic-ai/sdk` from `package.json` if `@ai-sdk/anthropic` bundles it internally

### Step 5.4 — Update Environment Documentation
- **Modify** `app/.env.example` — add all new env vars with comments:

```bash
# === LLM Provider ===
LLM_PROVIDER=google                    # "google" | "anthropic"
LLM_CHAT_MODEL=gemini-3-flash-preview  # or claude-haiku-4-5
LLM_TITLE_MODEL=gemini-3-flash-preview
LLM_SUMMARIZER_MODEL=gemini-3-flash-preview
LLM_MAX_RETRIES=3
TOOL_OUTPUT_SUMMARY_THRESHOLD=15000

# === API Keys ===
GEMINI_API_KEY=                         # Required for Google provider + embeddings
ANTHROPIC_API_KEY=                      # Required for Anthropic provider

# === Tool Search Tuning ===
TOOL_SEARCH_BM25_WEIGHT=1.0
TOOL_SEARCH_SEMANTIC_WEIGHT=1.0
TOOL_SEARCH_SHORT_QUERY_THRESHOLD=4     # Queries with ≤ N words bias toward BM25
TOOL_SEARCH_SHORT_QUERY_BM25_WEIGHT=2.0 # BM25 weight multiplier for short queries
TOOL_SEARCH_TOP_K=15

# === Legacy (still supported as fallbacks) ===
# CLAUDE_MODEL, CLAUDE_TITLE_MODEL, TOOL_SUMMARIZER_MODEL
```

---

## File Summary

### New Files (8)
| File | LOC (est) | Purpose |
|------|-----------|---------|
| `app/server/llm/config.ts` | 50 | Provider config with env var loading |
| `app/server/llm/provider.ts` | 60 | Model factory (chat/title/summarizer/embedding) |
| `app/server/llm/tool-names.ts` | 50 | Bidirectional tool name sanitization |
| `app/server/llm/index.ts` | 10 | Barrel re-export |
| `app/server/search/hybrid-search.ts` | 200 | FTS5 + cosine + RRF search engine |
| `app/server/search/index.ts` | 10 | Barrel + singleton |
| `app/server/orchestration/tools/search-tool.ts` | 80 | search_available_tools meta-tool |
| `scripts/generate-tool-embeddings.ts` | 100 | Build-time embedding generation |

### Modified Files (7)
| File | Change |
|------|--------|
| `app/server/db/schema.sql` | Add FTS5 virtual table |
| `app/server/db/index.ts` | Add `toolSearchQueries` |
| `app/server/mcp/registry.ts` | Remove Anthropic types, add `toVercelCoreTools()`, `getVercelTool()` |
| `app/server/index.ts` | Wire hybrid search into startup |
| `app/server/routes/chat.ts` | Feature flag V1/V2, then remove flag |
| `app/server/routes/tools.ts` | Add hybrid-search debug endpoint |
| `app/.env.example` | New env vars |

### Replaced Files (1)
| File | Replacement |
|------|-------------|
| `app/server/orchestration/chat.ts` (818 LOC) | `app/server/orchestration/chat-v2.ts` (~450 LOC) |

### New Dependencies
```bash
bun add ai @ai-sdk/anthropic @ai-sdk/google
```

### Total New Code: ~1,060 LOC (replacing 818 LOC of Anthropic-coupled code)

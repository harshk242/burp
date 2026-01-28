# Phase 4: UI Implementation Plan

## Overview

Phase 4 is split into two parts:
- **4a**: Backend optimization for dynamic tool selection (prevents context overflow)
- **4b**: Frontend implementation with Next.js static export

---

## Phase 4a: Backend - Dynamic Tool Selection

### Problem

Current implementation sends ALL 210+ tools to Claude on every request:

```ts
// chat.ts:96
const tools = toolRegistry.toClaudeFormat(true); // ~63,000 tokens
```

This causes:
- Context window exhaustion
- Increased latency
- Reduced accuracy (per Anthropic: 49% → 74% improvement with filtering)

### Solution: Anthropic's Built-in Tool Search (Beta)

Anthropic provides a **built-in Tool Search Tool** that handles on-demand tool discovery automatically. This is much simpler than building our own search.

**Reference:** [Tool Search Tool Documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)

#### How It Works

```
User: "What proteins interact with TP53?"
         │
         ▼
1. Claude receives:
   - System prompt with database summaries
   - Built-in tool_search_tool_bm25 (natural language search)
   - ALL 210+ tools with defer_loading: true
         │
         ▼
2. Claude calls: tool_search_tool_bm25("protein interaction")
         │
         ▼
3. API automatically returns tool_reference blocks (3-5 tools)
   - API expands these to full tool definitions
   - Claude sees: uniprot__get_protein_interactions, etc.
         │
         ▼
4. Claude calls the discovered tools
         │
         ▼
5. Results streamed to user
```

#### Key Benefits

| Aspect | Custom Implementation | Built-in Tool Search |
|--------|----------------------|---------------------|
| Code complexity | High (search logic, tool expansion) | Low (just add flag) |
| Search quality | Basic keyword matching | BM25 or regex (optimized) |
| Maintenance | We maintain it | Anthropic maintains it |
| Token efficiency | Manual optimization | Automatic (3-5 results) |

### Hard Constraints

Before implementing, note these critical constraints for tool search:

| Constraint | Reason |
|------------|--------|
| **No `input_examples` with tool search** | Tool search is NOT compatible with tool use examples. You cannot include `input_examples` in tool definitions when using `tool_search_tool_*`. The API will reject requests that combine both features. |
| **At least one non-deferred tool** | API returns 400 error if ALL tools have `defer_loading: true`. |
| **Beta header required** | Must include `betas: ["advanced-tool-use-2025-11-20"]` in API calls. |
| **Model support** | Only Claude Sonnet 4.5 and Opus 4.5 support tool search (no Haiku). |

**Reference:** [Tool Search Tool Documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)

### Implementation Tasks

#### 1. Add Beta Header to API Calls

The tool search is in beta. Add the required header:

```ts
// server/orchestration/chat.ts

const stream = anthropic.beta.messages.stream({
  model: "claude-sonnet-4-5-20250929",
  betas: ["advanced-tool-use-2025-11-20"],  // Required for tool search
  max_tokens: 4096,
  system: SYSTEM_PROMPT,
  tools: tools,
  messages,
});
```

#### 2. Add Tool Search Tool to Tools Array

Include the built-in tool search tool (BM25 variant for natural language):

```ts
// server/orchestration/chat.ts

const TOOL_SEARCH_TOOL = {
  type: "tool_search_tool_bm25_20251119",
  name: "tool_search",
};

// Or use regex variant for pattern matching:
// const TOOL_SEARCH_TOOL = {
//   type: "tool_search_tool_regex_20251119",
//   name: "tool_search",
// };
```

#### 3. Define Always-Loaded Core Tools (ID-Bridge & Evidence Hubs)

**IMPORTANT:** Anthropic's API returns a 400 error if ALL tools have `defer_loading: true`:
> "All tools have defer_loading set. At least one tool must be non-deferred."

We need at least one non-deferred tool. Rather than arbitrarily picking one, we define a strategic set of **always-loaded core tools** that serve as ID bridges and evidence hubs.

**Always-Loaded Tools (9-11 tools):**

```ts
// server/mcp/registry.ts

/**
 * Core tools that are ALWAYS loaded (non-deferred).
 * These serve as ID-bridge tools and evidence hubs, enabling:
 * - Gene symbol → Ensembl ID (foundation ID)
 * - Gene → Protein ID bridge
 * - Compound name → ChEMBL ID
 * - Structure → PubChem CID
 * - rsID → clinical context
 * - Quick literature and trial discovery
 * 
 * Tool search can still find additional specialized tools.
 */
const ALWAYS_LOADED_TOOLS = new Set([
  // ID-Bridge Core
  'ensembl__search_genes',           // Gene symbol → ENSG (foundation ID)
  'open-targets__search_entities',   // Gene/disease → ENSG/EFO (most connected hub)
  'uniprot__search_by_gene',         // Gene symbol → UniProt accession
  'uniprot__get_external_references', // UniProt → Ensembl cross-refs
  'ensembl__get_xrefs',              // Ensembl → UniProt cross-refs (bidirectional)
  'chembl__search_compounds',        // Drug name → ChEMBL ID (compound hub)
  'pubchem__search_by_smiles',       // SMILES → PubChem CID (ChEMBL ↔ PubChem mapping)
  'clinvar__lookup_by_rsid',         // rsID → clinical context + gene (variant bridge)
  
  // Evidence Hubs
  'pubmed__search_pubmed',           // Quick PMID discovery (literature hub)
  'clinical-trials__search_by_intervention', // Drug → NCT IDs (trial link)
  'clinical-trials__search_by_condition',    // Condition → NCT IDs (trial link)
]);
```

**Why these specific tools?**

| Tool | Purpose | ID Mapping Enabled |
|------|---------|-------------------|
| `ensembl__search_genes` | Foundation ID mapping | Gene symbol → ENSG |
| `open-targets__search_entities` | Most connected hub (24+ connections) | Gene/disease → ENSG/EFO |
| `uniprot__search_by_gene` | Gene → Protein bridge | Gene symbol → UniProt |
| `uniprot__get_external_references` | Cross-database linking | UniProt → Ensembl/PDB/etc |
| `ensembl__get_xrefs` | Bidirectional cross-refs | ENSG → UniProt/HGNC/etc |
| `chembl__search_compounds` | Compound hub | Drug name → ChEMBL ID |
| `pubchem__search_by_smiles` | Structure-based mapping | SMILES → CID (ChEMBL ↔ PubChem) |
| `clinvar__lookup_by_rsid` | Variant bridge | rsID → gene + clinical context |
| `pubmed__search_pubmed` | Literature discovery | Query → PMIDs |
| `clinical-trials__search_by_*` | Trial evidence | Drug/condition → NCT IDs |

This is the **minimum set** to resolve:
- Gene ↔ Protein ↔ Drug relationships
- Cross-database ID mapping
- Literature and clinical trial evidence

All other 200+ tools remain deferred and discoverable via `tool_search`.

#### 4. Modify Registry to Add defer_loading Flag

Update `toClaudeFormat()` to mark most MCP tools as deferred, but keep core tools non-deferred:

```ts
// server/mcp/registry.ts

/**
 * Core tools that are always loaded (not deferred).
 * These serve as ID-bridge tools and evidence hubs.
 */
const ALWAYS_LOADED_TOOLS = new Set([
  'ensembl__search_genes',
  'open-targets__search_entities',
  'uniprot__search_by_gene',
  'uniprot__get_external_references',
  'ensembl__get_xrefs',
  'chembl__search_compounds',
  'pubchem__search_by_smiles',
  'clinvar__lookup_by_rsid',
  'pubmed__search_pubmed',
  'clinical-trials__search_by_intervention',
  'clinical-trials__search_by_condition',
]);

/**
 * Convert tools to Claude API format with selective deferred loading.
 * Core ID-bridge tools are always loaded; others are deferred.
 */
toClaudeFormat(onlyAvailable = true): Anthropic.Tool[] {
  const tools = onlyAvailable
    ? Array.from(this.tools.values()).filter((t) => t.available)
    : Array.from(this.tools.values());

  return tools.map((tool) => {
    const fullName = `${tool.server}__${tool.name}`;
    const isCore = ALWAYS_LOADED_TOOLS.has(fullName);
    
    return {
      name: fullName,
      description: `[${tool.server}] ${tool.description}`,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      // Core tools are NOT deferred; all others are
      ...(isCore ? {} : { defer_loading: true }),
    };
  });
}

/**
 * Get the list of always-loaded tool names for verification.
 */
getAlwaysLoadedTools(): string[] {
  return Array.from(ALWAYS_LOADED_TOOLS);
}
```

**Guard against all-deferred error:**

```ts
// server/orchestration/chat.ts

// Verify at least one tool is non-deferred
const nonDeferredCount = mcpTools.filter(t => !t.defer_loading).length;
if (nonDeferredCount === 0) {
  throw new Error(
    'Configuration error: All tools have defer_loading set. ' +
    'At least one tool must be non-deferred. Check ALWAYS_LOADED_TOOLS.'
  );
}
```
```

#### 5. Update Chat Orchestration

Combine the tool search tool with MCP tools (core non-deferred + rest deferred):

```ts
// server/orchestration/chat.ts

export async function* processChat(
  sessionId: string,
  userId: string,
  userMessage: string
): AsyncGenerator<StreamEvent> {
  // ...existing setup code...

  // Get all MCP tools (core tools non-deferred, rest deferred)
  const mcpTools = toolRegistry.toClaudeFormat(true);

  // Verify at least one tool is non-deferred (guard against API error)
  const nonDeferredCount = mcpTools.filter(t => !t.defer_loading).length;
  if (nonDeferredCount === 0) {
    throw new Error(
      'Configuration error: All tools have defer_loading set. ' +
      'At least one tool must be non-deferred. Check ALWAYS_LOADED_TOOLS.'
    );
  }

  // Combine: tool search (built-in) + MCP tools (mix of deferred/non-deferred)
  const tools = [
    {
      type: "tool_search_tool_bm25_20251119",
      name: "tool_search",
    },
    ...mcpTools,
  ];

  // Log for debugging
  console.log(`Tools loaded: ${mcpTools.length} total, ${nonDeferredCount} always-loaded (core)`);

  // Tool calling loop
  while (continueLoop) {
    const stream = anthropic.beta.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      betas: ["advanced-tool-use-2025-11-20"],
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: tools.length > 0 ? tools : undefined,
      messages,
    });

    // ...rest of streaming logic...
    // Note: tool_search results are handled automatically by the API
    // Claude can directly use core tools without searching
    // For specialized tools, Claude will call tool_search first
  }
}
```

#### 6. Update System Prompt

Help Claude understand the tool search workflow and always-available core tools:

```ts
// server/orchestration/chat.ts

const SYSTEM_PROMPT = `You are a biomedical research assistant with access to 10 specialized databases:

1. **UniProt** - Protein sequences, structures, and annotations
2. **ChEMBL** - Drug compounds, bioactivity, and pharmacology data
3. **PubChem** - Chemical structures, properties, and bioassays
4. **Ensembl** - Genomic sequences, gene annotations, and variants
5. **ClinVar** - Clinical significance of genetic variants
6. **Open Targets** - Drug-target associations and disease evidence
7. **Reactome** - Biological pathways and reactions
8. **ClinicalTrials** - Clinical trial registrations and results
9. **PubMed** - Biomedical literature and abstracts
10. **ClinPGx (PharmGKB)** - Pharmacogenomics data

## Available Tools

You have 210+ specialized tools available, organized in two tiers:

### Always-Available Core Tools (use directly without searching):
- **ensembl__search_genes** - Convert gene symbols (TP53, BRCA1) → Ensembl IDs (ENSG...)
- **open-targets__search_entities** - Find genes/diseases → ENSG/EFO IDs (main hub)
- **uniprot__search_by_gene** - Gene symbol → UniProt accession (protein ID)
- **uniprot__get_external_references** - UniProt → Ensembl/PDB cross-references
- **ensembl__get_xrefs** - Ensembl → UniProt/HGNC cross-references
- **chembl__search_compounds** - Drug/compound name → ChEMBL ID
- **pubchem__search_by_smiles** - SMILES structure → PubChem CID
- **clinvar__lookup_by_rsid** - rsID → clinical significance and gene
- **pubmed__search_pubmed** - Quick literature search → PMIDs
- **clinical-trials__search_by_intervention** - Drug → clinical trials (NCT IDs)
- **clinical-trials__search_by_condition** - Condition → clinical trials (NCT IDs)

### Additional Specialized Tools (use tool_search to discover):
For specialized queries (protein structure, pathway analysis, bioactivity data, etc.), 
use the tool_search tool to find relevant tools by describing what you need.

## Workflow Guidelines

1. **Start with core tools** for ID resolution and initial discovery
2. **Use tool_search** when you need specialized analysis not covered by core tools
3. **Cross-reference multiple databases** - use IDs from one database to query others
4. **Cite specific identifiers** (UniProt IDs, ChEMBL IDs, PMIDs, ENSG IDs, etc.)
5. **Explain your findings** in clear, scientific language

## Common ID Resolution Patterns

- Gene symbol → ENSG: Use ensembl__search_genes("TP53")
- Gene → Protein: Use uniprot__search_by_gene("TP53") 
- Drug name → ChEMBL: Use chembl__search_compounds("imatinib")
- rsID → Gene: Use clinvar__lookup_by_rsid("rs1042522")

Always prefer using tools over your training knowledge for biomedical facts.`;
```

#### 7. Handle Tool Search Response Format

The API returns special response types for tool search:

```ts
// server/orchestration/chat.ts

// In the streaming event handler:
for await (const event of stream) {
  if (event.type === "content_block_start") {
    if (event.content_block.type === "server_tool_use") {
      // Built-in tool (like tool_search) being called
      // The API handles this automatically
    } else if (event.content_block.type === "tool_use") {
      // Regular MCP tool being called - handle as before
      currentToolUseBlock = {
        id: event.content_block.id,
        name: event.content_block.name,
        input: "",
      };
    }
  }
  // tool_search_tool_result is handled automatically by the API
  // tool_reference blocks are expanded to full definitions automatically
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `server/mcp/registry.ts` | Add `ALWAYS_LOADED_TOOLS` set, update `toClaudeFormat()` with selective `defer_loading` |
| `server/orchestration/chat.ts` | Add beta header, include tool search tool, add non-deferred guard, update system prompt |

### Alternative: Custom Tool Search (Optional)

If you need more control over search (e.g., embeddings-based), you can implement custom search that returns `tool_reference` blocks:

```ts
// Custom search tool result format
{
  type: "tool_result",
  tool_use_id: "toolu_custom_search",
  content: [
    { type: "tool_reference", tool_name: "uniprot__get_protein_info" },
    { type: "tool_reference", tool_name: "uniprot__get_protein_interactions" },
  ]
}
```

The API will automatically expand these references to full tool definitions.

### Testing

#### 1. Verify Always-Loaded Tools

Test that core tools work without tool_search:

```bash
# Test gene ID resolution (should work directly)
curl -X POST /api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test", "message": "What is the Ensembl ID for TP53?"}'
# Expected: Claude uses ensembl__search_genes directly (no tool_search)

# Test compound search (should work directly)
curl -X POST /api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test", "message": "Find the ChEMBL ID for imatinib"}'
# Expected: Claude uses chembl__search_compounds directly
```

#### 2. Verify Tool Search for Specialized Tools

```bash
# Test specialized query (should trigger tool_search)
curl -X POST /api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test", "message": "What are the ADMET properties of aspirin?"}'
# Expected: Claude calls tool_search, discovers chembl__analyze_admet_properties
```

#### 3. Verify the Non-Deferred Guard

Check logs to ensure:
- At least 11 tools are non-deferred (core tools)
- ~200 tools are deferred
- No "All tools have defer_loading set" error

```bash
# Look for log output like:
# "Tools loaded: 210 total, 11 always-loaded (core)"
```

#### 4. Verify Token Reduction

- Before: ~63K tokens for tools (all loaded)
- After: ~8K tokens (core tools + tool search)
  - 11 core tools: ~3K tokens
  - Tool search: ~500 tokens
  - Discovered tools (3-5 per search): ~2K tokens

#### 5. End-to-End Workflow Test

Test a complex query that uses both core and discovered tools:

```bash
curl -X POST /api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test", "message": "What proteins interact with BRCA1 and what drugs target them?"}'
# Expected flow:
# 1. ensembl__search_genes("BRCA1") → ENSG00000012048 (core tool, direct)
# 2. tool_search("protein interactions") → discovers uniprot__get_protein_interactions
# 3. Discovered tool called
# 4. open-targets__search_entities for drug lookup (core tool, direct)
```

### Optional: Add Tools Debug Endpoint

Add an endpoint to verify tool configuration:

```ts
// server/routes/tools.ts

// GET /api/tools/config - Verify tool loading configuration
router.get('/config', async (req, res) => {
  const tools = toolRegistry.toClaudeFormat(true);
  const alwaysLoaded = tools.filter(t => !t.defer_loading);
  const deferred = tools.filter(t => t.defer_loading);
  
  res.json({
    total: tools.length,
    alwaysLoaded: {
      count: alwaysLoaded.length,
      names: alwaysLoaded.map(t => t.name),
    },
    deferred: {
      count: deferred.length,
    },
    expectedAlwaysLoaded: toolRegistry.getAlwaysLoadedTools(),
  });
});
```

Usage:
```bash
curl http://localhost:3000/api/tools/config | jq
# Returns:
# {
#   "total": 210,
#   "alwaysLoaded": {
#     "count": 11,
#     "names": ["ensembl__search_genes", "open-targets__search_entities", ...]
#   },
#   "deferred": { "count": 199 },
#   "expectedAlwaysLoaded": [...]
# }
```

### Limitations

- **Beta feature**: May change in future API versions
- **Model support**: Claude Sonnet 4.5 and Opus 4.5 only (no Haiku)
- **Max tools**: 10,000 tools supported
- **Search results**: Returns 3-5 most relevant tools per search
- **No `input_examples`**: Tool search is NOT compatible with tool use examples. Do not include `input_examples` in any tool definition when using tool search.

---

## Phase 4b: Frontend - Next.js Static Export

### Tech Stack

| Category | Choice |
|----------|--------|
| Framework | Next.js 14 (App Router, static export) |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| State | Zustand |
| Auth | Clerk (`@clerk/nextjs`) |
| Icons | Lucide React |

### Project Structure

```
app/web/
├── app/
│   ├── layout.tsx                    # Root layout + ClerkProvider
│   ├── page.tsx                      # Landing page
│   ├── globals.css                   # Tailwind imports
│   ├── (auth)/
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   └── sign-up/[[...sign-up]]/page.tsx
│   ├── (protected)/
│   │   ├── layout.tsx                # Auth check wrapper
│   │   ├── chat/
│   │   │   ├── page.tsx              # Redirects to new session
│   │   │   └── [sessionId]/page.tsx  # Chat interface
│   │   ├── tools/page.tsx            # Tool browser
│   │   └── settings/page.tsx         # User settings
│   ├── request-access/page.tsx       # Waitlist form (public)
│   └── admin/
│       └── page.tsx                  # Admin dashboard
├── components/
│   ├── ui/                           # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── skeleton.tsx
│   │   └── ...
│   ├── chat/
│   │   ├── ChatContainer.tsx         # Main chat layout
│   │   ├── MessageList.tsx           # Scrollable message list
│   │   ├── MessageBubble.tsx         # Single message display
│   │   ├── MessageInput.tsx          # Input form
│   │   ├── ToolCallCard.tsx          # Tool execution display
│   │   └── StreamingText.tsx         # Animated streaming text
│   ├── layout/
│   │   ├── Header.tsx                # Top navigation
│   │   ├── Sidebar.tsx               # Session list sidebar
│   │   └── MobileNav.tsx             # Mobile navigation
│   ├── tools/
│   │   ├── ToolBrowser.tsx           # Tool listing with search
│   │   ├── ToolCard.tsx              # Single tool display
│   │   └── DatabaseGroup.tsx         # Grouped tools by database
│   └── shared/
│       ├── LoadingSpinner.tsx
│       ├── ErrorBoundary.tsx
│       └── EmptyState.tsx
├── stores/
│   ├── chatStore.ts                  # Chat state
│   ├── sessionStore.ts               # Session management
│   ├── toolStore.ts                  # Tool browser state
│   └── uiStore.ts                    # UI state (sidebar, modals)
├── lib/
│   ├── api.ts                        # API client with auth
│   ├── sse.ts                        # SSE stream handling
│   ├── utils.ts                      # Utility functions
│   └── constants.ts                  # App constants
├── hooks/
│   ├── useApi.ts                     # API hook with Clerk token
│   ├── useSSE.ts                     # SSE subscription hook
│   └── useMediaQuery.ts              # Responsive hook
├── types/
│   └── index.ts                      # TypeScript types
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json
├── components.json                   # shadcn/ui config
└── package.json
```

### Zustand Stores

#### Chat Store

```ts
// stores/chatStore.ts
import { create } from 'zustand';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  createdAt: number;
}

interface ToolCall {
  id: string;
  name: string;
  server: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  status: 'pending' | 'running' | 'complete' | 'error';
}

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  pendingToolCalls: ToolCall[];
  error: string | null;

  // Actions
  addMessage: (message: Message) => void;
  updateStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (id: string, updates: Partial<ToolCall>) => void;
  finalizeAssistantMessage: () => void;
  setError: (error: string | null) => void;
  resetStreamingState: () => void;  // Reset only streaming state, keep messages
  reset: () => void;                // Full reset including messages (for session switch)
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: '',
  pendingToolCalls: [],
  error: null,

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateStreamingContent: (content) =>
    set({ streamingContent: content, isStreaming: true }),

  appendStreamingContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),

  addToolCall: (toolCall) =>
    set((state) => ({ pendingToolCalls: [...state.pendingToolCalls, toolCall] })),

  updateToolCall: (id, updates) =>
    set((state) => ({
      pendingToolCalls: state.pendingToolCalls.map((tc) =>
        tc.id === id ? { ...tc, ...updates } : tc
      ),
    })),

  finalizeAssistantMessage: () => {
    const { streamingContent, pendingToolCalls } = get();
    if (streamingContent || pendingToolCalls.length > 0) {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: streamingContent,
            toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
            createdAt: Date.now(),
          },
        ],
        streamingContent: '',
        pendingToolCalls: [],
        isStreaming: false,
      }));
    }
  },

  setError: (error) => set({ error, isStreaming: false }),
  
  // Reset only streaming state (call before each new message send)
  resetStreamingState: () => set({ 
    streamingContent: '', 
    pendingToolCalls: [], 
    error: null,
    isStreaming: false,
  }),
  
  // Full reset including messages (call when switching sessions)
  reset: () => set({ messages: [], streamingContent: '', pendingToolCalls: [], error: null, isStreaming: false }),
}));
```

#### Session Store

```ts
// stores/sessionStore.ts
import { create } from 'zustand';

interface Session {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number | null;
}

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  isLoading: boolean;

  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((state) => ({ sessions: [session, ...state.sessions] })),
  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),
  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    })),
  setActiveSession: (id) => set({ activeSessionId: id }),
  setLoading: (isLoading) => set({ isLoading }),
}));
```

#### Tool Store

```ts
// stores/toolStore.ts
import { create } from 'zustand';

interface Tool {
  name: string;
  description: string;
  server: string;
  inputSchema: Record<string, unknown>;
  available: boolean;  // Whether the MCP server is reachable
}

interface ToolState {
  tools: Tool[];
  groupedByServer: Record<string, Tool[]>;
  searchQuery: string;
  isLoading: boolean;

  // Actions
  setTools: (tools: Tool[]) => void;
  setSearchQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;

  // Computed
  filteredTools: () => Tool[];
}

export const useToolStore = create<ToolState>((set, get) => ({
  tools: [],
  groupedByServer: {},
  searchQuery: '',
  isLoading: false,

  setTools: (tools) => {
    const grouped = tools.reduce((acc, tool) => {
      if (!acc[tool.server]) acc[tool.server] = [];
      acc[tool.server].push(tool);
      return acc;
    }, {} as Record<string, Tool[]>);
    set({ tools, groupedByServer: grouped });
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setLoading: (isLoading) => set({ isLoading }),

  filteredTools: () => {
    const { tools, searchQuery } = get();
    if (!searchQuery) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.server.toLowerCase().includes(q)
    );
  },
}));
```

### API Client

```ts
// lib/api.ts
import { useAuth } from '@clerk/nextjs';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export function useApi() {
  const { getToken } = useAuth();

  const request = async <T>(
    path: string,
    options?: RequestInit
  ): Promise<T> => {
    const token = await getToken();
    const res = await fetch(`${API_BASE}/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json();
  };

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  };
}
```

### SSE Handler

```ts
// lib/sse.ts
import { useChatStore } from '@/stores/chatStore';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export async function streamChat(
  sessionId: string,
  message: string,
  token: string,
  onTitle?: (title: string) => void
): Promise<void> {
  const store = useChatStore.getState();
  // Only reset streaming state, NOT messages (keep conversation history)
  store.resetStreamingState();

  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sessionId, message }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  // Track current event type from `event:` line
  let currentEventType: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      // Standard SSE format: backend sends "event: <type>" then "data: <payload>"
      if (line.startsWith('event: ')) {
        currentEventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const payload = line.slice(6);
        if (payload && currentEventType) {
          try {
            const data = JSON.parse(payload);
            handleSSEEvent(currentEventType, data, onTitle);
          } catch {
            // Handle non-JSON data (e.g., plain text chunks)
            handleSSEEvent(currentEventType, payload, onTitle);
          }
        }
        // Reset event type after processing (SSE events are paired)
        currentEventType = null;
      }
      // Empty line marks end of an event block (SSE spec)
      else if (line === '') {
        currentEventType = null;
      }
    }
  }
}

/**
 * Handle a single SSE event.
 * @param eventType - The event type from the `event:` line
 * @param data - The parsed payload from the `data:` line
 */
function handleSSEEvent(
  eventType: string,
  data: unknown,
  onTitle?: (title: string) => void
) {
  const store = useChatStore.getState();

  switch (eventType) {
    case 'start':
      store.updateStreamingContent('');
      break;

    case 'text':
      // Text chunks can be string or object with content
      const text = typeof data === 'string' ? data : (data as { content?: string }).content || '';
      store.appendStreamingContent(text);
      break;

    case 'tool_start':
      const toolStart = data as {
        id: string;
        tool: string;
        server: string;
        toolName: string;
        input: Record<string, unknown>;
      };
      store.addToolCall({
        id: toolStart.id,
        name: toolStart.tool,
        server: toolStart.server,
        toolName: toolStart.toolName,
        input: toolStart.input,
        status: 'running',
      });
      break;

    case 'tool_end':
      const toolEnd = data as {
        id: string;
        output?: unknown;
        error?: string;
      };
      store.updateToolCall(toolEnd.id, {
        output: toolEnd.output,
        error: toolEnd.error,
        status: toolEnd.error ? 'error' : 'complete',
      });
      break;

    case 'title':
      const title = typeof data === 'string' ? data : (data as { title?: string }).title || '';
      if (onTitle && title) onTitle(title);
      break;

    case 'done':
      store.finalizeAssistantMessage();
      break;

    case 'error':
      const errorMsg = typeof data === 'string' ? data : (data as { error?: string }).error || 'Unknown error';
      store.setError(errorMsg);
      break;

    default:
      console.warn(`Unknown SSE event type: ${eventType}`, data);
  }
}
```

### Key Pages

#### Landing Page

```tsx
// app/page.tsx
import { SignedIn, SignedOut } from '@clerk/nextjs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">Super Bio Agent</h1>
      <p className="text-lg text-muted-foreground mb-8 text-center max-w-2xl">
        Query 10 biomedical databases with natural language.
        Proteins, drugs, genes, variants, pathways, trials, and literature.
      </p>

      <SignedOut>
        <div className="flex gap-4">
          <Button asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/request-access">Request Access</Link>
          </Button>
        </div>
      </SignedOut>

      <SignedIn>
        <Button asChild size="lg">
          <Link href="/chat">Go to Chat</Link>
        </Button>
      </SignedIn>
    </main>
  );
}
```

#### Chat Page

```tsx
// app/(protected)/chat/[sessionId]/page.tsx
'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useChatStore } from '@/stores/chatStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useApi } from '@/lib/api';
import { streamChat } from '@/lib/sse';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { MessageList } from '@/components/chat/MessageList';
import { MessageInput } from '@/components/chat/MessageInput';
import { Sidebar } from '@/components/layout/Sidebar';

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { getToken } = useAuth();
  const api = useApi();
  const { messages, isStreaming, streamingContent, pendingToolCalls, addMessage, reset } = useChatStore();
  const { setActiveSession, updateSession } = useSessionStore();

  useEffect(() => {
    setActiveSession(sessionId);
    loadMessages();
    return () => reset();
  }, [sessionId]);

  async function loadMessages() {
    const data = await api.get<{ messages: Message[] }>(`/sessions/${sessionId}`);
    // Load historical messages into store
  }

  async function handleSend(content: string) {
    addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: Date.now(),
    });

    const token = await getToken();
    await streamChat(sessionId, content, token!, (title) => {
      updateSession(sessionId, { title });
    });
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <ChatContainer>
        <MessageList
          messages={messages}
          streamingContent={streamingContent}
          pendingToolCalls={pendingToolCalls}
        />
        <MessageInput onSend={handleSend} disabled={isStreaming} />
      </ChatContainer>
    </div>
  );
}
```

#### Tool Browser

```tsx
// app/(protected)/tools/page.tsx
'use client';

import { useEffect } from 'react';
import { useToolStore } from '@/stores/toolStore';
import { useApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { DatabaseGroup } from '@/components/tools/DatabaseGroup';

const DATABASE_LABELS: Record<string, string> = {
  uniprot: 'UniProt',
  chembl: 'ChEMBL',
  pubchem: 'PubChem',
  ensembl: 'Ensembl',
  clinvar: 'ClinVar',
  'open-targets': 'Open Targets',
  reactome: 'Reactome',
  'clinical-trials': 'Clinical Trials',
  pubmed: 'PubMed',
  clinpgx: 'ClinPGx',
};

export default function ToolsPage() {
  const api = useApi();
  const { groupedByServer, searchQuery, setTools, setSearchQuery, filteredTools, isLoading, setLoading } = useToolStore();

  useEffect(() => {
    loadTools();
  }, []);

  async function loadTools() {
    setLoading(true);
    const data = await api.get<{ tools: Tool[] }>('/tools');
    setTools(data.tools);
    setLoading(false);
  }

  const filtered = filteredTools();
  const groupedFiltered = filtered.reduce((acc, tool) => {
    if (!acc[tool.server]) acc[tool.server] = [];
    acc[tool.server].push(tool);
    return acc;
  }, {} as Record<string, Tool[]>);

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-2">Available Tools</h1>
      <p className="text-muted-foreground mb-6">
        210+ tools across 10 biomedical databases
      </p>

      <Input
        placeholder="Search tools..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="max-w-md mb-8"
      />

      <div className="space-y-8">
        {Object.entries(groupedFiltered).map(([server, tools]) => (
          <DatabaseGroup
            key={server}
            name={DATABASE_LABELS[server] || server}
            server={server}
            tools={tools}
          />
        ))}
      </div>
    </div>
  );
}
```

#### DatabaseGroup Component

```tsx
// components/tools/DatabaseGroup.tsx
import { Tool } from '@/types';
import { ToolCard } from './ToolCard';
import { AlertCircle } from 'lucide-react';

interface DatabaseGroupProps {
  name: string;
  server: string;
  tools: Tool[];
}

export function DatabaseGroup({ name, server, tools }: DatabaseGroupProps) {
  // Check if any tools in this group are unavailable (server down)
  const unavailableCount = tools.filter(t => !t.available).length;
  const isServerDown = unavailableCount === tools.length && tools.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">{name}</h2>
        <span className="text-sm text-muted-foreground">
          {tools.length} tools
        </span>
        {isServerDown && (
          <span className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Server unavailable
          </span>
        )}
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <ToolCard key={tool.name} tool={tool} />
        ))}
      </div>
    </div>
  );
}
```

#### ToolCard Component

```tsx
// components/tools/ToolCard.tsx
import { Tool } from '@/types';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface ToolCardProps {
  tool: Tool;
}

export function ToolCard({ tool }: ToolCardProps) {
  return (
    <Card className={!tool.available ? 'opacity-60 border-destructive/50' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium leading-tight">
            {tool.name}
          </CardTitle>
          {tool.available ? (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          ) : (
            <Badge variant="destructive" className="text-xs shrink-0">
              <AlertCircle className="h-3 w-3 mr-1" />
              Unavailable
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs line-clamp-2">
          {tool.description}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
```

### Configuration Files

#### next.config.ts

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Required for Clerk with static export
  eslint: { ignoreDuringBuilds: true },
};

export default config;
```

#### tailwind.config.ts

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // shadcn/ui theme extensions
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

#### package.json

```json
{
  "name": "super-bio-agent-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@clerk/nextjs": "^6.0.0",
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^5.0.0",
    "lucide-react": "^0.400.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0",
    "class-variance-authority": "^0.7.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "typescript": "^5",
    "tailwindcss": "^3.4.0",
    "postcss": "^8",
    "autoprefixer": "^10",
    "tailwindcss-animate": "^1.0.7"
  }
}
```

### Implementation Order

#### Day 1: Project Setup
1. Initialize Next.js project in `app/web/`
2. Configure Tailwind CSS
3. Install and configure shadcn/ui
4. Set up Clerk provider
5. Create basic layout components (Header, Sidebar shell)
6. Set up Zustand stores (empty implementations)

#### Day 2: Auth & Core Pages
1. Implement sign-in/sign-up pages with Clerk
2. Create protected layout with auth check
3. Implement landing page
4. Implement request-access page (waitlist form)
5. Create API client with Clerk token injection
6. Test auth flow end-to-end

#### Day 3: Chat Interface
1. Implement SSE stream handler
2. Create MessageList component
3. Create MessageBubble component (user/assistant variants)
4. Create MessageInput component
5. Create ToolCallCard component
6. Implement StreamingText animation
7. Wire up chat page with stores
8. Test chat flow end-to-end

#### Day 4: Sessions & Polish
1. Implement session sidebar
2. Create new session flow
3. Delete session functionality
4. Session title display/update
5. Implement tool browser page
6. Add loading states and error handling
7. Responsive design fixes
8. Final testing

### Build & Integration

After completing the frontend:

1. Build static export:
   ```bash
   cd app/web && bun run build
   ```

2. Copy output to server public directory:
   ```bash
   cp -r app/web/out/* app/public/
   ```

3. Or update Dockerfile to handle this automatically (already configured in existing Dockerfile)

---

## Summary

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **4a** | 0.5 day | Built-in tool search integration, `defer_loading` flag, beta header |
| **4b** | 3-4 days | Complete Next.js frontend with chat, tools browser, auth |

**Total: 3.5-4.5 days**

### Dependencies

- Phase 4a should be completed first (it's now much simpler)
- The frontend will work with or without 4a, but 4a prevents context overflow issues

### Risk Mitigation

- **Tool search beta**: Feature is in beta but stable; we can fall back to custom search if needed
- **SSE parsing edge cases**: Use proven patterns, handle partial chunks
- **Clerk static export**: Well-documented, but test early
- **Mobile responsiveness**: Build mobile-first with Tailwind

---

## Appendix: Key Documentation References

### Official Anthropic Docs

1. **Tool Search Tool** (beta)
   - URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
   - Key features:
     - `defer_loading: true` - mark tools for on-demand loading
     - `tool_search_tool_bm25_20251119` - natural language search
     - `tool_search_tool_regex_20251119` - regex pattern search
     - Beta header: `advanced-tool-use-2025-11-20`
     - Returns 3-5 most relevant tools per search
     - Max 10,000 tools supported

2. **Implement Tool Use**
   - URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use
   - Key features:
     - Tool Runner (beta) - SDK helper for automatic tool handling
     - `input_examples` - provide example inputs for complex tools
       - **⚠️ NOT COMPATIBLE with tool search** - cannot use both in same request
     - Parallel tool use - Claude can call multiple tools simultaneously
     - `disable_parallel_tool_use` - control parallel behavior

### Code Patterns from Docs

**Tool with defer_loading:**
```ts
{
  name: "get_weather",
  description: "Get weather for a location",
  input_schema: { ... },
  defer_loading: true  // Only loaded when discovered via search
}
```

**Tool search tool definition:**
```ts
{
  type: "tool_search_tool_bm25_20251119",
  name: "tool_search"
}
```

**Beta API call:**
```ts
const response = await anthropic.beta.messages.create({
  model: "claude-sonnet-4-5-20250929",
  betas: ["advanced-tool-use-2025-11-20"],
  tools: [toolSearchTool, ...deferredTools],
  messages: [...]
});
```

**Custom tool search result (alternative):**
```ts
{
  type: "tool_result",
  tool_use_id: "toolu_xxx",
  content: [
    { type: "tool_reference", tool_name: "tool_name_here" }
  ]
}
```

---

### Always-Loaded Tools Reference

**Exact Tool IDs (verified from MCP server implementations):**

```ts
const ALWAYS_LOADED_TOOLS = [
  // ID-Bridge Core (8 tools)
  'ensembl__search_genes',             // Gene symbol → ENSG
  'open-targets__search_entities',     // Gene/disease → ENSG/EFO
  'uniprot__search_by_gene',           // Gene → UniProt accession
  'uniprot__get_external_references',  // UniProt cross-refs
  'ensembl__get_xrefs',                // Ensembl cross-refs
  'chembl__search_compounds',          // Compound name → ChEMBL ID
  'pubchem__search_by_smiles',         // SMILES → PubChem CID
  'clinvar__lookup_by_rsid',           // rsID → clinical context
  
  // Evidence Hubs (3 tools)
  'pubmed__search_pubmed',             // Literature search
  'clinical-trials__search_by_intervention',  // Drug → trials
  'clinical-trials__search_by_condition',     // Condition → trials
];
```

**Rationale (from PLATFORM_OVERVIEW_AND_CONNECTIONS.md):**

| Database | Role | Why Always-Loaded |
|----------|------|-------------------|
| **Open Targets** | Most connected hub (24+ connections) | Central integrator |
| **UniProt** | Protein data hub (9 connections) | Gene → Protein bridge |
| **Ensembl** | Genomic foundation (8 connections) | ENSG IDs used everywhere |
| **ChEMBL** | Compound-target hub (8 connections) | Drug ↔ Target mapping |
| **PubChem** | Chemical structure hub | ChEMBL ↔ PubChem via SMILES |
| **ClinVar** | Variant bridge | rsID → Gene + clinical |
| **PubMed** | Literature hub | Evidence base |
| **ClinicalTrials** | Trial evidence | Clinical validation |

**ID Mapping Chains Enabled:**

```
Gene Symbol → ensembl__search_genes → ENSG
                                       ↓
                    open-targets__search_entities (disease associations)
                    uniprot__search_by_gene → UniProt accession
                                               ↓
                              ensembl__get_xrefs (bidirectional)
                              chembl__search_compounds → ChEMBL ID
                                                          ↓
                                        pubchem__search_by_smiles → CID

rsID → clinvar__lookup_by_rsid → Gene + Clinical Significance

Drug → clinical-trials__search_by_intervention → NCT IDs
Condition → clinical-trials__search_by_condition → NCT IDs
```

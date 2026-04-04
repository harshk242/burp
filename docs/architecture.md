# BURP Architecture Diagrams

> **Bio Unified Research Platform** — A conversational AI agent for querying 10 biomedical databases via natural language.

---

## 1. System Context Diagram (30,000 ft view)

```
                                    +-------------------+
                                    |   Researcher /    |
                                    |   End User        |
                                    +--------+----------+
                                             |
                                             | HTTPS (JWT via Clerk)
                                             v
                                    +-------------------+
                                    |                   |
                                    |   BURP Platform   |
                                    |   (tryburp.com)   |
                                    |                   |
                                    +--------+----------+
                                             |
                    +------------------------+------------------------+
                    |                        |                        |
                    v                        v                        v
           +----------------+     +-------------------+     +------------------+
           | LLM Providers  |     | 10 Biomedical     |     | Auth Provider    |
           | - Anthropic    |     | Database APIs     |     | (Clerk)          |
           | - Google       |     | (see Section 2)   |     +------------------+
           +----------------+     +-------------------+
```

**Key Actors:**
- **Researcher**: Asks biomedical questions in natural language
- **BURP Platform**: Orchestrates LLM + database tools to answer
- **LLM Providers**: Anthropic (Claude) / Google (Gemini) for reasoning
- **Biomedical APIs**: External databases queried via MCP tools
- **Clerk**: Authentication & user management (JWT-based)

---

## 2. External Biomedical Databases

```
+----------------------------------------------------------------------+
|                    10 Biomedical Database Integrations                |
+----------------------------------------------------------------------+
|                                                                      |
|  +------------+  +------------+  +------------+  +------------+      |
|  | Ensembl    |  | Open       |  | ChEMBL     |  | PubChem    |      |
|  | (Genomics, |  | Targets    |  | (Drugs,    |  | (Chemical  |      |
|  |  Genes,    |  | (Drug-     |  |  Bioactiv- |  |  Structures|      |
|  |  Variants) |  |  Target    |  |  ity,      |  |  & Props)  |      |
|  +------------+  |  Assoc.)   |  |  Pharma)   |  +------------+      |
|                  +------------+  +------------+                      |
|  +------------+  +------------+  +------------+  +------------+      |
|  | ClinVar    |  | Reactome   |  | Clinical   |  | PubMed     |      |
|  | (Clinical  |  | (Biolog.   |  | Trials.gov |  | (Biomedical|      |
|  |  Variant   |  |  Pathways  |  | (Trial     |  |  Literature|      |
|  |  Interp.)  |  |  & React.) |  |  Registry) |  |  & Abstr.) |      |
|  +------------+  +------------+  +------------+  +------------+      |
|                                                                      |
|  +------------+  +------------+                                      |
|  | ClinPGx    |  | UniProt    |                                      |
|  | (Pharmaco- |  | (Protein   |                                      |
|  |  genomics) |  |  Sequences |                                      |
|  +------------+  |  & Annot.) |                                      |
|                  +------------+                                      |
+----------------------------------------------------------------------+

Total: ~210+ MCP tools across 10 platforms
```

---

## 3. Deployment Architecture

```
+---------------------------+         +---------------------------+
|       Fly.io Cloud        |         |    External Services      |
|  Region: iad (US East)    |         |                           |
|                           |         |  +---------------------+  |
|  +---------------------+  |         |  | Clerk (Auth)        |  |
|  | VM: shared-cpu-4x   |  |         |  | - JWT Verification  |  |
|  | Memory: 4GB          |  |         |  | - User Management   |  |
|  |                      |  |  HTTPS  |  +---------------------+  |
|  |  +----------------+  |  |<------->|                           |
|  |  | Docker         |  |  |         |  +---------------------+  |
|  |  | (oven/bun:1.1) |  |  |         |  | Anthropic API       |  |
|  |  |                |  |  |         |  | - Claude Haiku 4.5  |  |
|  |  | Port 3000      |  |  |         |  +---------------------+  |
|  |  |                |  |  |         |                           |
|  |  | /public (Next  |  |  |         |  +---------------------+  |
|  |  |  static export)|  |  |         |  | Google AI API       |  |
|  |  | /api (Hono)    |  |  |         |  | - Gemini (optional) |  |
|  |  | /mcp-server    |  |  |         |  | - Embeddings        |  |
|  |  +----------------+  |  |         |  +---------------------+  |
|  |                      |  |         |                           |
|  |  +----------------+  |  |         |  +---------------------+  |
|  |  | Persistent Vol |  |  |         |  | 10x Biomedical      |  |
|  |  | /app/data (1GB)|  |  |         |  | Database REST APIs  |  |
|  |  | - app.db       |  |  |         |  +---------------------+  |
|  |  |   (SQLite+WAL) |  |  |         +---------------------------+
|  |  +----------------+  |  |
|  +---------------------+  |
+---------------------------+

Health check: GET /health (every 30s)
Auto-scaling: min 1 machine, auto-start enabled
```

**Docker Multi-Stage Build:**
```
Stage 1 (mcp-build)     : Compile MCP TypeScript → dist/
Stage 2 (web-build)     : Next.js static export → out/
Stage 3 (server-build)  : Copy Hono server + deps
Stage 4 (runner)         : Combine all into final image
                           CMD: bun run server/index.ts
```

---

## 4. Application Architecture (Monolith Internals)

```
+==============================================================================+
||                          BURP Application (Single Process)                  ||
||                                                                            ||
||  +----------------------------------------------------------------------+  ||
||  |                        Hono HTTP Server (:3000)                      |  ||
||  |                                                                      |  ||
||  |   Middleware Chain:                                                   |  ||
||  |   ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌─────────────────┐    |  ||
||  |   │ CORS     │→ │ Request  │→ │ Clerk JWT │→ │ Rate Limit      │    |  ||
||  |   │          │  │ Logger   │  │ Auth      │  │ (Query+Token)   │    |  ||
||  |   └──────────┘  └──────────┘  └───────────┘  └─────────────────┘    |  ||
||  |                                                                      |  ||
||  |   Routes:                                                            |  ||
||  |   ┌─────────────────────────────────────────────────────────────┐    |  ||
||  |   │ GET  /health              → Server + MCP status            │    |  ||
||  |   │ POST /api/chat            → SSE streaming chat             │    |  ||
||  |   │ GET  /api/sessions        → List user sessions             │    |  ||
||  |   │ GET  /api/tools           → Browse MCP tools               │    |  ||
||  |   │ POST /api/users/sync      → Clerk → DB user sync           │    |  ||
||  |   │ POST /api/waitlist        → Access request submission      │    |  ||
||  |   │ GET  /api/usage           → User usage stats               │    |  ||
||  |   │ *    /api/admin/*         → Admin panel endpoints          │    |  ||
||  |   │ GET  /api/swagger         → OpenAPI Swagger UI             │    |  ||
||  |   │ *    /*                   → Static files (Next.js export)  │    |  ||
||  |   └─────────────────────────────────────────────────────────────┘    |  ||
||  +----------------------------------------------------------------------+  ||
||                                                                            ||
||  +----------------------------------------------------------------------+  ||
||  |                     Chat Orchestration Engine                        |  ||
||  |                     (chat-v2.ts — core brain)                        |  ||
||  |                                                                      |  ||
||  |   ┌─────────────────────────────────────────────────────────────┐    |  ||
||  |   │                    processChat() Loop                      │    |  ||
||  |   │                                                            │    |  ||
||  |   │  1. Load history from DB                                   │    |  ||
||  |   │  2. Build initial tool set (core + search tool)            │    |  ||
||  |   │  3. streamText() → LLM (via Vercel AI SDK)                 │    |  ||
||  |   │  4. Stream text chunks → SSE                               │    |  ||
||  |   │  5. If tool_calls:                                         │    |  ||
||  |   │     a. System tools → local execution                      │    |  ||
||  |   │     b. MCP tools → mcpManager.callTool()                   │    |  ||
||  |   │     c. Large output → noise reduction → artifact store     │    |  ||
||  |   │     d. Append tool results → loop back to step 3           │    |  ||
||  |   │  6. Store messages + update usage → SQLite                 │    |  ||
||  |   └─────────────────────────────────────────────────────────────┘    |  ||
||  +----------------------------------------------------------------------+  ||
||                                                                            ||
||  +----------------------------+  +--------------------------------------+  ||
||  |    LLM Provider Layer      |  |       MCP Subsystem                  |  ||
||  |                            |  |                                      |  ||
||  |  Vercel AI SDK             |  |  ┌──────────────┐                    |  ||
||  |  ┌──────────────────────┐  |  |  │ MCPManager   │ (singleton)        |  ||
||  |  │ getChatModel()       │  |  |  │ - register   │                    |  ||
||  |  │ getTitleModel()      │  |  |  │ - start/stop │                    |  ||
||  |  │ getEmbeddingModel()  │  |  |  │ - callTool   │                    |  ||
||  |  └──────────────────────┘  |  |  │ - retry loop │                    |  ||
||  |                            |  |  └──────┬───────┘                    |  ||
||  |  Providers:                |  |         │ stdio                      |  ||
||  |  ┌────────┐ ┌────────┐    |  |         v                            |  ||
||  |  │Anthropic│ │ Google │    |  |  ┌──────────────┐                    |  ||
||  |  │ (chat)  │ │(embed) │    |  |  │ Unified MCP  │ (child process)   |  ||
||  |  └────────┘ └────────┘    |  |  │ Server       │                    |  ||
||  +----------------------------+  |  │ (Node.js)    │                    |  ||
||                                  |  └──────────────┘                    |  ||
||  +----------------------------+  |                                      |  ||
||  |    Tool Search Engine      |  |  ┌──────────────┐                    |  ||
||  |                            |  |  │ ToolRegistry │ (singleton)        |  ||
||  |  Hybrid Search (RRF):     |  |  │ - discover   │                    |  ||
||  |  ┌─────────┐ ┌──────────┐ |  |  │ - lookup     │                    |  ||
||  |  │ BM25    │ │ Semantic │ |  |  │ - Vercel fmt │                    |  ||
||  |  │ (FTS5)  │ │(Embeddings)│|  |  └──────────────┘                    |  ||
||  |  └─────────┘ └──────────┘ |  +--------------------------------------+  ||
||  |        ↓ RRF Fusion ↓     |                                            ||
||  |   Top-K tool results      |  +--------------------------------------+  ||
||  +----------------------------+  |       Data Layer (SQLite + WAL)      |  ||
||                                  |                                      |  ||
||                                  |  Tables: users, access_requests,     |  ||
||                                  |  chat_sessions, messages,            |  ||
||                                  |  daily_usage, rate_limits,           |  ||
||                                  |  tool_search_fts (FTS5 virtual)      |  ||
||                                  +--------------------------------------+  ||
+==============================================================================+
```

---

## 5. Request Flow: Chat Message (End-to-End)

```
User                  Frontend            Hono Server           Orchestration         MCP Manager          Unified MCP Server       External API
 |                      |                     |                     |                     |                     |                     |
 |  Type question       |                     |                     |                     |                     |                     |
 |--------------------->|                     |                     |                     |                     |                     |
 |                      |  POST /api/chat     |                     |                     |                     |                     |
 |                      |  (JWT + sessionId   |                     |                     |                     |                     |
 |                      |   + message)        |                     |                     |                     |                     |
 |                      |-------------------->|                     |                     |                     |                     |
 |                      |                     |  Middleware:         |                     |                     |                     |
 |                      |                     |  1. CORS            |                     |                     |                     |
 |                      |                     |  2. Request Logger  |                     |                     |                     |
 |                      |                     |  3. Clerk JWT verify|                     |                     |                     |
 |                      |                     |  4. Rate limit check|                     |                     |                     |
 |                      |                     |        |            |                     |                     |                     |
 |                      |                     |  processChat()      |                     |                     |                     |
 |                      |                     |-------------------->|                     |                     |                     |
 |                      |                     |                     |  Load history (DB)  |                     |                     |
 |                      |                     |                     |  Build tool set     |                     |                     |
 |                      |                     |                     |  (core + search)    |                     |                     |
 |                      |                     |                     |                     |                     |                     |
 |                      |                     |                     |  streamText() ------+----> Anthropic/Google API                  |
 |                      |                     |                     |                     |                     |                     |
 |                      |  SSE: event=text    |                     |  <--- text chunks   |                     |                     |
 |  <---streaming text--|<--------------------|<--------------------|                     |                     |                     |
 |                      |                     |                     |                     |                     |                     |
 |                      |                     |                     |  <--- tool_calls    |                     |                     |
 |                      |  SSE: tool_start    |                     |                     |                     |                     |
 |  <---tool indicator--|<--------------------|<--------------------|                     |                     |                     |
 |                      |                     |                     |                     |                     |                     |
 |                      |                     |                     |  callTool(name,args)|                     |                     |
 |                      |                     |                     |-------------------->|                     |                     |
 |                      |                     |                     |                     |  stdio JSON-RPC     |                     |
 |                      |                     |                     |                     |-------------------->|                     |
 |                      |                     |                     |                     |                     |  HTTP REST call     |
 |                      |                     |                     |                     |                     |-------------------->|
 |                      |                     |                     |                     |                     |  <--- JSON response |
 |                      |                     |                     |                     |                     |<--------------------|
 |                      |                     |                     |                     |  <--- tool result   |                     |
 |                      |                     |                     |  <--- result        |<--------------------|                     |
 |                      |                     |                     |                     |                     |                     |
 |                      |                     |                     |  handleLargeOutput()|                     |                     |
 |                      |                     |                     |  (noise reduce /    |                     |                     |
 |                      |                     |                     |   artifact store)   |                     |                     |
 |                      |                     |                     |                     |                     |                     |
 |                      |  SSE: tool_end      |                     |                     |                     |                     |
 |  <---tool result-----|<--------------------|<--------------------|                     |                     |                     |
 |                      |                     |                     |                     |                     |                     |
 |                      |                     |                     |  Loop: more tool    |                     |                     |
 |                      |                     |                     |  calls or final text|                     |                     |
 |                      |                     |                     |                     |                     |                     |
 |                      |  SSE: event=done    |                     |  Store to DB        |                     |                     |
 |  <---done------------|<--------------------|<--------------------|  (messages, usage)  |                     |                     |
 |                      |                     |                     |                     |                     |                     |
 |                      |  SSE: event=usage   |                     |                     |                     |                     |
 |  <---token counts----|<--------------------|<--------------------|                     |                     |                     |
 |                      |                     |                     |                     |                     |                     |
 |                      |  SSE: event=title   |                     |                     |                     |                     |
 |  <---session title---|<--------------------|  (parallel LLM call)|                     |                     |                     |
```

---

## 6. MCP Server Architecture

```
+===========================================================================+
||                    Unified MCP Server (Node.js child process)            ||
||                    Transport: stdio (JSON-RPC via MCP SDK)               ||
||                                                                         ||
||  ┌───────────────────────────────────────────────────────────────────┐   ||
||  │                        server.ts                                 │   ||
||  │                                                                  │   ||
||  │  ┌─────────────────────┐    ┌──────────────────────────────┐     │   ||
||  │  │ ListToolsHandler    │    │ CallToolHandler              │     │   ||
||  │  │ Returns all tools   │    │ 1. Lookup handler by name    │     │   ||
||  │  │ (prefixed:           │    │ 2. Execute handler(args)     │     │   ||
||  │  │  "ensembl__search_  │    │ 3. Serialize JSON result     │     │   ||
||  │  │   genes", etc.)     │    │ 4. Size guard (5MB hard cap) │     │   ||
||  │  └─────────────────────┘    └──────────────────────────────┘     │   ||
||  └───────────────────────────────────────────────────────────────────┘   ||
||                                                                         ||
||  ┌───────────────────────────────────────────────────────────────────┐   ||
||  │                   Platform Module System                         │   ||
||  │                                                                  │   ||
||  │  Each platform implements PlatformModule:                        │   ||
||  │  { name, tools[], handlers{}, init(env), cleanup() }            │   ||
||  │                                                                  │   ||
||  │  ┌──────────────────────────────────────────────────────────┐    │   ||
||  │  │ Platform: ensembl                                       │    │   ||
||  │  │  client.ts  ─── HTTP client (REST API)                  │    │   ||
||  │  │  tools/                                                 │    │   ||
||  │  │   ├── genes.ts          (search_genes, lookup_gene)     │    │   ||
||  │  │   ├── sequences.ts      (get_sequence, get_cds_sequence)│    │   ||
||  │  │   ├── variants.ts       (get_variants, get_var_conseq)  │    │   ||
||  │  │   ├── comparative.ts    (get_homologs, get_gene_tree)   │    │   ||
||  │  │   ├── annotations.ts    (get_xrefs, batch_gene_lookup)  │    │   ||
||  │  │   ├── regulatory.ts     (get_regulatory_features, etc.) │    │   ||
||  │  │   └── species.ts        (list_species, get_assembly)    │    │   ||
||  │  └──────────────────────────────────────────────────────────┘    │   ||
||  │                                                                  │   ||
||  │  Same pattern for all 10 platforms:                              │   ||
||  │  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │   ||
||  │  │open-targets│ │  chembl  │ │ pubchem  │ │clinical-trials   │  │   ||
||  │  │ (GraphQL)  │ │ (REST)   │ │ (REST)   │ │ (REST)           │  │   ||
||  │  └────────────┘ └──────────┘ └──────────┘ └──────────────────┘  │   ||
||  │  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │   ||
||  │  │  reactome  │ │  pubmed  │ │ clinvar  │ │    clinpgx       │  │   ||
||  │  │ (REST)     │ │(NCBI XML)│ │(NCBI XML)│ │ (PharmGKB REST)  │  │   ||
||  │  └────────────┘ └──────────┘ └──────────┘ └──────────────────┘  │   ||
||  │  ┌────────────┐                                                  │   ||
||  │  │  uniprot   │                                                  │   ||
||  │  │ (REST)     │                                                  │   ||
||  │  └────────────┘                                                  │   ||
||  └───────────────────────────────────────────────────────────────────┘   ||
||                                                                         ||
||  ┌───────────────────────────────────────────────────────────────────┐   ||
||  │                     Shared Infrastructure                        │   ||
||  │  ┌──────────────────┐  ┌──────────────────────────────────────┐  │   ||
||  │  │ Rate Limiter     │  │ Exception Handling                   │  │   ||
||  │  │ (Token Bucket)   │  │ (Structured error responses)         │  │   ||
||  │  │ NCBI: 3-10 rps   │  │                                      │  │   ||
||  │  └──────────────────┘  └──────────────────────────────────────┘  │   ||
||  └───────────────────────────────────────────────────────────────────┘   ||
+===========================================================================+
```

---

## 7. Tool Discovery & Dynamic Loading

```
                         STARTUP FLOW
                         ============

  ┌─────────────┐    register()     ┌──────────────┐
  │ platforms    │ ───────────────>  │  MCPManager   │
  │ .config.ts  │  (config from     │  (singleton)  │
  │             │   config.yaml)    └──────┬───────┘
  └─────────────┘                          │
                                           │ startAll()
                                           v
                                    ┌──────────────┐
                                    │ Spawn child   │
                                    │ process (node)│
                                    │ → unified MCP │
                                    │   server      │
                                    └──────┬───────┘
                                           │
                                           │ listTools() via MCP SDK
                                           v
                                    ┌──────────────┐
                                    │ ToolRegistry  │  210+ tools
                                    │ (singleton)   │  registered
                                    └──────┬───────┘
                                           │
                                           │ Index for search
                                           v
                              ┌─────────────────────────────┐
                              │     Hybrid Search Engine     │
                              │                             │
                              │  SQLite FTS5 ─── BM25 index │
                              │  Embeddings ─── Cosine sim  │
                              │        (Gemini embed)       │
                              │                             │
                              │  Fusion: RRF (Reciprocal    │
                              │  Rank Fusion)               │
                              └─────────────────────────────┘


                         RUNTIME TOOL LOADING
                         ====================

  ┌──────────────────────────────────────────────────────────────┐
  │                   Tool Loading Strategy                      │
  │                                                              │
  │  Tier 1: "Always-Loaded" Core Tools (~12 tools)             │
  │  ──────────────────────────────────────────────              │
  │  Configured in config.yaml per platform:                     │
  │  - ensembl: search_genes, get_xrefs                         │
  │  - open-targets: search_entities                             │
  │  - chembl: search_compounds                                  │
  │  - pubchem: search_by_smiles                                 │
  │  - clinvar: lookup_by_rsid                                   │
  │  - pubmed: search_pubmed                                     │
  │  - clinicaltrials: search_by_intervention, search_by_cond.   │
  │                                                              │
  │  These are always in the LLM context. The LLM can call them │
  │  without searching first.                                    │
  │                                                              │
  │  Tier 2: Discoverable Tools (~200 tools)                    │
  │  ─────────────────────────────────────────                   │
  │  Not in initial context. LLM calls:                          │
  │    system__search_available_tools(query)                      │
  │  Hybrid search returns top matches.                          │
  │  Matched tools are dynamically injected into activeTools     │
  │  for the rest of the conversation turn.                      │
  │                                                              │
  │  This keeps the LLM context small (~12 tool schemas)         │
  │  while 210+ tools remain discoverable.                       │
  └──────────────────────────────────────────────────────────────┘
```

---

## 8. Large Output Handling Pipeline (3-Layer)

```
  External API Response (can be 10MB+)
           │
           ▼
  ╔════════════════════════════════════════════════════╗
  ║  Layer 1: MCP Server Hard Cap (5MB)               ║
  ║  Location: mcp-server/src/server.ts               ║
  ║                                                    ║
  ║  Purpose: Prevent child process death / stdio      ║
  ║           pressure from pathological responses     ║
  ║                                                    ║
  ║  Action: If > 5MB → return structured error        ║
  ║          (no silent truncation)                     ║
  ╚═══════════════════════════╤════════════════════════╝
                              │ (≤ 5MB)
                              ▼
  ╔════════════════════════════════════════════════════╗
  ║  Layer 2: App Manager Cap (1MB)                   ║
  ║  Location: app/server/mcp/manager.ts              ║
  ║                                                    ║
  ║  Purpose: Prevent LLM context blow-up             ║
  ║           (measured in real bytes)                  ║
  ║                                                    ║
  ║  Action: If > 1MB → return error asking user to   ║
  ║          narrow query (no truncation)              ║
  ╚═══════════════════════════╤════════════════════════╝
                              │ (≤ 1MB)
                              ▼
  ╔════════════════════════════════════════════════════╗
  ║  Layer 3: Noise Reduction + Artifact (15K chars)  ║
  ║  Location: orchestration/chat-v2.ts               ║
  ║                                                    ║
  ║  If ≤ 15K chars → pass through unchanged          ║
  ║                                                    ║
  ║  If > 15K chars:                                   ║
  ║  ┌─────────────────────────────────────────────┐   ║
  ║  │ Tier 1: Deterministic Noise Reduction       │   ║
  ║  │ - 3-layer jq policy: global → platform →    │   ║
  ║  │   tool                                      │   ║
  ║  │ - del(.. | nulls)                           │   ║
  ║  │ - Platform-specific filters (e.g. strip     │   ║
  ║  │   sequence.value from UniProt)              │   ║
  ║  │                                              │   ║
  ║  │ If reduced ≤ 15K → return inline            │   ║
  ║  └──────────────────────┬──────────────────────┘   ║
  ║                         │ (still > 15K)            ║
  ║  ┌──────────────────────▼──────────────────────┐   ║
  ║  │ Tier 2: Artifact Store + Schema Preview     │   ║
  ║  │ - Store in memory (TTL 5min, LRU eviction)  │   ║
  ║  │ - Return schema preview to LLM              │   ║
  ║  │ - Inject inspect_artifact tool              │   ║
  ║  │ - LLM writes jq queries to extract data     │   ║
  ║  └─────────────────────────────────────────────┘   ║
  ╚════════════════════════════════════════════════════╝
```

---

## 9. Frontend Architecture

```
+===========================================================================+
||                    Frontend (Next.js 14 — Static Export)                 ||
||                    UI: Tailwind CSS + Radix UI + shadcn/ui              ||
||                    State: Zustand (4 stores)                            ||
||                    Auth: Clerk React SDK                                ||
||                                                                         ||
||  ┌───────────────────────────────────────────────────────────────────┐   ||
||  │                         App Router                               │   ||
||  │                                                                  │   ||
||  │  app/                                                            │   ||
||  │  ├── layout.tsx              (Root layout + ClerkProvider)        │   ||
||  │  ├── page.tsx                (Landing / redirect)                │   ||
||  │  ├── request-access/         (Waitlist signup form)              │   ||
||  │  ├── (auth)/                                                     │   ||
||  │  │   ├── sign-in/page.tsx    (Clerk sign-in)                     │   ||
||  │  │   └── sign-up/page.tsx    (Clerk sign-up)                     │   ||
||  │  └── (protected)/            (Requires auth)                     │   ||
||  │      ├── layout.tsx          (Sidebar + Header wrapper)          │   ||
||  │      ├── chat/[[...sessionId]]/                                  │   ||
||  │      │   ├── page.tsx        (Server component shell)            │   ||
||  │      │   └── client.tsx      (Chat client component)             │   ||
||  │      ├── tools/page.tsx      (Tool browser)                      │   ||
||  │      └── admin/                                                  │   ||
||  │          ├── page.tsx        (Admin dashboard)                    │   ||
||  │          └── client.tsx      (Admin client component)            │   ||
||  └───────────────────────────────────────────────────────────────────┘   ||
||                                                                         ||
||  ┌─────────────────────────────────────────────────┐                    ||
||  │              Zustand State Stores                │                    ||
||  │                                                 │                    ||
||  │  ┌─────────────┐  ┌──────────────┐              │                    ||
||  │  │ chatStore   │  │ sessionStore │              │                    ||
||  │  │ - messages  │  │ - sessions   │              │                    ||
||  │  │ - streaming │  │ - activeId   │              │                    ||
||  │  │ - toolCalls │  │ - CRUD ops   │              │                    ||
||  │  │ - error     │  └──────────────┘              │                    ||
||  │  └─────────────┘                                │                    ||
||  │  ┌─────────────┐  ┌──────────────┐              │                    ||
||  │  │ toolStore   │  │ userStore    │              │                    ||
||  │  │ - allTools  │  │ - profile    │              │                    ||
||  │  │ - search    │  │ - role       │              │                    ||
||  │  └─────────────┘  │ - usage      │              │                    ||
||  │                    └──────────────┘              │                    ||
||  └─────────────────────────────────────────────────┘                    ||
||                                                                         ||
||  ┌─────────────────────────────────────────────────┐                    ||
||  │              Key Components                     │                    ||
||  │                                                 │                    ||
||  │  chat/                                          │                    ||
||  │  ├── ChatContainer.tsx   (Main chat view)       │                    ||
||  │  ├── MessageList.tsx     (Scrollable messages)  │                    ||
||  │  ├── MessageBubble.tsx   (User/assistant msg)   │                    ||
||  │  ├── MessageInput.tsx    (Text input + send)    │                    ||
||  │  ├── StreamingText.tsx   (Live typing effect)   │                    ||
||  │  ├── ToolCallCard.tsx    (Tool execution card)  │                    ||
||  │  └── ToolCallGroup.tsx   (Grouped tool calls)   │                    ||
||  │                                                 │                    ||
||  │  layout/                                        │                    ||
||  │  ├── Header.tsx          (Top bar)              │                    ||
||  │  └── Sidebar.tsx         (Session list)         │                    ||
||  │                                                 │                    ||
||  │  shared/                                        │                    ||
||  │  ├── EmptyState.tsx      (No messages yet)      │                    ||
||  │  ├── LoadingSpinner.tsx                         │                    ||
||  │  └── UsageIndicator.tsx  (Token/query counters) │                    ||
||  │                                                 │                    ||
||  │  tools/                                         │                    ||
||  │  ├── DatabaseGroup.tsx   (Platform grouping)    │                    ||
||  │  └── ToolCard.tsx        (Individual tool info) │                    ||
||  └─────────────────────────────────────────────────┘                    ||
||                                                                         ||
||  ┌─────────────────────────────────────────────────┐                    ||
||  │              Data Flow: SSE Client              │                    ||
||  │                                                 │                    ||
||  │  lib/sse.ts — streamChat()                      │                    ||
||  │  1. POST /api/chat with Bearer JWT              │                    ||
||  │  2. Read SSE stream via ReadableStream          │                    ||
||  │  3. Parse events: start, text, tool_start,      │                    ||
||  │     tool_end, done, usage, title, error         │                    ||
||  │  4. Dispatch to chatStore actions               │                    ||
||  │                                                 │                    ||
||  │  hooks/useApi.ts — authenticated fetch wrapper  │                    ||
||  │  hooks/useUsage.ts — usage/rate limit display   │                    ||
||  └─────────────────────────────────────────────────┘                    ||
+===========================================================================+
```

---

## 10. Data Model (SQLite Schema)

```
  ┌─────────────────────┐         ┌─────────────────────────┐
  │       users          │         │    access_requests       │
  ├─────────────────────┤         ├─────────────────────────┤
  │ id          TEXT PK  │◄───┐   │ id           TEXT PK     │
  │ clerk_id    TEXT UQ  │    │   │ email        TEXT UQ     │
  │ email       TEXT UQ  │    │   │ name         TEXT        │
  │ name        TEXT     │    │   │ institution  TEXT        │
  │ image_url   TEXT     │    │   │ research_area TEXT       │
  │ role        TEXT     │    │   │ use_case     TEXT        │
  │  (waitlist|user|     │    │   │ status       TEXT        │
  │   admin)             │    │   │  (pending|approved|      │
  │ institution TEXT     │    │   │   rejected)              │
  │ research_area TEXT   │    └───│ reviewed_by  TEXT FK     │
  │ total_queries INT    │        │ submitted_at INT         │
  │ daily_query_limit INT│        │ reviewed_at  INT         │
  │ daily_token_limit INT│        └─────────────────────────┘
  │ created_at   INT     │
  │ last_active_at INT   │
  └──────────┬──────────┘
             │
             │ 1:N
             ▼
  ┌─────────────────────┐         ┌─────────────────────────┐
  │   chat_sessions      │         │      daily_usage         │
  ├─────────────────────┤         ├─────────────────────────┤
  │ id        TEXT PK    │         │ id            INT PK AI  │
  │ user_id   TEXT FK ───┼────┐   │ user_id       TEXT FK ───┼──► users.id
  │ title     TEXT       │    │   │ date          TEXT        │
  │ created_at INT       │    │   │ query_count   INT         │
  │ updated_at INT       │    │   │ input_tokens  INT         │
  └──────────┬──────────┘    │   │ output_tokens INT         │
             │                │   │ created_at    INT         │
             │ 1:N            │   │ UNIQUE(user_id, date)     │
             ▼                │   └─────────────────────────┘
  ┌─────────────────────┐    │
  │      messages        │    │   ┌─────────────────────────┐
  ├─────────────────────┤    │   │     rate_limits           │
  │ id        TEXT PK    │    │   ├─────────────────────────┤
  │ chat_id   TEXT FK ───┼──┐ │   │ role        TEXT PK      │
  │ role      TEXT       │  │ │   │  (user|admin)            │
  │  (user|assistant)    │  │ │   │ daily_limit INT          │
  │ content   TEXT       │  │ │   │ updated_at  INT          │
  │ tool_calls TEXT(JSON)│  │ │   └─────────────────────────┘
  │ input_tokens  INT    │  │ │
  │ output_tokens INT    │  │ │   ┌─────────────────────────┐
  │ created_at INT       │  │ │   │  tool_search_fts (FTS5)  │
  └─────────────────────┘  │ │   ├─────────────────────────┤
                            │ │   │ full_name    TEXT        │
             CASCADE DELETE─┘ │   │ server       TEXT        │
                              │   │ tool_name    TEXT        │
             CASCADE DELETE───┘   │ description  TEXT        │
                                  │ tokenize: porter+unicode │
                                  └─────────────────────────┘
```

---

## 11. Authentication & Authorization Flow

```
  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ Anonymous│     │ Waitlist │     │   User   │     │  Admin   │
  └────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
       │                │                │                │
       │ Sign up        │                │                │
       │ via Clerk      │                │                │
       ├───────────────>│                │                │
       │                │                │                │
       │                │ POST /api/     │                │
       │                │ waitlist       │                │
       │                │ (request       │                │
       │                │  access)       │                │
       │                │                │                │
       │                │                │  Admin reviews │
       │                │                │<───────────────┤
       │                │                │  approve/reject│
       │                │                │                │
       │                │  On next login │                │
       │                │  syncUser()    │                │
       │                │  auto-promotes │                │
       │                ├───────────────>│                │
       │                │                │                │
       │                │                │                │
       │  Accessible:   │  Accessible:   │  Accessible:   │  Accessible:
       │  /health       │  /api/users    │  ALL /api/*    │  ALL + /api/admin/*
       │  /api/waitlist │  /api/waitlist │  (rate limited)│  (unlimited)
       │  Static pages  │                │                │
       │                │                │                │

  Rate Limiting (for 'user' role):
  ┌─────────────────────────────────────────────────────────────┐
  │  1. Query count: 50/day (strict, atomic increment)         │
  │  2. Token budget: 200K tokens/day (best-effort)            │
  │  Priority: per-user override > role default > config       │
  │  Admin: always unlimited (-1)                               │
  │  Reset: midnight UTC                                        │
  └─────────────────────────────────────────────────────────────┘
```

---

## 12. Configuration Hierarchy

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                    Configuration System                         │
  │                                                                 │
  │  Priority (highest wins):                                       │
  │                                                                 │
  │  ┌──────────────────────────────────────────────────────┐       │
  │  │ 1. Environment Variables                             │       │
  │  │    PORT, DATABASE_URL, LLM_CHAT_MODEL, etc.          │       │
  │  │    Secrets: ANTHROPIC_API_KEY, CLERK_SECRET_KEY,      │       │
  │  │    NCBI_API_KEY, GEMINI_API_KEY                       │       │
  │  └──────────────────────────────────────────────────────┘       │
  │                          ▼ overrides                            │
  │  ┌──────────────────────────────────────────────────────┐       │
  │  │ 2. app/config.yaml                                   │       │
  │  │    - LLM provider/model selection                     │       │
  │  │    - Server settings (port, DB path, CORS)            │       │
  │  │    - Tool search tuning (BM25/semantic weights)       │       │
  │  │    - Platform enable/disable + always-loaded tools    │       │
  │  │    - Artifact config (sizes, TTL, policies)           │       │
  │  │    - Noise reduction jq filters per platform          │       │
  │  │    - Rate limits defaults                             │       │
  │  └──────────────────────────────────────────────────────┘       │
  │                          ▼ overrides                            │
  │  ┌──────────────────────────────────────────────────────┐       │
  │  │ 3. Built-in Defaults (Zod schema defaults)           │       │
  │  │    Defined in app/server/config.ts                     │       │
  │  └──────────────────────────────────────────────────────┘       │
  │                                                                 │
  │  Validated at startup via Zod schemas (AppConfigSchema)         │
  └─────────────────────────────────────────────────────────────────┘
```

---

## 13. CI/CD Pipeline

```
  ┌─────────────────────────────────────────────────────────┐
  │              GitHub Actions (test.yml)                   │
  │                                                         │
  │  Trigger: PR to main / push to main / weekly / manual   │
  │                                                         │
  │  ┌───────────────────────────────────────────────────┐  │
  │  │ Unit Tests (every PR + push)                      │  │
  │  │                                                   │  │
  │  │  1. Setup Bun + Node.js 20                        │  │
  │  │  2. bun install                                   │  │
  │  │  3. TypeScript typecheck (mcp-server)             │  │
  │  │  4. vitest run (mcp-server unit tests)            │  │
  │  │  5. bun test (app server tests)                   │  │
  │  └───────────────────────────────────────────────────┘  │
  │                                                         │
  │  ┌───────────────────────────────────────────────────┐  │
  │  │ Contract Tests (weekly Monday 06:00 UTC + manual) │  │
  │  │                                                   │  │
  │  │  Validates MCP platform integrations against      │  │
  │  │  live external APIs to detect API drift.          │  │
  │  │                                                   │  │
  │  │  1. vitest with contracts config                  │  │
  │  │  2. Uses real NCBI_API_KEY secret                 │  │
  │  │  3. On failure → upload drift report artifact     │  │
  │  └───────────────────────────────────────────────────┘  │
  │                                                         │
  │  Deployment: Fly.io (Dockerfile → shared-cpu-4x)        │
  └─────────────────────────────────────────────────────────┘
```

---

## 14. Workspace / Monorepo Structure

```
  super-bio-agent/
  │
  ├── package.json              ← Root workspace (bun workspaces)
  │   workspaces: [app, app/web, mcp-server]
  │
  ├── app/                      ← Backend workspace ("burp")
  │   ├── package.json
  │   ├── config.yaml           ← Central non-secret configuration
  │   ├── server/
  │   │   ├── index.ts          ← Hono server entrypoint
  │   │   ├── config.ts         ← Config loader (YAML + env + Zod)
  │   │   ├── logger.ts         ← Structured JSON logger
  │   │   ├── types.ts          ← Shared types (AppEnv, DB types)
  │   │   ├── schemas/          ← Zod OpenAPI schemas
  │   │   ├── db/
  │   │   │   ├── index.ts      ← SQLite (bun:sqlite) + prepared stmts
  │   │   │   ├── init.ts       ← Schema init entry
  │   │   │   └── schema.sql    ← DDL + migrations
  │   │   ├── middleware/
  │   │   │   ├── clerk.ts      ← JWT auth + user sync
  │   │   │   └── rateLimit.ts  ← Query count + token budget
  │   │   ├── routes/
  │   │   │   ├── index.ts      ← OpenAPI router + Swagger UI
  │   │   │   ├── chat.ts       ← POST /api/chat (SSE streaming)
  │   │   │   ├── sessions.ts   ← Session CRUD
  │   │   │   ├── tools.ts      ← Tool browsing
  │   │   │   ├── users.ts      ← User sync
  │   │   │   ├── waitlist.ts   ← Access requests
  │   │   │   ├── usage.ts      ← Usage stats
  │   │   │   └── admin.ts      ← Admin panel
  │   │   ├── llm/
  │   │   │   ├── config.ts     ← LLM config loader
  │   │   │   ├── provider.ts   ← Model factory (Anthropic/Google)
  │   │   │   └── tool-names.ts ← Name sanitization per provider
  │   │   ├── mcp/
  │   │   │   ├── manager.ts    ← MCP server lifecycle (stdio)
  │   │   │   ├── registry.ts   ← Tool registry + Vercel AI fmt
  │   │   │   └── platforms.config.ts ← Config.yaml → platform list
  │   │   ├── search/
  │   │   │   ├── hybrid-search.ts ← BM25 + Semantic + RRF fusion
  │   │   │   └── index.ts
  │   │   └── orchestration/
  │   │       ├── chat-v2.ts    ← Core chat loop (agentic)
  │   │       └── tools/
  │   │           ├── search-tool.ts       ← system__search_available_tools
  │   │           ├── mcp-executor.ts      ← MCP tool executor factory
  │   │           ├── artifact-store.ts    ← In-memory artifact cache
  │   │           ├── artifact-inspector.ts← inspect_artifact tool
  │   │           ├── noise-reduction.ts   ← jq noise filter runner
  │   │           ├── policy-resolver.ts   ← 3-layer policy resolver
  │   │           ├── jq-engine.ts         ← jq execution wrapper
  │   │           └── schema-preview.ts    ← Artifact preview generator
  │   └── web/                  ← Frontend workspace ("burp-web")
  │       ├── package.json
  │       ├── next.config.mjs
  │       ├── app/              ← Next.js App Router pages
  │       ├── components/       ← React components
  │       │   ├── chat/         ← Chat UI (messages, tools, input)
  │       │   ├── layout/       ← Header, Sidebar
  │       │   ├── shared/       ← Common components
  │       │   ├── tools/        ← Tool browser components
  │       │   └── ui/           ← shadcn/ui base components
  │       ├── stores/           ← Zustand state management
  │       │   ├── chatStore.ts
  │       │   ├── sessionStore.ts
  │       │   ├── toolStore.ts
  │       │   └── userStore.ts
  │       ├── hooks/            ← React hooks
  │       │   ├── useApi.ts     ← Authenticated API client
  │       │   └── useUsage.ts   ← Usage tracking
  │       ├── lib/              ← Utilities
  │       │   ├── sse.ts        ← SSE stream client
  │       │   ├── constants.ts
  │       │   └── utils.ts
  │       └── types/            ← TypeScript types
  │
  ├── mcp-server/               ← Unified MCP Server workspace ("bio-mcp-unified")
  │   ├── package.json
  │   ├── src/
  │   │   ├── index.ts          ← Entrypoint (runServer)
  │   │   ├── server.ts         ← MCP SDK server setup
  │   │   ├── types.ts          ← PlatformModule interface
  │   │   ├── shared/
  │   │   │   ├── rate-limiter.ts   ← Token bucket (NCBI APIs)
  │   │   │   └── exceptions.ts     ← Error handling
  │   │   └── platforms/        ← 10 platform modules
  │   │       ├── ensembl/      ← Ensembl REST API
  │   │       ├── open-targets/ ← Open Targets GraphQL API
  │   │       ├── chembl/       ← ChEMBL REST API
  │   │       ├── pubchem/      ← PubChem REST API
  │   │       ├── clinical-trials/ ← ClinicalTrials.gov API
  │   │       ├── reactome/     ← Reactome REST API
  │   │       ├── pubmed/       ← PubMed E-utilities (XML)
  │   │       ├── clinvar/      ← ClinVar E-utilities (XML)
  │   │       ├── clinpgx/      ← PharmGKB REST API
  │   │       └── uniprot/      ← UniProt REST API
  │   └── dist/                 ← Compiled JS output
  │
  ├── data/                     ← SQLite DB + embeddings
  │   ├── app.db
  │   └── tool-embeddings.json
  │
  ├── Dockerfile                ← Multi-stage Docker build
  ├── docker-compose.yml        ← Local Docker compose
  ├── fly.toml                  ← Fly.io deployment config
  ├── .github/workflows/test.yml ← CI pipeline
  └── .mcp.json                 ← Claude Code MCP config
```

---

## 15. Key Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Architecture** | Monolith (single process + child) | Simplicity for early-stage; easy to deploy on Fly.io |
| **Backend Runtime** | Bun | Fast startup, native SQLite, TS-first |
| **HTTP Framework** | Hono | Lightweight, middleware-friendly, OpenAPI support |
| **Frontend** | Next.js 14 (static export) | Served by Hono in production; no separate frontend server |
| **LLM Integration** | Vercel AI SDK | Provider-agnostic (Anthropic ↔ Google swap) |
| **Tool Protocol** | MCP (Model Context Protocol) | Standardized tool interface; single unified server |
| **Tool Discovery** | Hybrid Search (BM25 + Embeddings + RRF) | Keeps LLM context small while 210+ tools remain discoverable |
| **Database** | SQLite + WAL mode | Single-file, zero-ops, sufficient for current scale |
| **Auth** | Clerk (JWT) | Managed auth with waitlist/approval workflow |
| **Streaming** | Server-Sent Events (SSE) | Simpler than WebSocket for unidirectional streaming |
| **Large Output** | 3-layer pipeline (5MB → 1MB → 15K) | No silent truncation; structured degradation |
| **State Management** | Zustand (4 stores) | Minimal boilerplate, good React integration |

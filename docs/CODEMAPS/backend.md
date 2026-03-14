# Backend Codemap

**Generated:** 2026-03-13 | **Files:** 16 | **Lines:** 4,079 | **Runtime:** Bun + Hono

## Entry Point

- `app/server/index.ts` (136) — HTTP server bootstrap, CORS, MCP init, route mounting, graceful shutdown

## Architecture

```
app/server/
├── index.ts                     # Server entry: Hono on port 3000
├── logger.ts                    # Structured logging with timers & request IDs
├── orchestration/
│   └── chat.ts                  # ★ Core agentic loop (818 LOC)
├── mcp/
│   ├── manager.ts               # MCP process lifecycle (457 LOC)
│   ├── registry.ts              # Tool discovery & search (200 LOC)
│   └── platforms.config.ts      # Platform definitions & always-loaded tools
├── routes/
│   ├── index.ts                 # OpenAPI/Swagger hub
│   ├── chat.ts                  # POST /api/chat — SSE streaming
│   ├── sessions.ts              # CRUD chat sessions
│   ├── tools.ts                 # Tool listing & search
│   ├── users.ts                 # User profile management
│   └── waitlist.ts              # Access request handling
├── db/
│   ├── index.ts                 # SQLite connection & query builders
│   ├── init.ts                  # Schema initialization
│   └── schema.sql               # Table definitions
├── middleware/
│   └── clerk.ts                 # JWT validation & role enforcement
└── schemas/
    └── index.ts                 # Zod request/response schemas
```

## Key Modules

| File | Lines | Role |
|------|-------|------|
| `orchestration/chat.ts` | 818 | Agentic loop: Claude API ↔ tool calls ↔ result compression |
| `mcp/manager.ts` | 457 | Spawn/manage MCP child processes, exponential backoff recovery |
| `routes/sessions.ts` | 403 | Session CRUD with pagination and deletion |
| `routes/waitlist.ts` | 316 | Access request submission and admin review |
| `routes/tools.ts` | 295 | Tool listing, search, configuration verification |
| `middleware/clerk.ts` | 281 | Token verification, user sync, role-based guards |
| `logger.ts` | 253 | Structured logs: info/warn/error/debug + timing utilities |
| `mcp/registry.ts` | 200 | Tool discovery, always-loaded vs deferred partitioning |
| `db/index.ts` | 198 | Query builders for users, sessions, messages, access_requests |
| `routes/chat.ts` | 184 | SSE endpoint: auth → session → stream orchestration events |
| `schemas/index.ts` | 165 | Zod schemas with OpenAPI integration |

## Deep Dive: Orchestration (`chat.ts`)

The core brain of the system. Handles the multi-turn agentic loop:

```
1. Load session history from SQLite
2. Build system prompt (90 lines: database descriptions + workflow rules)
3. Send to Claude API with tool_search_tool_bm25 (natural language tool search)
4. Loop:
   a. Claude returns text → stream to client via SSE
   b. Claude returns tool_use → call mcpManager.callTool()
      → Result > 15KB? → Haiku side-call to compress
      → Add tool_result to conversation
   c. Repeat until stop_reason != "tool_use"
5. Persist final message + tool_calls JSON to SQLite
```

Key behaviors:
- **429 retry**: exponential backoff, max 3 retries, up to 60s delay
- **Title generation**: parallel Haiku call (non-blocking) on first message
- **Tool deferral**: 8 "always-loaded" ID-bridge tools; rest via BM25 search

## Deep Dive: MCP Manager (`manager.ts`)

Lifecycle manager for 10 MCP child processes:

```
initialize() → for each platform:
  spawn node process (stdio transport)
  → connect MCP client
  → discover tools via ListToolsRequest
  → register in ToolRegistry
  → if fails: exponential backoff retry (5s recovery loop)

callTool(server, tool, args):
  → validate server running
  → send CallToolRequest via stdio
  → 30s timeout
  → parse text/JSON response
```

## SSE Event Protocol

```
event: start       data: { sessionId }
event: text        data: { chunk }
event: tool_start  data: { tool, input }
event: tool_end    data: { tool, output }
event: title       data: { title }
event: done        data: { message }
event: error       data: { error }
```

## Related Areas

- [INDEX](./INDEX.md) — Full overview
- [Frontend](./frontend.md) — Consumes SSE events, renders chat UI
- [Database](./database.md) — Schema and query layer
- [Integrations](./integrations.md) — MCP servers called by manager

# Super Bio Agent — Codemap Index

**Generated:** 2026-03-13 | **Files scanned:** 81 TS/TSX | **Total lines:** ~29,300

A unified AI research platform connecting 10 biomedical databases via MCP servers, orchestrated by Claude through an agentic tool-calling loop.

## Areas

| Area | Files | Lines | Key Directories |
|------|-------|-------|-----------------|
| [Backend](./backend.md) | 16 | 4,079 | `app/server/` |
| [Frontend](./frontend.md) | 45 | 2,985 | `app/web/` |
| [Integrations](./integrations.md) | 65 | 22,257 | `mcp-servers/` |
| [Database](./database.md) | 3 | 268 | `app/server/db/` |

## Repository Structure

```
super-bio-agent/
├── app/
│   ├── server/                  # Hono backend (Bun runtime)
│   │   ├── orchestration/       #   LLM agentic loop
│   │   ├── mcp/                 #   MCP lifecycle & tool registry
│   │   ├── routes/              #   HTTP endpoints
│   │   ├── db/                  #   SQLite schema & queries
│   │   ├── middleware/          #   Clerk auth
│   │   └── schemas/             #   Zod validation
│   └── web/                     # Next.js 14 frontend
│       ├── app/                 #   App Router pages
│       ├── components/          #   React components
│       ├── stores/              #   Zustand state
│       ├── hooks/               #   Custom hooks
│       └── lib/                 #   Utilities (SSE, etc.)
├── mcp-servers/                 # 10 biomedical MCP servers
│   ├── open-targets/            #   Target-disease-drug associations
│   ├── ensembl/                 #   Genes, transcripts, sequences
│   ├── chembl/                  #   Compounds, bioactivity, drugs
│   ├── pubchem/                 #   Chemical structures, properties
│   ├── clinvar/                 #   Genetic variants, clinical significance
│   ├── clinical-trials/         #   Trial search, recruitment, outcomes
│   ├── pubmed/                  #   Literature, citations, MeSH
│   ├── reactome/                #   Pathways, reactions
│   ├── clinpgx/                 #   Pharmacogenomics, dosing
│   └── uniprot/                 #   Protein sequences, domains
├── data/                        # SQLite database (app.db)
├── docs/                        # Documentation & reports
├── .mcp.json                    # MCP server launch config
└── package.json                 # Workspace root
```

## Request Lifecycle (30-second version)

```
Browser → POST /api/chat (SSE) → Clerk auth → ChatRoom orchestration
  → Claude API (system prompt + tools) → tool_call?
    → yes: mcpManager.callTool() → MCP server (stdio) → result
           → large output? → Haiku summarization → back to Claude loop
    → no:  stream final response → persist to SQLite → SSE done event
```

## How to Regenerate

Review each area file and update manually, or re-run the exploration.

## Related Documentation

- [Frontend](./frontend.md) — UI components, pages, state, hooks
- [Backend](./backend.md) — API routes, orchestration, MCP management
- [Database](./database.md) — Schema, queries, migrations
- [Integrations](./integrations.md) — 10 MCP biomedical database servers

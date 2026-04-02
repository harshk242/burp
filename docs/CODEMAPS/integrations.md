# Integrations Codemap — MCP Servers

**Generated:** 2026-03-13 | **Files:** 65 | **Lines:** 22,257 | **Protocol:** Model Context Protocol (stdio transport)

## Overview

10 independent MCP servers, each wrapping a biomedical research API. Spawned as child processes by the backend's `mcpManager`. Communicate via stdio JSON-RPC.

## Servers at a Glance

| Server | Lines | Files | Tools | API Target |
|--------|-------|-------|-------|------------|
| `open-targets` | 4,678 | 22 | 45+ | Open Targets GraphQL |
| `pubmed` | 2,800 | 13 | 13 | NCBI E-utilities (XML) |
| `uniprot` | 2,432 | 2 | 26 | UniProt REST |
| `clinvar` | 2,260 | 11 | 12 | NCBI ClinVar (XML) |
| `clinpgx` | 2,224 | 12 | 16 | PharmGKB REST |
| `chembl` | 1,971 | 1 | 27 | ChEMBL REST |
| `clinical-trials` | 1,935 | 1 | 18 | ClinicalTrials.gov v2 |
| `ensembl` | 1,647 | 1 | 25 | Ensembl REST |
| `pubchem` | 1,237 | 1 | 24 | PubChem PUG REST |
| `reactome` | 1,073 | 1 | 8 | Reactome Content Service |

**Total:** 210+ tools across all servers

## Architecture Patterns

### Single-file servers (6 servers)
`chembl`, `clinical-trials`, `ensembl`, `pubchem`, `reactome`, `uniprot` — all logic in one `src/index.ts`. Tool definitions + handlers + API calls in a single module.

### Multi-file servers (4 servers)
`open-targets`, `pubmed`, `clinvar`, `clinpgx` — decomposed into:

```
mcp-servers/<name>/
├── src/
│   ├── index.ts          # MCP Server entry (re-exports server)
│   ├── server.ts         # Server setup, tool registration
│   ├── client.ts         # HTTP/GraphQL client wrapper
│   ├── types.ts          # TypeScript interfaces
│   ├── utils.ts          # Response formatting helpers
│   ├── exceptions.ts     # Custom error types
│   ├── rate-limiter.ts   # Request throttling (clinvar, pubmed)
│   ├── xml-parser.ts     # XML → JSON (clinvar, pubmed)
│   └── tools/
│       ├── index.ts      # Tool barrel export
│       ├── search.ts     # Search tools
│       ├── fetch.ts      # Detail-fetch tools
│       └── ...           # Domain-specific tool groups
```

### Open Targets (largest server, 4,678 LOC)

Deepest module decomposition:

```
tools/
├── index.ts              # Barrel
├── search.ts             # Entity search
├── meta.ts               # API metadata
├── disease.ts            # Disease info, phenotypes, OTAR projects
├── evidence.ts           # Target-disease evidence
├── study.ts              # GWAS studies, credible sets
├── variant.ts            # Variant info, pharmacogenomics
├── drug/
│   ├── index.ts
│   ├── identity.ts       # Drug info, cross-references
│   ├── associations.ts   # Drug-disease, drug-target links
│   └── safety.ts         # Warnings, adverse events, pharmacovigilance
└── target/
    ├── index.ts
    ├── identity.ts        # Target info, expression, tractability
    ├── biology.ts         # Pathways, GO terms, interactions
    ├── associations.ts    # Associated diseases, known drugs
    └── safety.ts          # Safety info, mouse phenotypes
```

## Always-Loaded Tools (ID Bridge Layer)

8 tools loaded into every Claude prompt (defined in `platforms.config.ts`). These serve as ID-resolution entry points so Claude can convert natural names to database-specific identifiers:

| Tool | Purpose |
|------|---------|
| `ensembl__search_genes` | Gene symbol → Ensembl Gene ID (ENSG) |
| `open-targets__search_entities` | Gene/disease name → Open Targets IDs |
| `chembl__search_compounds` | Drug name → ChEMBL ID |
| `pubchem__search_by_smiles` | SMILES structure → PubChem CID |
| `clinvar__lookup_by_rsid` | rs ID → gene/disease/significance |
| `clinicaltrials__search_by_condition` | Disease → matching trials |
| `clinicaltrials__search_by_intervention` | Drug/intervention → trials |
| `pubmed__search_pubmed` | Free-text → PubMed article IDs |

All other tools are discovered on demand via `system__search_available_tools` (hybrid BM25 + semantic search).

## Configuration

Each server is configured in `/.mcp.json`:

```json
{
  "mcpServers": {
    "<name>": {
      "command": "node",
      "args": ["mcp-servers/<name>/dist/index.js"],
      "env": { ... }
    }
  }
}
```

Platforms are defined in `app/server/mcp/platforms.config.ts` with:
- `name`, `directory`, `enabled` flag
- Environment variable mappings
- Always-loaded tool selections

## Build

```bash
bun run build:servers    # Compiles all mcp-servers/*/src → dist/
```

## Related Areas

- [INDEX](./INDEX.md) — Full overview
- [Backend](./backend.md) — MCP manager that spawns and calls these servers
- [Database](./database.md) — Tool call results persisted in messages.tool_calls

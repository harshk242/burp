# Integrations Codemap — MCP Servers

**Generated:** 2026-03-13 | **Files:** 65 | **Lines:** 22,257 | **Protocol:** Model Context Protocol (stdio transport)

## Overview

10 independent MCP servers, each wrapping a biomedical research API. Spawned as child processes by the backend's `mcpManager`. Communicate via stdio JSON-RPC.

## Servers at a Glance

| Server | Lines | Files | Tools | API Target |
|--------|-------|-------|-------|------------|
| `open-targets` | 4,678 | 22 | 53 | Open Targets GraphQL |
| `pubmed` | 2,800 | 13 | 15 | NCBI E-utilities (XML) |
| `uniprot` | 1,320 | 11 | 26 | UniProt REST |
| `clinvar` | 2,260 | 11 | 12 | NCBI ClinVar (XML) |
| `clinpgx` | 2,224 | 12 | 19 | PharmGKB REST |
| `chembl` | 1,971 | 1 | 27 | ChEMBL REST |
| `clinical-trials` | 1,935 | 1 | 17 | ClinicalTrials.gov v2 |
| `ensembl` | 1,647 | 1 | 20 | Ensembl REST |
| `pubchem` | 1,237 | 1 | 11 | PubChem PUG REST |
| `reactome` | 1,073 | 1 | 8 | Reactome Content Service |

**Total:** 208 tools in the unified registry (counted from platform exports on 2026-11-13). Line/file counts above are historical.

## Architecture Patterns

### Single-file servers (5 servers)
`chembl`, `clinical-trials`, `ensembl`, `pubchem`, `reactome` — all logic in one `src/index.ts`. Tool definitions + handlers + API calls in a single module.

### Multi-file servers (5 servers)
`open-targets`, `pubmed`, `clinvar`, `clinpgx` — decomposed into the layout below. `uniprot` is also multi-file; see [UniProt](#uniprot-mcp-serversrcplatformsuniprot).

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

### UniProt (`mcp-server/src/platforms/uniprot/`)

```
uniprot/
├── index.ts              # Platform registration
├── client.ts             # Shared HTTP client and retry policy
├── search-fields.ts      # Search return fields, query helpers, summary projection, totalResults/hint
├── extractors.ts         # Species/organism filters (taxonomy IDs and common names → organism_id)
├── entry-fields.ts       # Per-tool return fields, evidence stripping, slim get_protein_info
├── variants.ts           # Natural-variant summary and disease-variant classification
├── batch.ts              # batch_protein_lookup: accession validation, inactive/merged handling
└── tools/
    ├── definitions.ts    # Tool descriptions and input schemas
    ├── search-handlers.ts   # Search tools
    └── protein-handlers.ts  # Single-entry tools, homologs/orthologs, export
```

- **Searches** return `{totalResults, results: [...]}` summaries (accession, entryId, reviewed, proteinName, geneNames, organism, taxonId, length, annotationScore, bounded function snippet). The default is reviewed Swiss-Prot entries, size 10 (max 100). An empty reviewed search adds a `hint` to retry with `reviewed: false`. A `reviewed:` term inside a free-text query replaces the default filter. Organism arguments accept taxonomy IDs, common names or scientific names. Gene search defaults to human.
- **Homologs/orthologs** are name/gene searches, not alignment-based orthology inference. If the source entry has no name or primary gene to match on, they return an explained empty result rather than unrelated proteins.
- **`get_protein_info`** returns curated annotations without evidence arrays, references or raw sequence. PDB cross-references are reduced to `pdbStructures {count, ids}`; `get_protein_structure` has chains, method and resolution.
- **Exhaustive tools** (`get_protein_features`, `get_external_references`, `get_annotation_confidence`) fetch the full entry and trim it locally. UniProt rejects a request that names any retired return field, so these tools do not enumerate the ~230 release-dependent feature, comment and cross-reference fields. Other tools request short field lists. A live contract test checks those lists against `/configure/uniprotkb/result-fields`.
- **Variants:** `diseaseVariants` names a DISEASE-comment acronym and excludes negated mentions and variants UniProt states as benign, likely benign or uncertain significance. Excluded variants are counted in `excludedDiseaseMentionCount`. Each natural variant keeps its stated `clinicalSignificance`. This is UniProt curation, not a clinical classification.
- **Batch lookup** validates and upper-cases accessions locally, including isoforms such as `P04637-2`, and uses `/uniprotkb/accessions` (max 25; FASTA max 10). JSON reports each input separately:
  - invalid format;
  - not found;
  - merged (resolved to the current entry, with `mergedInto`);
  - demerged or deleted (with `replacedBy` where given).

  TSV and FASTA fail with the names of any malformed accessions.
- **`export_protein_data`** returns raw `gff`, `txt` (flat file), `xml` or `fasta` text. UniProt does not serve GenBank or EMBL.
- **Not returned:** citations from `get_literature_references` lack consortium author names (`authoringGroup`), because that tool selects `lit_pubmed_id`/`lit_doi_id`. WEB RESOURCE links appear only in `get_protein_features`, which returns full comments; `get_protein_info` and the other focused tools omit them.
- **Output size and verification:** larger JSON results become jq-inspectable artifacts in the app, and text formats become `text_range` artifacts. `bun run test:contracts` checks live field lists, batch, variant wording and export formats.

## Always-Loaded Tools (ID Bridge Layer)

10 tools loaded into every Claude prompt (selected by `always_loaded_tools` in `app/config.yaml`). These serve as ID-resolution entry points so Claude can convert natural names to database-specific identifiers:

| Tool | Purpose |
|------|---------|
| `ensembl__search_genes` | Gene symbol → Ensembl Gene ID (ENSG) |
| `ensembl__get_xrefs` | Ensembl gene → external IDs (UniProt, HGNC, …) |
| `uniprot__search_by_gene` | Gene symbol → reviewed UniProt accessions (human by default) |
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

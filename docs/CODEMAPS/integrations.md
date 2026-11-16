# Integrations Codemap — MCP Platforms

The backend starts the unified `mcp-server/dist/index.js` over stdio JSON-RPC, with enabled platforms selected from `app/config.yaml`. Ten API integrations live under `mcp-server/src/platforms/`: Open Targets, PubMed, UniProt, ClinVar, ClinPGx, ChEMBL, ClinicalTrials.gov, Ensembl, PubChem and Reactome.

Build from the repository root with `bun run --filter bio-mcp-unified build`. The backend manager is `app/server/mcp/manager.ts`; tool discovery populates the registry and search index.

## UniProt (26 tools, enabled)

- `tools/definitions.ts`: descriptions and input schemas.
- `tools/handlers.ts`: API requests and dedicated detail extractors.
- `search-fields.ts`: selected REST fields, query escaping and summary projection.
- `entry-fields.ts`: per-tool return fields, evidence stripping and variant summaries.
- `client.ts`: shared HTTP policy; `index.ts`: platform registration.

JSON searches return `{results: [...]}` with accession, entryId, reviewed, proteinName, geneNames, organism, taxonId, length, annotationScore and bounded function snippets. Default scope is reviewed Swiss-Prot entries, size 10 (maximum 100); `reviewed: false` selects unreviewed entries. Gene search defaults to human. Homolog/ortholog tools are name/gene searches, not alignment-based orthology inference.

`get_protein_info` returns curated annotations without raw sequence, exhaustive features/references or evidence arrays. Use dedicated sequence, feature, variant, literature, pathway or interaction tools for details. JSON sequence returns accession plus sequence metadata/value. External references are grouped under `referencesByDatabase`, each with count and references. Variant disease subsets match DISEASE-comment acronyms, not clinical pathogenicity.

Batch lookup returns ordered summaries with per-accession success/errors (maximum 25; FASTA maximum 10). JSON is compact; string formats are sent verbatim. Search XML uses a summary schema; info XML uses the slim info schema. Larger JSON detail results become jq-inspectable artifacts; GFF/FASTA/XML/TSV text artifacts support `text_range`.

UniProt policy removes nested evidences still present in some detail responses. It does not truncate search results or delete requested sequences. The app validates jq policies at startup.

## Always-loaded tools

`app/config.yaml` selects the core tools. UniProt keeps only `search_by_gene`: a cheap gene-to-accession bridge. `get_external_references` is discoverable on demand because exhaustive cross-database references can be large. Other core tools cover Ensembl gene/xref resolution, Open Targets entities, ChEMBL compounds, PubChem SMILES, ClinVar rsIDs, clinical trial searches and PubMed search.

Anthropic catalogs declare other tools with deferred loading; other providers discover specialized tools through `system__search_available_tools` (BM25 plus optional semantic search). System prompt descriptions derive from the enabled catalog.

## Search embeddings

`app/data/tool-embeddings.json` is a generated, untracked runtime cache. Do not commit regenerated vectors. With `embedding.sync_on_boot: true`, `app/server/boot/tools.ts` starts background sync; `embeddings/sync-index.ts` compares the exact tool name/description text and embeds changed or missing descriptions. A configured embedding provider is required; BM25 remains available without one. To explicitly regenerate, run `bun run generate:embeddings` with provider credentials.

## Verification

`bun run test` runs both workspace suites. `bun run test:contracts uniprot` checks live selected-field API responses and projected summaries against fixtures under `mcp-server/src/platforms/__test-utils__/fixtures/uniprot/`.

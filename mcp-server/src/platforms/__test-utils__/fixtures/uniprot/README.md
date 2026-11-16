# UniProt field identifiers

Fetched on 2026-11-13 from:
- https://rest.uniprot.org/configure/uniprotkb/search-fields
- https://rest.uniprot.org/configure/uniprotkb/result-fields

`query-fields.json` contains sorted, unique `term` and `autoCompleteQueryTerm`
identifiers recursively collected from search-fields (including groups/siblings).
`return-fields.json` contains sorted, unique `name` identifiers from result-fields.
Labels, examples and ordering are excluded; additions and removals are checked
by the live handler contract. To refresh, fetch those endpoints, apply
`configureFields` in UniProt's `__tests__/request-contract.ts`, save as formatted
JSON, and review the diff. Endpoint parameter allowlists are maintained separately
in that request assertion because configure endpoints describe fields only.

The existing handler uses `cc_subcellular_location`, a supported legacy aggregate
query alias missing from configure. The request assertion resolves it to the
configured `cc_scl_term` and `cc_scl_note` fields. A live contract compares its
count and returned accessions with the union of those canonical fields; saved
upstream lists are kept exact.

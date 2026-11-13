`resource-filters.json` contains filtering maps and nested field names from
`https://www.ebi.ac.uk/chembl/api/data/{resource}/schema.json`, fetched 2026-11-13.
Related schemas are recursively projected the same way. Other field metadata
is omitted. Numeric filter constants are Tastypie ALL (1) and
ALL_WITH_RELATIONS (2). These are resource schemas, distinct from existing
response snapshots. The live handler contract compares this projection.

The per-route allowlist in chembl/__tests__/request-contract.ts narrows these
to emitted parameters, allowing q only on search endpoints. Refresh only after
reviewing upstream changes. Existing changed-platform-contracts CI discovery
picks up the new contract; continue-on-error remains true.

`parameters.json` records the documented GET/POST routes, path arguments, query
arguments, and POST body fields exercised by Ensembl tool handlers. Retrieved
2026-11-13 from the official REST documentation; each entry links its source.
`content-type` is the REST serialization override documented in the example
requests and user guide. POST lookup/id and vep/:species/id take an `ids` array.

Ensembl ignores unknown query parameters, so the offline allowlist is paired
with live handler tests that verify narrowing and format changes. Regulatory
feature descriptions, exact-symbol gene biotypes, and canonical transcripts
are filtered locally; these exceptions have populated offline fixture tests.
SO-term arrays issue one request per term and union distinct variant records.

CI's changed-platform-contracts job discovers the platform's *.contract.ts
files automatically and intentionally retains continue-on-error: true.

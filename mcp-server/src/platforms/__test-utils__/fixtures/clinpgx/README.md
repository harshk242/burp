`parameters.json` contains the GET parameters for the routes used by ClinPGx
handlers, copied from https://api.clinpgx.org/openapi.json on 2026-11-13.
The live handler contract compares these parameters with the current spec.

The published spec is incomplete: it omits `/data/haplotype`,
`/data/clinicalAnnotation`, `/data/labelAnnotation`, `cpicGene`, and several
relationship filters. `clinpgx/__tests__/request-contract.ts` records these
extensions explicitly. Live contracts exercise them with known-good inputs and
reject unknown-property errors; no-match probes verify relationship criteria
are applied. They must not be presented as spec-derived parameters.

https://api.clinpgx.org/ requests at most two calls per second. The live suite
serializes adapter calls with at least 550 ms between calls, including retries
and concurrent requests inside handlers.

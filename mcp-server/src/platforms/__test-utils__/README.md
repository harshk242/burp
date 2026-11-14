# Tool request contracts

- `argVariants(tool, samples)` builds full args, each additional enum value
  (including nested object and array item enums), and required-only args. `fullArgs` and
  `minimalArgs` are available separately. Supply real IDs and sensible sizes
  in a platform-owned `Samples` map. Enum values come from the input schema.
- `requestRecorder(response)` returns an axios `adapter` and captured
  `requests` (method, axios-resolved URL, query params, parsed JSON or form body). Inject the adapter into
  the real platform client. Reset client caches between invocations.
- `assertHandlerCoverage(tools, handlers)` checks registry parity.
  `assertMakesRequest(requests, localOnlyReason?)` checks request presence and
  recursively rejects missing values and accidental object stringification.
- `assertArgsAffectRequests(tool, samples, capture, clientSideReasons)` changes
  each argument independently and compares the requests, then checks each
  extra enum value. Scalar enum mutations use another allowed value; singleton
  enums have no alternative to mutate. `capture(args)` must reset the client and return requests.
  Document client-side filters by argument, with a reason; test their output
  filtering separately using populated fixtures.
- `assertGraphQLRequest(schema, request)` validates query fields, argument
  types, variable coercion, and extra undeclared variables.
- Live contracts can reuse the same variants; await `pace(ms)` before each
  actual transport call, bypass caches, and reject GraphQL partial errors.

## Open Targets schema fixture

`fixtures/open-targets/schema.json` is the complete GraphQL introspection
`data` object fetched on 2026-11-13 from
https://api.platform.opentargets.org/api/v4/graphql using
`getIntrospectionQuery()` from `graphql`. It is compact JSON (generated data).
To refresh, POST `{ query: getIntrospectionQuery() }` with
`createOpenTargetsHttp()`, check that `response.data.errors` is absent, and
save `JSON.stringify(response.data.data)`. Review the schema changes before
committing. The live handler contract compares canonical, sorted SDL to catch
additions, removals, enum changes and nullability changes without sensitivity
to introspection ordering.

CI automatically discovers `__tests__/tool-handlers.contract.ts` for changed
platforms; shared helper changes select all platform contracts. The changed
platform job intentionally warns through `continue-on-error: true`.

The unfiltered Open Targets credible-set handler first checks the count: the
upstream nested study resolver can time out even for an empty collection.
The contract exercises this path rather than skipping the required-only case.

## NCBI E-utilities

`ncbi.ts` shares EInfo field canonicalization (with explicit database aliases),
ESearch warning/error and query-translation checks, field-list comparison,
and per-request pacing (350 ms without `NCBI_API_KEY`, 110 ms with it).
Use strict All Fields rejection for fully fielded searches; mixed free-text
queries may legitimately translate unfielded words to All Fields, but must
retain each requested field. ClinVar and PubMed reuse these checks.

`fixtures/pubmed/fields.json` saves every `{name, fullname}` from the live
`einfo.fcgi?db=pubmed&retmode=json` field list fetched on 2026-11-13.
The PubMed handler contract compares this list including additions. To refresh,
fetch EInfo and save only those two properties for every field, then review
changes. PubMed's documented `sb` subset tag aliases the EInfo `FILT` field.

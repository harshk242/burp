# Tool request contracts

- `argVariants(tool, samples)` builds full args, each additional enum value
  (including nested object and array item enums), and required-only args. `fullArgs` and
  `minimalArgs` are available separately. Supply real IDs and sensible sizes
  in a platform-owned `Samples` map. Enum values come from the input schema.
- `requestRecorder(response)` returns an axios `adapter` and captured
  `requests` (method, URL, query params, parsed body). Inject the adapter into
  the real platform client. Reset client caches between invocations.
- `assertHandlerCoverage(tools, handlers)` checks registry parity.
  `assertMakesRequest(requests, localOnlyReason?)` checks request presence and
  recursively rejects missing values and accidental object stringification.
- `assertArgsAffectRequests(tool, samples, capture, clientSideReasons)` changes
  each argument independently and compares the requests, then checks each
  extra enum value. `capture(args)` must reset the client and return requests.
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

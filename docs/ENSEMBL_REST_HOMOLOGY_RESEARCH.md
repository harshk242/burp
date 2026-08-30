# Ensembl REST homology endpoint check

Checked 2026-08-30 against Ensembl's live REST documentation and endpoint
index. This note concerns `rest.ensembl.org`, not the separate GRCh37 REST
server.

## Current endpoint status

Both routes are currently documented in Ensembl's live endpoint index; neither
is marked deprecated or retired:

- `GET /homology/id/:species/:id` retrieves homology by **Ensembl stable ID**.
- `GET /homology/symbol/:species/:symbol` retrieves homology by a gene symbol
  or display name.

Sources: [endpoint index](https://rest.ensembl.org/), [stable-ID route
documentation](https://rest.ensembl.org/documentation/info/homology_species_gene_id),
[symbol route documentation](https://rest.ensembl.org/documentation/info/homology_symbol).

## Route comparison

| Concern | Stable-ID route | Symbol route |
| --- | --- | --- |
| Required identifiers | `species` name/alias and an Ensembl stable ID | `species` name/alias and a gene symbol/display name |
| Examples in current docs | `human` and `ENSG00000157764` | `human` and `BRCA2` |
| Homology filtering | `type`, `target_species`, and `target_taxon` | The same filters |
| Extra symbol-specific filter | None | `external_db` |
| Other documented options | `aligned`, `cigar_line`, `compara`, `format`, `sequence`, and `callback` | The same options |

Ensembl explicitly accepts aliases such as `human` for `homo_sapiens` and says
that `target_species` accepts aliases too. The supported `type` values are
`orthologues`, `paralogues`, `projections`, and `all`; its documented default
is `all`. The documented default response layout is `full`, and default
sequence payload is `protein`.

Sources: [stable-ID parameters](https://rest.ensembl.org/documentation/info/homology_species_gene_id),
[symbol parameters](https://rest.ensembl.org/documentation/info/homology_symbol).

## Repository comparison and conclusion

`mcp-server/src/platforms/ensembl/tools/comparative.ts` implements
`get_homologs` with `/homology/id/${species}/${gene_id}` and requires the
caller to provide an Ensembl gene ID. Therefore the contract test should use
the stable-ID route, with the same species and filters as production:

```text
GET /homology/id/homo_sapiens/ENSG00000141510
  ?type=orthologues&target_species=mus_musculus
```

This is not because the symbol route is obsolete: it remains supported. It is
because a contract test should cover the actual production request shape and
avoid adding a symbol/display-name lookup to the dependency under test.

## Reliability limits

The current route documentation specifies no endpoint-specific timeout,
latency guarantee, retry policy, or preference between the two routes. The
official Ensembl REST publication describes a public-server limit of 15
requests per second per client and response headers that expose the current
limit and reset timing. No retirement notice for either current main-server
homology route was found in the live endpoint index or the route pages above.

Source: [Ensembl REST API publication](https://pmc.ncbi.nlm.nih.gov/articles/PMC4271150/).

The observed 20-second GitHub Actions timeout is thus a client-side test
setting, not an Ensembl-documented limit. It can still be appropriate to align
that setting with the production client's 30-second timeout, but changing the
route alone is a production-parity correction, not a documented performance
fix.

## Contract-test retry policy

The Ensembl-only contract helper makes at most one additional request after a
transport failure (timeouts, connection/DNS failures, or Axios network errors)
or HTTP 408, 429, or 5xx response. It does not retry ordinary 4xx responses or
schema assertions, so a contract mismatch still fails immediately. The helper
uses a fixed 500 ms fallback backoff; for HTTP 429 it honors a valid
`Retry-After` value, capped at 10 seconds to keep the test time budget bounded.

# Codex CLI Usage

This file documents how to use Codex CLI with the MCP multi-server runner to execute cross-platform use cases.

## Prerequisites

- Node.js 18+
- Bun installed
- `.mcp.json` present in the repo root
- MCP servers built

Build the servers you plan to call:

```bash
cd mcp-servers/open-targets && bun install && bun run build && cd ../..
cd mcp-servers/clinvar && bun install && bun run build && cd ../..
cd mcp-servers/pubmed && bun install && bun run build && cd ../..
# Repeat for other servers as needed
```

## Local Server Authentication

Starting the app without Clerk requires an empty `CLERK_SECRET_KEY` and explicit
`AUTH_MODE=development` in `app/.env` or the shell environment. This enables a local
admin identity only outside production. Production requires `CLERK_SECRET_KEY`;
without a key or explicit development mode, protected requests return HTTP 503.
The web app follows the same rule: set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, or
`AUTH_MODE=development` in `app/web/.env.local` for a provider-free local UI.
Production web builds fail without a valid publishable key.

## Prompt Cache / Lossless Transcript Gate

The manual gate for issue #32 is tracked in
`app/scripts/prompt-cache-gate/`; it uses the normal workspace dependencies.
From the repository root:

```bash
bun install --frozen-lockfile
bun run --filter bio-mcp-unified build
LOG_LEVEL=ERROR bun run gate:prompt-cache 4b
```

Live checks require `ANTHROPIC_API_KEY` in `app/.env` or the environment and an
Anthropic chat model configured in `app/config.yaml`; they make billable API
requests. Use `all` instead of `4b` to include the Phase 0 checks. To check only
the provider's redacted-thinking round-trip without network access:

```bash
ANTHROPIC_API_KEY=offline LLM_PROVIDER=anthropic LOG_LEVEL=ERROR bun run gate:prompt-cache --offline
```

See [the gate README](app/scripts/prompt-cache-gate/README.md) for prerequisites,
verdict meanings, and rerun guidance.

## Multi-Server Runner

The runner is a lightweight MCP host that starts multiple servers and routes tool calls.

Location: `scripts/mcp-multi-runner.js`

Common commands:

```bash
# List configured servers
node scripts/mcp-multi-runner.js list-servers

# List tools for a specific server
node scripts/mcp-multi-runner.js list-tools open-targets

# Call a tool directly
node scripts/mcp-multi-runner.js call-tool open-targets search_entities \
  --args '{"query_string":"TP53","entity_names":["target"],"page_index":0,"page_size":5}'
```

## Running a Cross-Platform Use Case

Use `run-plan` with a JSON plan file. Each step calls one tool on one server.

Example plan file (`use_case_2_plan.json`):

```json
{
  "steps": [
    {
      "server": "open-targets",
      "tool": "search_entities",
      "args": {
        "query_string": "breast cancer",
        "entity_names": ["disease"],
        "page_index": 0,
        "page_size": 5
      }
    },
    {
      "server": "open-targets",
      "tool": "search_entities",
      "args": {
        "query_string": "BRCA1",
        "entity_names": ["target"],
        "page_index": 0,
        "page_size": 5
      }
    },
    {
      "server": "clinvar",
      "tool": "search_variants_by_gene",
      "args": {
        "geneSymbol": "BRCA1",
        "clinicalSignificance": "Pathogenic",
        "maxResults": 5
      }
    },
    {
      "server": "pubmed",
      "tool": "search_pubmed",
      "args": {
        "query": "\"BRCA1\"[Title/Abstract] AND \"breast cancer\"[Title/Abstract]",
        "retmax": 5,
        "retstart": 0
      }
    }
  ]
}
```

Run the plan:

```bash
node scripts/mcp-multi-runner.js run-plan ./use_case_2_plan.json
```

## Mapping USE_CASES.md to Plans

1. Pick a use case from `USE_CASES.md`.
2. Translate each workflow step to a specific MCP tool call.
3. Write the steps to a JSON plan file.
4. Run the plan with the multi-server runner.

If you want, ask Codex CLI to generate the plan file for a use case and then run it.

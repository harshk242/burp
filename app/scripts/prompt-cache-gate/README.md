# Prompt caching and lossless transcript gate

Manual verification for the context-assembly plan's Phase 0 and Phase 4b.6
(issue #32). Run it again after changing the SDK, Anthropic model, thinking
configuration, or API account. Live runs make billable Anthropic requests.

## Setup

Use Bun and Node.js 18+ (Node runs the MCP child process).

From the repository root, install the locked dependencies and build the unified
MCP server used to discover the configured tool catalog:

```bash
bun install --frozen-lockfile
bun run --filter bio-mcp-unified build
```

Set `ANTHROPIC_API_KEY` in `app/.env` or the environment. The chat provider and
model come from `app/config.yaml` (or `LLM_PROVIDER` / `LLM_CHAT_MODEL` overrides);
use Anthropic and a model supporting the plan's adaptive thinking and tool search.
Phase 4b uses effort `high` by default to elicit signed thinking; `GATE_EFFORT`
can override it. The configured platforms must include the ChEMBL tools used by
the scenarios. The gate discovers tool schemas over MCP stdio and stubs tool
results; it does not need an embedding index or a running HTTP backend.

## Commands

Run from the repository root or `app/`; the package command runs with `app/` as
the working directory, loads its `.env`, and sets `DATABASE_URL=:memory:`.
All source files and helpers are tracked here, with dependencies supplied by
the normal workspace installation.

```bash
bun run gate:prompt-cache --help
LOG_LEVEL=ERROR bun run gate:prompt-cache 4b
LOG_LEVEL=ERROR bun run gate:prompt-cache all
```

`4b` checks JSON → SQLite → parsed-message replay, signed thinking and cache
reads, redacted thinking, consecutive tool-result/user content, request-prefix
hashes, degraded replay, and cancellation. `all` also runs Phase 0 checks 1–5.
Individual checks `1`, `2`, `3`, `4`, and `5` are supported; `2` and `3` share
the same sequence. Omitting the argument runs `all`.

For the offline redacted-thinking check only (no live requests or MCP process):

```bash
ANTHROPIC_API_KEY=offline LLM_PROVIDER=anthropic LOG_LEVEL=ERROR bun run gate:prompt-cache --offline
```

Live checks print call and verdict tables. Failed `required` or
`expected-negative` verdicts exit 1; `warn` verdicts are advisory. Message-prefix
hashes are required to match after removing cache markers; moving markers can
change the exact request prefix and is reported as a warning. The offline mode
reports its own result and does not establish that the live gate passed.
Record live results in [the context-assembly plan](../../../plans/context-assembly-prompt-caching-plan.md).

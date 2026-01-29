# LLM Provider Portability Review

I checked the current integration. The Anthropic-specific pieces are concentrated, but they’re deep enough that swapping providers will require a proper abstraction layer rather than a tiny config tweak.

## Findings (ordered by severity)

- **Critical**: `app/server/orchestration/chat.ts:167` has an unterminated string literal in `model: "claude-sonnet-4-5-20250929,` which will not compile.
- **High**: `app/server/orchestration/chat.ts` is tightly coupled to Anthropic SDK types/stream events (`Anthropic.ContentBlock`, `content_block_*` events, `stop_reason`, `server_tool_use`, `anthropic.beta.messages.stream`, Anthropic model IDs, and the `tool_search_tool_*` tool). This file is effectively the entire provider implementation.
- **Medium**: `app/server/mcp/registry.ts` returns `Anthropic.Tool[]` and bakes in `defer_loading`, and `app/server/routes/tools.ts` assumes `defer_loading` exists. That’s an Anthropic-only field tied to tool search.
- **Medium**: Tool names include hyphens in prefixes (e.g. `open-targets__...`). Gemini’s function-calling docs recommend names without spaces/special characters (underscores/camelCase), so you’ll likely need a name-normalization map if you target Gemini.

## What changes if you switch providers

- **Anthropic tool search is Claude-only.** The built-in tool search (BM25/regex) with `defer_loading` is specific to Claude and requires a beta header + supported Claude 4.5 models.
- **OpenAI**: You can define tools and control tool use via `tool_choice`, including restricting the allowed tools subset. That gives you a way to implement *your own* tool retrieval (BM25/embedding) and then only allow the selected tools per request.
- **Gemini**: Function calling is controlled via a `function_calling_config` mode, and you can restrict to `allowed_function_names` (same idea as OpenAI’s `allowed_tools`).

## How to make the code provider‑modular

1) **Introduce a provider interface** (e.g., `LLMProvider`) with `streamChat()` + `createTitle()` and provider‑agnostic event types (`text`, `tool_call`, `done`, `error`).
2) **Split tool formatting from tool storage.** Keep the MCP registry as provider‑agnostic (`ToolSpec`), then add formatters: `toAnthropicTools`, `toOpenAITools`, `toGeminiTools`.
3) **Abstract tool selection.**
   - If provider = Anthropic and tool search enabled, include `tool_search_tool_*` + `defer_loading`.
   - If provider = OpenAI/Gemini, run **local tool retrieval** (BM25/embedding or your existing `toolRegistry.search` as a baseline), then pass only the subset and optionally use `tool_choice`/`allowed_function_names` to enforce it.
4) **Normalize tool names per provider.** Keep your internal `server__tool` IDs, but add a mapping for providers with stricter naming. Gemini’s naming guidance makes this especially relevant.
5) **Move Anthropic‑specific prompt text** (mentions of `tool_search`) into provider‑specific prompt fragments.

If you meant **“Google models” = Gemini**, you’ll need custom tool selection. If you meant **“run Claude on Google Vertex AI”**, tool search still works but uses a different beta header per Anthropic’s docs.

If you want, I can implement a minimal provider abstraction with Anthropic + OpenAI (or Gemini) and a local BM25 tool selector.

## Next steps (pick one)

1) I add a provider interface + Anthropic/OpenAI adapters.
2) I add provider interface + Gemini adapter + tool name normalization.
3) I implement local tool retrieval (BM25) and wire it into the current orchestrator.

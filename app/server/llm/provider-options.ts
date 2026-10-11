/**
 * Provider options for chat calls.
 *
 * Anthropic: adaptive thinking with the configured display, and an explicit
 * effort. Effort is always sent: Sonnet 5.5 defaults to `high`, and a fixed
 * value keeps the request stable if the API default changes. `ai`'s top-level
 * `reasoning` option is not used: provider options take precedence, and the
 * two would silently disagree. Sampling parameters (temperature, top_p, top_k)
 * are never sent; non-default values return a 400 on Sonnet 5.5.
 *
 * Google: no options (the chat call is unchanged).
 */

import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import type { LLMConfig } from "./config";

export type ChatProviderOptions = NonNullable<ModelMessage["providerOptions"]>;

export function chatProviderOptions(
  config: Pick<LLMConfig, "provider" | "thinkingDisplay" | "effort">
): ChatProviderOptions | undefined {
  if (config.provider !== "anthropic") return undefined;
  return {
    anthropic: {
      thinking: { type: "adaptive", display: config.thinkingDisplay },
      effort: config.effort,
    } satisfies AnthropicLanguageModelOptions,
  };
}

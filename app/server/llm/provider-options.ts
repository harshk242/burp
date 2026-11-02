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

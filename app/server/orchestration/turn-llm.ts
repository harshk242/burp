/**
 * A turn's LLM settings: app config, with the turn's optional override (eval
 * arms: model, effort, max_output_tokens) applied. Resolved once per turn, so
 * one process can run turns on different settings. Without an override every
 * value is exactly what app config gives.
 */

import { chatProviderOptions, effectiveLLMConfig, loadLLMConfig, type ChatProviderOptions, type LLMConfig, type TurnLLMOverride } from "../llm";
import { SYSTEM_PROMPT } from "./context/system-prompt";
import { contextVersion, type TranscriptTag } from "./context/transcript";

export interface TurnLLM {
  llmConfig: LLMConfig;
  /** Thinking + effort (Anthropic); undefined on Google. */
  providerOptions: ChatProviderOptions | undefined;
  /** Stored on every model_transcript row (compatibility check for replay). */
  transcriptTag: TranscriptTag;
  /** modelParameters of every llm-call generation in the trace. */
  generationParameters: Record<string, string | number>;
}

export function resolveTurnLLM(override?: TurnLLMOverride): TurnLLM {
  const llmConfig = effectiveLLMConfig(loadLLMConfig(), override);
  const providerOptions = chatProviderOptions(llmConfig);
  return {
    llmConfig,
    providerOptions,
    transcriptTag: {
      provider: llmConfig.provider,
      model: llmConfig.chatModel,
      contextVersion: contextVersion(SYSTEM_PROMPT, providerOptions),
    },
    generationParameters: {
      effort: llmConfig.effort,
      max_output_tokens: llmConfig.maxOutputTokens,
      thinking_display: llmConfig.thinkingDisplay,
    },
  };
}

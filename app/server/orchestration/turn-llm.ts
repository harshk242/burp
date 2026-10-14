import { chatProviderOptions, effectiveLLMConfig, loadLLMConfig, type ChatProviderOptions, type LLMConfig, type TurnLLMOverride } from "../llm";
import { SYSTEM_PROMPT } from "./context/system-prompt";
import { contextVersion, type TranscriptTag } from "./context/transcript";

export interface TurnLLM {
  llmConfig: LLMConfig;
  providerOptions: ChatProviderOptions | undefined;
  transcriptTag: TranscriptTag;
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

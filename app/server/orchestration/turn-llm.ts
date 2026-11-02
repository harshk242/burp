import { chatProviderOptions, effectiveLLMConfig, loadLLMConfig, type ChatProviderOptions, type LLMConfig, type TurnLLMOverride } from "../llm";
import { buildSystemPrompt } from "./context/system-prompt";
import { contextVersion, type TranscriptTag } from "./context/transcript";

export interface TurnLLM {
  systemPrompt: string;
  llmConfig: LLMConfig;
  providerOptions: ChatProviderOptions | undefined;
  transcriptTag: TranscriptTag;
  generationParameters: Record<string, string | number>;
}

export function resolveTurnLLM(override?: TurnLLMOverride): TurnLLM {
  const llmConfig = effectiveLLMConfig(loadLLMConfig(), override);
  const providerOptions = chatProviderOptions(llmConfig);
  const systemPrompt = buildSystemPrompt();
  return {
    systemPrompt,
    llmConfig,
    providerOptions,
    transcriptTag: {
      provider: llmConfig.provider,
      model: llmConfig.chatModel,
      contextVersion: contextVersion(systemPrompt, providerOptions),
    },
    generationParameters: {
      effort: llmConfig.effort,
      max_output_tokens: llmConfig.maxOutputTokens,
      thinking_display: llmConfig.thinkingDisplay,
    },
  };
}

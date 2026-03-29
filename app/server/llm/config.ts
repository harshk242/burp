/**
 * LLM configuration — reads from the central appConfig singleton.
 * Supports Anthropic and Google as providers.
 */

import { appConfig } from "../config";

export type LLMProviderName = "anthropic" | "google";

export interface LLMConfig {
  provider: LLMProviderName;
  chatModel: string;
  titleModel: string;
  summarizerModel: string;
  maxRetries: number;
  toolOutputSummaryThreshold: number;
}

const DEFAULTS: Record<LLMProviderName, { chat: string; title: string; summarizer: string }> = {
  anthropic: {
    chat: "claude-haiku-4-5",
    title: "claude-haiku-4-5",
    summarizer: "claude-haiku-4-5",
  },
  google: {
    chat: "gemini-3-flash-preview",
    title: "gemini-3-flash-preview",
    summarizer: "gemini-3-flash-preview",
  },
};

export function loadLLMConfig(): LLMConfig {
  const { llm } = appConfig;
  const provider = llm.provider;

  return {
    provider,
    chatModel: llm.chat_model || DEFAULTS[provider].chat,
    titleModel: llm.title_model || DEFAULTS[provider].title,
    summarizerModel: llm.summarizer_model || DEFAULTS[provider].summarizer,
    maxRetries: llm.max_retries,
    toolOutputSummaryThreshold: llm.tool_output_summary_threshold,
  };
}

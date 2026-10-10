/**
 * LLM configuration — reads from the central appConfig singleton.
 * Supports Anthropic and Google as providers.
 */

import { appConfig, type AppConfig } from "../config";

export type LLMProviderName = "anthropic" | "google";
export type ThinkingDisplay = AppConfig["llm"]["thinking_display"];
export type Effort = AppConfig["llm"]["effort"];

export interface LLMConfig {
  provider: LLMProviderName;
  chatModel: string;
  titleModel: string;
  maxRetries: number;
  maxOutputTokens: number;
  maxToolIterations: number;
  thinkingDisplay: ThinkingDisplay;
  effort: Effort;
}

const DEFAULTS: Record<LLMProviderName, { chat: string; title: string }> = {
  anthropic: {
    chat: "claude-haiku-4-5",
    title: "claude-haiku-4-5",
  },
  google: {
    chat: "gemini-3-flash-preview",
    title: "gemini-3-flash-preview",
  },
};

export function loadLLMConfig(): LLMConfig {
  const { llm } = appConfig;
  const provider = llm.provider;

  return {
    provider,
    chatModel: llm.chat_model || DEFAULTS[provider].chat,
    titleModel: llm.title_model || DEFAULTS[provider].title,
    maxRetries: llm.max_retries,
    maxOutputTokens: llm.max_output_tokens,
    maxToolIterations: llm.max_tool_iterations,
    thinkingDisplay: llm.thinking_display,
    effort: llm.effort,
  };
}

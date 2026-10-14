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
  maxContextTokens: number;
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
    maxContextTokens: llm.max_context_tokens,
    maxToolIterations: llm.max_tool_iterations,
    thinkingDisplay: llm.thinking_display,
    effort: llm.effort,
  };
}

/**
 * Per-turn LLM settings (eval arms): any field set replaces the app config's
 * value for one processChat turn. Provider, retries, context budget and tool
 * iterations always come from app config.
 */
export interface TurnLLMOverride {
  model?: string;
  effort?: Effort;
  max_output_tokens?: number;
}

export function effectiveLLMConfig(base: LLMConfig, override?: TurnLLMOverride): LLMConfig {
  if (!override) return base;
  return {
    ...base,
    chatModel: override.model ?? base.chatModel,
    effort: override.effort ?? base.effort,
    maxOutputTokens: override.max_output_tokens ?? base.maxOutputTokens,
  };
}

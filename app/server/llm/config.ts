/**
 * LLM provider configuration.
 * Supports Anthropic and Google as providers.
 * Legacy env vars (CLAUDE_MODEL, etc.) kept as fallbacks.
 */

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
  const provider = (process.env.LLM_PROVIDER || "anthropic") as LLMProviderName;
  if (!DEFAULTS[provider]) {
    throw new Error(`Unknown LLM_PROVIDER: ${provider}. Must be "anthropic" or "google".`);
  }

  return {
    provider,
    chatModel:
      process.env.LLM_CHAT_MODEL ||
      process.env.CLAUDE_MODEL ||
      DEFAULTS[provider].chat,
    titleModel:
      process.env.LLM_TITLE_MODEL ||
      process.env.CLAUDE_TITLE_MODEL ||
      DEFAULTS[provider].title,
    summarizerModel:
      process.env.LLM_SUMMARIZER_MODEL ||
      process.env.TOOL_SUMMARIZER_MODEL ||
      DEFAULTS[provider].summarizer,
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES || "3", 10),
    toolOutputSummaryThreshold: parseInt(
      process.env.TOOL_OUTPUT_SUMMARY_THRESHOLD || "15000",
      10
    ),
  };
}

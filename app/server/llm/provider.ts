/**
 * Model factory — returns Vercel AI SDK model instances
 * based on the configured LLM provider.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { loadLLMConfig, type LLMProviderName } from "./config";

const config = loadLLMConfig();

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const googleApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

const anthropic = createAnthropic({ apiKey: anthropicApiKey });
const google = createGoogle({ apiKey: googleApiKey });

export interface ModelOptions {
  /** Transport for this model only; builds a dedicated provider instance. */
  fetch?: typeof fetch;
}

function getModel(modelId: string, provider: LLMProviderName, options: ModelOptions = {}): LanguageModel {
  const { fetch } = options;
  switch (provider) {
    case "anthropic":
      return (fetch ? createAnthropic({ apiKey: anthropicApiKey, fetch }) : anthropic)(modelId);
    case "google":
      return (fetch ? createGoogle({ apiKey: googleApiKey, fetch }) : google)(modelId);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export function getChatModel(options?: ModelOptions): LanguageModel {
  return getModel(config.chatModel, config.provider, options);
}

export function getTitleModel(): LanguageModel {
  return getModel(config.titleModel, config.provider);
}

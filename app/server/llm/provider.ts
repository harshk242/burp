import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { loadLLMConfig, type LLMProviderName } from "./config";
import { omitUndefined } from "../../shared/object";

const config = loadLLMConfig();

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const googleApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

const anthropic = createAnthropic(omitUndefined({ apiKey: anthropicApiKey }));
const google = createGoogle(omitUndefined({ apiKey: googleApiKey }));

export interface ModelOptions {
  fetch?: typeof fetch;
  model?: string;
}

function getModel(modelId: string, provider: LLMProviderName, options: ModelOptions = {}): LanguageModel {
  const { fetch } = options;
  switch (provider) {
    case "anthropic":
      return (fetch ? createAnthropic(omitUndefined({ apiKey: anthropicApiKey, fetch })) : anthropic)(modelId);
    case "google":
      return (fetch ? createGoogle(omitUndefined({ apiKey: googleApiKey, fetch })) : google)(modelId);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export function getChatModel(options?: ModelOptions): LanguageModel {
  return getModel(options?.model ?? config.chatModel, config.provider, options);
}

export function getTitleModel(): LanguageModel {
  return getModel(config.titleModel, config.provider);
}

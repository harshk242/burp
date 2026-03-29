/**
 * Model factory — returns Vercel AI SDK model instances
 * based on the configured LLM provider.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel, EmbeddingModel } from "ai";
import { loadLLMConfig, type LLMProviderName } from "./config";

const config = loadLLMConfig();

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

function getModel(modelId: string, provider: LLMProviderName): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropic(modelId);
    case "google":
      return google(modelId);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export function getChatModel(): LanguageModel {
  return getModel(config.chatModel, config.provider);
}

export function getTitleModel(): LanguageModel {
  return getModel(config.titleModel, config.provider);
}

export function getSummarizerModel(): LanguageModel {
  return getModel(config.summarizerModel, config.provider);
}

/** Embedding model is always Gemini regardless of LLM provider */
export function getEmbeddingModel(): EmbeddingModel {
  return google.embedding("gemini-embedding-001");
}

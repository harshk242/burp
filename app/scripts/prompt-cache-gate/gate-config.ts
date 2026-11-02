import type { Effort, LLMConfig } from "../../server/llm/config";
import { EFFORT_LEVELS } from "../../evals/lib/arms";
import { checkCapabilities, type ModelsApiOptions } from "../../evals/lib/capabilities";

export function parseGateEffort(value = "high"): Effort {
  const effort = EFFORT_LEVELS.find((level) => level === value);
  if (!effort) throw new Error(`GATE_EFFORT must be one of ${EFFORT_LEVELS.join(", ")}; got "${value}"`);
  return effort;
}

export async function preflightThinking(config: LLMConfig, effort: Effort, api: ModelsApiOptions): Promise<void> {
  if (config.provider !== "anthropic") throw new Error("Thinking replay gate requires the Anthropic provider");
  await checkCapabilities([{ model: config.chatModel, effort, max_output_tokens: config.maxOutputTokens }], config.maxContextTokens, api);
}

export function coldCacheWritten(usage: { cacheRead?: number; cacheWrite?: number }): boolean {
  return usage.cacheRead === 0 && (usage.cacheWrite ?? 0) > 0;
}

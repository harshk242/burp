import type { LanguageModelUsage, ProviderMetadata } from "ai";
import { appConfig, type AppConfig } from "../config";
import type { DbUsageEvent } from "../types";
import { logger, type LogContext } from "../logger";
import { priceCall, resolvePricing, summarizeTurnCost, type CallCost, type CallUsage, type ChatCost } from "../usage";

export interface CallLogInfo {
  iteration: number;
  durationMs: number;
  finishReason: string;
  toolCalls: number;
  toolNames: readonly string[];
  systemPrompt: string;
}

export type UsageLedgerFields = Pick<
  DbUsageEvent,
  | "input_tokens"
  | "output_tokens"
  | "cache_read_tokens"
  | "cache_write_5m_tokens"
  | "cache_write_1h_tokens"
  | "input_cost_per_mtok_microusd"
  | "output_cost_per_mtok_microusd"
  | "pricing_json"
  | "cost_microusd"
  | "input_cost_microusd"
  | "cache_read_cost_microusd"
  | "cache_write_cost_microusd"
  | "output_cost_microusd"
  | "llm_calls"
  | "long_context_calls"
  | "usage_estimated"
>;

export function shortHash(text: string): string {
  return new Bun.CryptoHasher("sha1").update(text).digest("hex").slice(0, 8);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * `inputTokenDetails` gives the Anthropic and Google split; the 5m/1h write
 * split exists only in Anthropic's raw usage
 * (`providerMetadata.anthropic.usage.cache_creation`). Google never reports writes.
 */
export function splitCallUsage(
  usage: LanguageModelUsage | undefined,
  providerMetadata: ProviderMetadata | undefined
): { usage: CallUsage; inputTokens: number; gap: number } {
  const details = usage?.inputTokenDetails;
  const noCache = count(details?.noCacheTokens);
  const cacheRead = count(details?.cacheReadTokens);
  const cacheWrite = count(details?.cacheWriteTokens);
  const inputTokens = count(usage?.inputTokens);

  const cacheCreation = asRecord(asRecord(providerMetadata?.anthropic?.usage)?.cache_creation);
  const write1h = Math.min(count(cacheCreation?.ephemeral_1h_input_tokens), cacheWrite);

  const gap = inputTokens - (noCache + cacheRead + cacheWrite);
  return {
    usage: {
      noCacheTokens: noCache + Math.max(0, gap),
      cacheReadTokens: cacheRead,
      cacheWrite5mTokens: cacheWrite - write1h,
      cacheWrite1hTokens: write1h,
      outputTokens: count(usage?.outputTokens),
    },
    inputTokens,
    gap,
  };
}

function picoToMicrousd(pico: number): number {
  return pico / 1_000_000;
}

export class UsageMeter {
  private readonly calls: CallCost[] = [];
  private estimated = false;

  constructor(
    private readonly provider: string,
    private readonly model: string,
    private readonly ctx: LogContext,
    private readonly config: AppConfig = appConfig
  ) {}

  get callCount(): number {
    return this.calls.length;
  }

  record(
    usage: LanguageModelUsage | undefined,
    providerMetadata: ProviderMetadata | undefined,
    info: CallLogInfo
  ): CallCost {
    const split = splitCallUsage(usage, providerMetadata);
    if (split.gap !== 0) {
      logger.warn("CHAT", "usage_mismatch", {
        ctx: this.ctx,
        data: {
          iteration: info.iteration,
          input_tokens: split.inputTokens,
          no_cache: usage?.inputTokenDetails?.noCacheTokens,
          cache_read: usage?.inputTokenDetails?.cacheReadTokens,
          cache_write: usage?.inputTokenDetails?.cacheWriteTokens,
          gap: split.gap,
        },
      });
    }

    const call = this.add(split.usage);
    logger.info("CHAT", "llm_response_received", {
      ctx: this.ctx,
      duration_ms: info.durationMs,
      data: {
        iteration: info.iteration,
        finish_reason: info.finishReason,
        tool_calls: info.toolCalls,
        prompt_tokens: call.promptTokens,
        no_cache: call.noCacheTokens,
        cache_read: call.cacheReadTokens,
        cache_write_5m: call.cacheWrite5mTokens,
        cache_write_1h: call.cacheWrite1hTokens,
        output_tokens: call.outputTokens,
        pricing_tier: call.tier,
        call_cost_microusd: picoToMicrousd(call.costPicoUsd),
        tool_count: info.toolNames.length,
        tools_hash: shortHash(JSON.stringify(info.toolNames)),
        system_hash: shortHash(info.systemPrompt),
      },
    });
    if (call.tier === "long_context") {
      logger.warn("CHAT", "pricing_long_context_tier", {
        ctx: this.ctx,
        data: {
          iteration: info.iteration,
          model: this.model,
          prompt_tokens: call.promptTokens,
          call_cost_microusd: picoToMicrousd(call.costPicoUsd),
        },
      });
    }
    return call;
  }

  add(usage: CallUsage, { estimated = false }: { estimated?: boolean } = {}): CallCost {
    const call = priceCall(this.provider, this.model, usage, this.config);
    this.calls.push(call);
    if (estimated) this.estimated = true;
    return call;
  }

  summary(): ChatCost {
    return summarizeTurnCost(this.calls);
  }

  ledgerFields(cost: ChatCost = this.summary()): UsageLedgerFields {
    const pricing = resolvePricing(this.provider, this.model, this.config);
    return {
      input_tokens: cost.inputTokens,
      output_tokens: cost.outputTokens,
      cache_read_tokens: cost.cacheReadTokens,
      cache_write_5m_tokens: cost.cacheWrite5mTokens,
      cache_write_1h_tokens: cost.cacheWrite1hTokens,
      input_cost_per_mtok_microusd: pricing.base.input,
      output_cost_per_mtok_microusd: pricing.base.output,
      pricing_json: JSON.stringify(pricing.entry),
      cost_microusd: cost.costMicrousd,
      input_cost_microusd: cost.inputCostMicrousd,
      cache_read_cost_microusd: cost.cacheReadCostMicrousd,
      cache_write_cost_microusd: cost.cacheWriteCostMicrousd,
      output_cost_microusd: cost.outputCostMicrousd,
      llm_calls: cost.llmCalls,
      long_context_calls: cost.longContextCalls,
      usage_estimated: this.estimated ? 1 : 0,
    };
  }

  logFields(cost: ChatCost = this.summary()): Record<string, unknown> {
    return {
      llm_calls: cost.llmCalls,
      long_context_calls: cost.longContextCalls,
      total_input_tokens: cost.inputTokens,
      total_output_tokens: cost.outputTokens,
      no_cache: cost.noCacheTokens,
      cache_read: cost.cacheReadTokens,
      cache_write_5m: cost.cacheWrite5mTokens,
      cache_write_1h: cost.cacheWrite1hTokens,
      cache_hit_ratio: cost.inputTokens > 0 ? Number((cost.cacheReadTokens / cost.inputTokens).toFixed(4)) : 0,
      cost_microusd: cost.costMicrousd,
      usage_estimated: this.estimated,
      cost_breakdown: {
        input: cost.inputCostMicrousd,
        cache_read: cost.cacheReadCostMicrousd,
        cache_write: cost.cacheWriteCostMicrousd,
        output: cost.outputCostMicrousd,
      },
    };
  }
}

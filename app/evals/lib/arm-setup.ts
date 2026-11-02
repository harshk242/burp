import type { LLMConfig } from "../../server/llm";
import { assertPricingConfigured, PricingConfigError } from "../../server/usage";
import { ArmsError, combineArms, configArm, loadMatrix, resolveArm, type ResolvedArm } from "./arms";
import { CapabilityError, checkCapabilities, type ModelsApiOptions } from "./capabilities";
import { estimateArmCost, type ArmEstimate } from "./estimate";
import type { RunArgs } from "./args";
import { RunAbort } from "./search-check";

export interface PreparedArms {
  arms: ResolvedArm[];
  comparing: boolean;
}

function assertPricing(provider: string, models: string[]): void {
  const missing: string[] = [];
  for (const model of [...new Set(models)]) {
    try {
      assertPricingConfigured(provider, model);
    } catch (error) {
      if (!(error instanceof PricingConfigError)) throw error;
      missing.push(model);
    }
  }
  if (missing.length) {
    throw new RunAbort(`no pricing for ${missing.map((m) => `${provider}/${m}`).join(", ")}: add it under usage.pricing in app/config.yaml`);
  }
}

export async function prepareArms(args: Pick<RunArgs, "matrix" | "arms">, config: LLMConfig, api: ModelsApiOptions): Promise<PreparedArms> {
  let specs;
  try {
    specs = combineArms(args.matrix ? loadMatrix(args.matrix) : [], args.arms);
  } catch (error) {
    if (error instanceof ArmsError) throw new RunAbort(error.message);
    throw error;
  }
  if (specs.length === 0) {
    assertPricing(config.provider, [config.chatModel]);
    return { arms: [configArm(config)], comparing: false };
  }
  if (config.provider !== "anthropic") throw new RunAbort(`arms are Anthropic only; LLM_PROVIDER is ${config.provider}`);
  assertPricing(config.provider, specs.map((a) => a.model));
  let infos;
  try {
    infos = await checkCapabilities(specs, config.maxContextTokens, api);
  } catch (error) {
    if (error instanceof CapabilityError) throw new RunAbort(error.message);
    throw error;
  }
  return { arms: specs.map((spec) => resolveArm(spec, config, infos.get(spec.model)?.max_tokens)), comparing: true };
}

export function armEstimates(arms: ResolvedArm[], items: { turns: number }[], repeat: number): ArmEstimate[] {
  const turns = items.reduce((sum, i) => sum + i.turns, 0);
  return arms.map((arm) =>
    estimateArmCost({ provider: arm.provider, model: arm.model, effort: arm.effort, maxOutputTokens: arm.maxOutputTokens, turns, items: items.length, repeat }),
  );
}

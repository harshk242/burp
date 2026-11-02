import { logger } from "../../logger";
import { resolveFilterChain } from "./policy-resolver";
import { executeJq } from "./jq-engine";

export interface NoiseReductionResult {
  data: unknown;
  filtersApplied: number;
  filtersSkipped: number;
  error?: string;
}

export async function applyNoiseReduction(
  toolName: string,
  data: unknown,
): Promise<NoiseReductionResult> {
  const filters = resolveFilterChain(toolName);

  if (filters.length === 0) {
    return { data, filtersApplied: 0, filtersSkipped: 0 };
  }

  let current = data;
  let filtersApplied = 0;
  let filtersSkipped = 0;

  for (const filter of filters) {
    const result = await executeJq(current, filter, {
      maxOutputChars: Infinity,
    });

    if (result.error) {
      logger.warn("TOOL", "noise_filter_skipped", {
        data: {
          tool: toolName,
          filter,
          error: result.error,
        },
      });
      filtersSkipped++;
      continue;
    }

    current = result.result;
    filtersApplied++;
  }

  return { data: current, filtersApplied, filtersSkipped };
}

import { logger, startTimer, type LogContext } from "../logger";
import { appConfig } from "../config";
import { artifactStore } from "./tools/artifact-store";
import { applyNoiseReduction } from "./tools/noise-reduction";
import { generatePreview } from "./tools/schema-preview";
import { validatePolicies } from "./tools/policy-resolver";

validatePolicies().then(({ valid, errors }) => {
  if (!valid) {
    logger.warn("STARTUP", "artifact_policy_validation_warnings", {
      data: { error_count: errors.length, errors },
    });
  }
});

export interface LargeOutputResult {
  output: string;
  rawChars: number;
  handling: "inline" | "truncated" | "noise_reduced" | "artifact";
  artifactId?: string;
}

export async function handleLargeOutput(
  toolName: string,
  toolInput: unknown,
  rawOutput: string,
  sessionId: string,
  ctx: LogContext,
): Promise<LargeOutputResult> {
  const cfg = appConfig.artifact;
  const rawChars = rawOutput.length;

  if (rawChars <= cfg.inline_max_chars) return { output: rawOutput, rawChars, handling: "inline" };

  let data: unknown;
  try {
    data = JSON.parse(rawOutput);
  } catch {
    const output =
      `[Output truncated from ${(rawOutput.length / 1024).toFixed(0)}KB — not valid JSON]\n` +
      rawOutput.slice(0, cfg.inline_max_chars);
    return { output, rawChars, handling: "truncated" };
  }

  const elapsed = startTimer();
  const { data: reduced, filtersApplied, filtersSkipped } = await applyNoiseReduction(toolName, data);
  const reducedStr = JSON.stringify(reduced);

  logger.info("TOOL", "noise_reduction_applied", {
    ctx,
    duration_ms: elapsed(),
    data: {
      tool: toolName,
      raw_chars: rawOutput.length,
      reduced_chars: reducedStr.length,
      filters_applied: filtersApplied,
      filters_skipped: filtersSkipped,
      reduction_pct: ((1 - reducedStr.length / rawOutput.length) * 100).toFixed(1),
    },
  });

  if (reducedStr.length <= cfg.inline_max_chars) return { output: reducedStr, rawChars, handling: "noise_reduced" };

  const artifactId = artifactStore.store(
    sessionId,
    toolName,
    toolInput,
    reduced,
    rawOutput.length,
  );
  const preview = generatePreview(
    artifactId,
    toolName,
    reduced,
    rawOutput.length / 1024,
    reducedStr.length / 1024,
  );

  logger.info("TOOL", "artifact_stored", {
    ctx,
    data: {
      artifact_id: artifactId,
      tool: toolName,
      raw_kb: (rawOutput.length / 1024).toFixed(1),
      stored_kb: (reducedStr.length / 1024).toFixed(1),
    },
  });

  return { output: JSON.stringify(preview), rawChars, handling: "artifact", artifactId };
}

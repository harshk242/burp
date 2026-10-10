/**
 * Large tool-output handling: noise reduction, then artifact storage.
 */

import { logger, startTimer, type LogContext } from "../logger";
import { appConfig } from "../config";
import { artifactStore } from "./tools/artifact-store";
import { applyNoiseReduction } from "./tools/noise-reduction";
import { generatePreview } from "./tools/schema-preview";
import { validatePolicies } from "./tools/policy-resolver";

// Validate artifact policies on module load (non-blocking)
validatePolicies().then(({ valid, errors }) => {
  if (!valid) {
    logger.warn("STARTUP", "artifact_policy_validation_warnings", {
      data: { error_count: errors.length, errors },
    });
  }
});

/**
 * ── Layer 3 of 3: Noise reduce, then artifact if still big (15K) ──
 *
 *   MCP server  (5MB)  → prevent process death / stdio pressure
 *   App manager (1MB)  → prevent LLM context blow-up
 *   handleLargeOutput (15K) → noise reduce, then artifact if still big  ← YOU ARE HERE
 *
 * Two-tier jq pipeline:
 *   Tier 1 — deterministic noise reduction (jq filters per platform/tool)
 *   Tier 2 — artifact storage + schema preview (read with inspect_artifact,
 *            which the tool catalog always declares)
 *
 * No silent truncation of JSON at any point. Data is either:
 *   - passed through (small enough)
 *   - noise-reduced and passed through (reduced below threshold)
 *   - stored as artifact with a schema preview (LLM writes jq to inspect)
 *
 * Replaces the old LLM-based maybeCompressOutput summarizer.
 */
export async function handleLargeOutput(
  toolName: string,
  rawOutput: string,
  sessionId: string,
  ctx: LogContext,
): Promise<string> {
  const cfg = appConfig.artifact;

  // Small output: pass through unchanged
  if (rawOutput.length <= cfg.inline_max_chars) return rawOutput;

  // Try to parse as JSON — non-JSON gets simple truncation
  // TODO: This truncation breaks structure for non-JSON text. Acceptable for
  // now since virtually all MCP tool outputs are JSON. Revisit if we add
  // tools that return large non-JSON payloads (FASTA, plain text, etc.).
  let data: unknown;
  try {
    data = JSON.parse(rawOutput);
  } catch {
    return (
      `[Output truncated from ${(rawOutput.length / 1024).toFixed(0)}KB — not valid JSON]\n` +
      rawOutput.slice(0, cfg.inline_max_chars)
    );
  }

  // Tier 1: Noise reduction (deterministic, no LLM)
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

  // Under threshold after noise reduction: return directly
  if (reducedStr.length <= cfg.inline_max_chars) return reducedStr;

  // Tier 2: Store as artifact, return schema preview
  const artifactId = artifactStore.store(
    sessionId,
    toolName,
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
      session_artifact_count: artifactStore.getSessionCount(sessionId),
    },
  });

  return JSON.stringify(preview);
}

/**
 * jq Execution Engine
 *
 * Thin wrapper around node-jq that provides timeout enforcement,
 * output size caps, and structured error handling.
 *
 * Used by both the noise-reduction pipeline (Tier 1) and the
 * inspect_artifact tool (Tier 2).
 */

import { run } from "node-jq";
import { writeFileSync, unlinkSync, rmdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appConfig } from "../../config";

export interface JqResult {
  result: unknown;
  truncated: boolean;
  error?: string;
}

/**
 * Execute a jq filter against JSON data.
 *
 * Writes data to a temp file, spawns jq via node-jq, and parses the output.
 * Enforces timeout and output size limits from config (or overrides).
 */
export async function executeJq(
  data: unknown,
  filter: string,
  opts?: {
    timeoutMs?: number;
    maxOutputChars?: number;
  },
): Promise<JqResult> {
  const cfg = appConfig.artifact;
  const timeoutMs = opts?.timeoutMs ?? cfg.jq_timeout_ms;
  const maxOutputChars = opts?.maxOutputChars ?? cfg.jq_max_output_chars;

  // Write data to a temp file — node-jq works best with file input
  // for large payloads (avoids shell argument size limits)
  let tempDir: string | null = null;
  let tempFile: string | null = null;

  try {
    tempDir = mkdtempSync(join(tmpdir(), "jq-"));
    tempFile = join(tempDir, "input.json");
    writeFileSync(tempFile, JSON.stringify(data), "utf-8");

    // Race jq execution against timeout
    const jqPromise = run(filter, tempFile, {
      output: "string",
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`jq execution timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    const rawOutput = (await Promise.race([
      jqPromise,
      timeoutPromise,
    ])) as string;

    // Enforce output size cap.
    // NOTE: Callers that need valid JSON output (noise-reduction) should pass
    // maxOutputChars: Infinity. This cap is primarily for inspect_artifact
    // where LLM-written filters could produce unbounded output.
    let truncated = false;
    let outputStr = rawOutput;
    if (maxOutputChars !== Infinity && outputStr.length > maxOutputChars) {
      outputStr = outputStr.slice(0, maxOutputChars);
      truncated = true;
    }

    // Parse the output as JSON
    let result: unknown;
    try {
      result = JSON.parse(outputStr);
    } catch {
      // If the output isn't valid JSON (e.g., truncated mid-stream or jq
      // produced raw text like a count), return as string.
      result = outputStr;
    }

    return { result, truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: null, truncated: false, error: `jq error: ${message}` };
  } finally {
    // Clean up temp files
    if (tempFile) {
      try {
        unlinkSync(tempFile);
      } catch {
        /* ignore cleanup errors */
      }
    }
    if (tempDir) {
      try {
        rmdirSync(tempDir);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

/**
 * Validate a jq filter expression without executing it on real data.
 * Runs `jq --null-input 'filter'` to check syntax.
 */
export async function validateJqFilter(
  filter: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    await run(filter, "null", { input: "string", output: "string" });
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}

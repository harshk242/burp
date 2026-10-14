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

  let tempDir: string | null = null;
  let tempFile: string | null = null;

  try {
    tempDir = mkdtempSync(join(tmpdir(), "jq-"));
    tempFile = join(tempDir, "input.json");
    writeFileSync(tempFile, JSON.stringify(data), "utf-8");

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

    return parseJqOutput(rawOutput, maxOutputChars);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: null, truncated: false, error: `jq error: ${message}` };
  } finally {
    if (tempFile) {
      try {
        unlinkSync(tempFile);
      } catch {
      }
    }
    if (tempDir) {
      try {
        rmdirSync(tempDir);
      } catch {
      }
    }
  }
}

/**
 * With --compact-output, jq prints each emitted value on its own line, so
 * the output is a stream of JSON documents.
 */
export function parseJqOutput(
  rawOutput: string,
  maxOutputChars: number = Infinity,
): JqResult {
  const lines = rawOutput.split("\n").filter((line) => line.length > 0);

  let kept = lines;
  let truncated = false;
  if (maxOutputChars !== Infinity) {
    let size = 0;
    let count = 0;
    for (const line of lines) {
      if (size + line.length > maxOutputChars) break;
      size += line.length + 1;
      count++;
    }
    if (count < lines.length) {
      if (count === 0) {
        return {
          result: null,
          truncated: true,
          error:
            `jq output exceeds ${maxOutputChars} chars in a single value — ` +
            "use a narrower filter (select fields, slice arrays, or stream with [])",
        };
      }
      kept = lines.slice(0, count);
      truncated = true;
    }
  }

  let values: unknown[];
  try {
    values = kept.map((line) => JSON.parse(line));
  } catch {
    return { result: kept.join("\n"), truncated };
  }

  const result = lines.length === 1 ? values[0] : values;
  return { result, truncated };
}

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

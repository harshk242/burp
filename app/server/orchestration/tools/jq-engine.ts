import childProcess from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { appConfig } from "../../config";

export interface JqResult {
  result: unknown;
  truncated: boolean;
  error?: string;
}

const require = createRequire(import.meta.url);
// Match node-jq's binary resolution, including its environment overrides.
const jqPath = process.env.JQ_PATH ?? process.env.npm_config_jq_path ??
  join(dirname(require.resolve("node-jq")), "..", "bin", "jq");
const hardOutputBytes = 64 * 1024 * 1024;
const stderrBytes = 64 * 1024;

async function runJq(
  filter: string,
  input: string,
  timeoutMs: number,
  maxBytes: number,
  signal?: AbortSignal,
  compileOnly = false,
): Promise<{ output: string; exceeded: boolean }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    // node-jq's output: "string" uses --compact-output without --raw-output.
    const child = childProcess.spawn(jqPath, [
      "--compact-output", ...(compileOnly ? ["--null-input"] : []), "--", filter,
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputSize = 0;
    let errorSize = 0;
    let exceeded = false;
    let failure: Error | undefined;
    const stop = (error?: Error) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const abort = () => stop(new Error("jq execution aborted"));
    const timer = setTimeout(() => {
      stop(new Error(`jq execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

    child.stdout.on("data", (chunk: Buffer) => {
      if (exceeded) return;
      const remaining = maxBytes - outputSize;
      chunks.push(chunk.subarray(0, remaining));
      outputSize += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) {
        exceeded = true;
        stop();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorSize === stderrBytes) {
        stop(new Error(Buffer.concat(errors).toString("utf8").trim()));
        return;
      }
      const remaining = stderrBytes - errorSize;
      errors.push(chunk.subarray(0, remaining));
      errorSize += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) {
        stop(new Error(Buffer.concat(errors).toString("utf8").trim()));
      }
    });
    child.on("error", (error) => { failure ??= error; });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") stop(error);
    });
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure) return reject(failure);
      if (!exceeded && code !== 0) {
        return reject(new Error(Buffer.concat(errors).toString("utf8").trim() ||
          `jq exited with ${exitSignal ?? code}`));
      }
      resolve({ output: Buffer.concat(chunks).toString("utf8"), exceeded });
    });
    child.stdin.end(input);
  });
}

export async function executeJq(
  data: unknown,
  filter: string,
  opts?: { timeoutMs?: number; maxOutputChars?: number; signal?: AbortSignal },
): Promise<JqResult> {
  const timeoutMs = opts?.timeoutMs ?? appConfig.artifact.jq_timeout_ms;
  const maxOutputChars = opts?.maxOutputChars ?? appConfig.artifact.jq_max_output_chars;
  // UTF-8 needs at most four bytes per character; headroom retains whole values.
  const requestedBytes = Math.max(0, maxOutputChars) * 4 + 65536;
  const maxBytes = Math.min(hardOutputBytes, requestedBytes);
  try {
    opts?.signal?.throwIfAborted();
    const { output, exceeded } = await runJq(
      filter, JSON.stringify(data), timeoutMs, maxBytes, opts?.signal,
    );
    if (exceeded && requestedBytes > hardOutputBytes) {
      throw new Error(`jq output exceeds ${hardOutputBytes} byte safety limit`);
    }
    return parseJqOutput(output, maxOutputChars);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: null, truncated: false, error: `jq error: ${message}` };
  }
}

export async function validateJqFilter(
  filter: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    // jq compiles both branches, but never evaluates the filter in this branch.
    await runJq(`if false then (\n${filter}\n) else empty end`, "",
      appConfig.artifact.jq_timeout_ms, stderrBytes, undefined, true);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
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

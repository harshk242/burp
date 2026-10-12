/**
 * Langfuse tracer setup: an isolated OpenTelemetry provider whose spans go to
 * Langfuse (nothing is registered globally), the shared LangfuseClient for
 * scores, and a bounded, idempotent shutdown that flushes both.
 *
 * Tracing is on only when `observability.langfuse.enabled` is true and both
 * keys are set; otherwise `initTracing` does nothing and TurnTrace is a no-op.
 */

import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { appConfig } from "../config";
import { logger } from "../logger";

type Env = Record<string, string | undefined>;

export const langfuseConfig = appConfig.observability.langfuse;

/** Config allows it and both keys are present. */
export function tracingConfigured(env: Env = process.env): boolean {
  return langfuseConfig.enabled && Boolean(env.LANGFUSE_PUBLIC_KEY) && Boolean(env.LANGFUSE_SECRET_KEY);
}

/** `GIT_SHA` env, else the checkout's short sha, else "unknown". */
export function resolveRelease(env: Env = process.env, gitShortSha: () => string | undefined = readGitShortSha): string {
  return env.GIT_SHA?.trim() || gitShortSha() || "unknown";
}

function readGitShortSha(): string | undefined {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: import.meta.dir, stderr: "ignore" });
    return proc.success ? proc.stdout.toString().trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

export const tracingEnvironment = langfuseConfig.environment;

let provider: NodeTracerProvider | null = null;
let scoreClient: LangfuseClient | null = null;
let shutdownPromise: Promise<void> | null = null;

/** True once a provider is installed (by `initTracing`). */
export function tracingActive(): boolean {
  return provider !== null && shutdownPromise === null;
}

/**
 * Installs the Langfuse tracer provider. Returns whether tracing is on.
 * `spanProcessors` replaces the Langfuse exporter (tests use an in-memory one;
 * they turn tracing on regardless of keys). Safe to call more than once.
 */
export function initTracing(options: { spanProcessors?: SpanProcessor[] } = {}): boolean {
  if (provider) return true;
  const custom = options.spanProcessors;
  if (!custom && !tracingConfigured()) {
    logger.info("TRACE", "tracing_disabled", {
      data: { enabled: langfuseConfig.enabled, keys_present: Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) },
    });
    return false;
  }
  try {
    const release = resolveRelease();
    const spanProcessors = custom ?? [new LangfuseSpanProcessor({ environment: tracingEnvironment, release })];
    provider = new NodeTracerProvider({ spanProcessors });
    setLangfuseTracerProvider(provider);
    shutdownPromise = null;
    if (!custom) {
      logger.info("TRACE", "tracing_enabled", {
        data: { environment: tracingEnvironment, release, base_url: process.env.LANGFUSE_BASE_URL },
      });
    }
    return true;
  } catch (error) {
    logger.warn("TRACE", "tracing_init_failed", { error: error instanceof Error ? error : String(error) });
    provider = null;
    return false;
  }
}

/** Shared client for scores (batched separately from spans); null when tracing is off. */
export function getScoreClient(): LangfuseClient | null {
  if (!tracingActive() || !tracingConfigured()) return null;
  scoreClient ??= new LangfuseClient();
  return scoreClient;
}

/**
 * Flushes and shuts down the span processor and the score client, bounded by
 * `timeoutMs`. Idempotent (a second call returns the first call's promise) and
 * never throws.
 */
export function shutdownTracing({ timeoutMs = 5000 }: { timeoutMs?: number } = {}): Promise<void> {
  shutdownPromise ??= runShutdown(timeoutMs);
  return shutdownPromise;
}

async function runShutdown(timeoutMs: number): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (provider) tasks.push(provider.shutdown());
  if (scoreClient) tasks.push(scoreClient.shutdown());
  if (tasks.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const result = await Promise.race([Promise.allSettled(tasks), timedOut]);
    if (result === "timeout") logger.warn("TRACE", "shutdown_timeout", { data: { timeout_ms: timeoutMs } });
  } catch (error) {
    logger.warn("TRACE", "shutdown_failed", { error: error instanceof Error ? error : String(error) });
  } finally {
    clearTimeout(timer);
  }
}

/** Tests only: drop the installed provider so another test can install its own. */
export function resetTracingForTests(): void {
  provider = null;
  scoreClient = null;
  shutdownPromise = null;
  setLangfuseTracerProvider(null);
}

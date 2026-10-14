import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { context, trace } from "@opentelemetry/api";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { defaultResource, resourceFromAttributes, type Resource } from "@opentelemetry/resources";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { appConfig } from "../config";
import { logger } from "../logger";
import { loadScoreConfigIds } from "./score-configs";

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

export const SERVICE_NAME = "burp";

export function tracingResource(release: string): Resource {
  return defaultResource().merge(resourceFromAttributes({ "service.name": SERVICE_NAME, "service.version": release }));
}

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
 *
 * `registerGlobal` (eval runner only) also registers the provider globally
 * with an AsyncLocalStorage context manager, so code inside a Langfuse
 * experiment task can read the task's active span (getActiveSpanId). The
 * server never relies on async context (turn-trace.ts design rules).
 *
 * With the real exporter, score config ids are loaded in the background
 * (`scoreConfigsReady`).
 */
export function initTracing(options: { spanProcessors?: SpanProcessor[]; registerGlobal?: boolean } = {}): boolean {
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
    provider = new NodeTracerProvider({ resource: tracingResource(release), spanProcessors });
    setLangfuseTracerProvider(provider);
    if (options.registerGlobal) provider.register({ propagator: null });
    shutdownPromise = null;
    if (!custom) {
      scoreConfigsLoad = loadScoreConfigIds(getScoreClient());
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

let scoreConfigsLoad: Promise<void> = Promise.resolve();

/** Resolves once the score config ids are loaded (or the load failed). Never rejects. */
export function scoreConfigsReady(): Promise<void> {
  return scoreConfigsLoad;
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
  trace.disable();
  context.disable();
}

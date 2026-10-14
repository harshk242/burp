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

export function tracingConfigured(env: Env = process.env): boolean {
  return langfuseConfig.enabled && Boolean(env.LANGFUSE_PUBLIC_KEY) && Boolean(env.LANGFUSE_SECRET_KEY);
}

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

export function tracingActive(): boolean {
  return provider !== null && shutdownPromise === null;
}

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

export function scoreConfigsReady(): Promise<void> {
  return scoreConfigsLoad;
}

export function getScoreClient(): LangfuseClient | null {
  if (!tracingActive() || !tracingConfigured()) return null;
  scoreClient ??= new LangfuseClient();
  return scoreClient;
}

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

export function resetTracingForTests(): void {
  provider = null;
  scoreClient = null;
  shutdownPromise = null;
  setLangfuseTracerProvider(null);
  trace.disable();
  context.disable();
}

import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { createTraceId } from "@langfuse/tracing";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { logger } from "../../logger";
import type { CallCost } from "../../usage";
import { getScoreClient, initTracing, resetTracingForTests, shutdownTracing, tracingActive } from "../langfuse";
import { TurnTrace, generationUsage, traceIdForTurn } from "../turn-trace";
import { LEVEL, STATUS_MESSAGE, TYPE, installMemoryTracing, json, one } from "./trace-test-utils";

const START = {
  turnId: "turn-1",
  sessionId: "session-1",
  userId: "user-1",
  userMessage: "What does BRCA1 do?",
  provider: "anthropic",
  model: "claude-sonnet-5-5",
};

const CALL: CallCost = {
  noCacheTokens: 100,
  cacheReadTokens: 2000,
  cacheWrite5mTokens: 300,
  cacheWrite1hTokens: 50,
  outputTokens: 40,
  promptTokens: 2450,
  tier: "base",
  inputCostPicoUsd: 200_000_000,
  cacheReadCostPicoUsd: 200_000_000,
  cacheWriteCostPicoUsd: 950_000_000,
  outputCostPicoUsd: 400_000_000,
  costPicoUsd: 1_750_000_000,
};

const RESULT = { call: CALL, finishReason: "stop", text: "answer", reasoning: "", toolCalls: [] };

afterEach(() => resetTracingForTests());
afterAll(() => resetTracingForTests());

describe("TurnTrace", () => {
  it("derives the trace id from the turn id like createTraceId", async () => {
    expect(traceIdForTurn("turn-1")).toBe(await createTraceId("turn-1"));
  });

  it("builds agent → generation / tool / retriever with attributes on every span", () => {
    const mem = installMemoryTracing();
    const trace = TurnTrace.start(START);
    expect(trace.traceId).toBe(traceIdForTurn("turn-1"));

    trace.generation({ iteration: 1, model: START.model, input: [{ role: "user", content: "hi" }] }).finish(RESULT);
    trace.tool({ name: "system__search_available_tools", input: { query: "q" }, asType: "retriever" }).finish({ output: ["a"] });
    trace.tool({ name: "uniprot__search", input: {}, asType: "tool" }).finish({ output: "{}", metadata: { raw_chars: 2 } });
    trace.end({ status: "ok", output: "answer" });

    const spans = mem.spans();
    expect(spans).toHaveLength(4);
    const root = one(spans, "chat-turn");
    expect(root.attributes[TYPE]).toBe("agent");
    expect(one(spans, "llm-call").attributes[TYPE]).toBe("generation");
    expect(one(spans, "system__search_available_tools").attributes[TYPE]).toBe("retriever");
    expect(one(spans, "uniprot__search").attributes[TYPE]).toBe("tool");
    for (const span of spans) {
      expect(span.spanContext().traceId).toBe(trace.traceId!);
      expect(span.resource.attributes["service.name"]).toBe("burp");
      expect(span.resource.attributes["service.version"]).toEqual(expect.any(String));
      expect(span.attributes["session.id"]).toBe("session-1");
      expect(span.attributes["user.id"]).toBe("user-1");
      expect(span.attributes["langfuse.trace.name"]).toBe("chat-turn");
      expect(span.attributes["langfuse.trace.tags"]).toEqual(["anthropic", "claude-sonnet-5-5"]);
      if (span !== root) expect(span.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    }
    expect(root.attributes["langfuse.observation.metadata.tool_calls_total"]).toBe("2");
    expect(root.attributes[LEVEL]).toBe("DEFAULT");
    expect(mem.openSpans()).toEqual([]);
    expect(mem.endedOnce()).toBe(true);
  });

  it("passes our usage and cost through on the generation", () => {
    const mem = installMemoryTracing();
    const trace = TurnTrace.start(START);
    trace.generation({ iteration: 1, model: START.model, input: [] }).finish({ ...RESULT, finishReason: "length" });
    trace.end({ status: "ok" });

    const gen = one(mem.spans(), "llm-call");
    expect(json(gen, "langfuse.observation.usage_details")).toEqual({
      input: 100,
      output: 40,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 350,
    });
    expect(json(gen, "langfuse.observation.cost_details")).toEqual(generationUsage(CALL).costDetails);
    expect(generationUsage(CALL).costDetails.total).toBeCloseTo(0.00175, 12);
    expect(gen.attributes["langfuse.observation.metadata.finish_reason"]).toBe("length");
  });

  it("a refused generation is ERROR and keeps usage", () => {
    const mem = installMemoryTracing();
    const trace = TurnTrace.start(START);
    trace.generation({ iteration: 1, model: START.model, input: [] }).fail({ ...RESULT, finishReason: "content-filter" }, "stop_reason=refusal");
    trace.end({ status: "error", errorCode: "refusal", message: "stop_reason=refusal" });

    const gen = one(mem.spans(), "llm-call");
    expect(gen.attributes[LEVEL]).toBe("ERROR");
    expect(gen.attributes["langfuse.observation.usage_details"]).toBeDefined();
    expect(one(mem.spans(), "chat-turn").attributes[LEVEL]).toBe("ERROR");
  });

  it.each([
    ["error", "ERROR"],
    ["aborted", "WARNING"],
    ["closed", "WARNING"],
  ] as const)("ending the turn as %s closes open children as %s", (status, level) => {
    const mem = installMemoryTracing();
    const trace = TurnTrace.start(START);
    const gen = trace.generation({ iteration: 1, model: START.model, input: [] });
    const tool = trace.tool({ name: "uniprot__search", input: {}, asType: "tool" });
    trace.end({ status, errorCode: status, message: `turn ${status}` });
    gen.finish(RESULT);
    tool.fail({ output: "x" }, "late");
    trace.end({ status: "ok" });

    const spans = mem.spans();
    expect(spans).toHaveLength(3);
    for (const span of spans) {
      expect(span.attributes[LEVEL]).toBe(level);
      expect(span.attributes[STATUS_MESSAGE]).toBe(`turn ${status}`);
    }
    expect(json(one(spans, "chat-turn"), "langfuse.observation.output")).toEqual({ error_code: status, message: `turn ${status}` });
    expect(mem.openSpans()).toEqual([]);
    expect(mem.endedOnce()).toBe(true);
  });

  it("a failed tool is ERROR and counted", () => {
    const mem = installMemoryTracing();
    const trace = TurnTrace.start(START);
    trace.tool({ name: "uniprot__search", input: {}, asType: "tool" }).fail({ output: "boom" }, "boom");
    trace.end({ status: "ok", output: "fine" });
    expect(one(mem.spans(), "uniprot__search").attributes[LEVEL]).toBe("ERROR");
    expect(one(mem.spans(), "chat-turn").attributes["langfuse.observation.metadata.tool_calls_failed"]).toBe("1");
  });

  it("is a no-op when tracing is off", () => {
    expect(tracingActive()).toBe(false);
    const trace = TurnTrace.start(START);
    expect(trace).toBe(TurnTrace.disabled);
    expect(trace.traceId).toBeNull();
    trace.setMetadata({ a: 1 });
    trace.generation({ iteration: 1, model: "m", input: [] }).finish(RESULT);
    trace.tool({ name: "t", input: {}, asType: "tool" }).fail({ output: "x" }, "x");
    trace.end({ status: "ok" });
    const mem = installMemoryTracing();
    TurnTrace.disabled.end({ status: "error" });
    expect(mem.spans()).toEqual([]);
  });

  it("tracer exceptions never propagate", () => {
    const mem = installMemoryTracing();
    const warn = spyOn(logger, "warn");
    const trace = TurnTrace.start(START);
    const root = (trace as unknown as { root: { update: () => void; end: () => void } }).root;
    spyOn(root, "update").mockImplementation(() => {
      throw new Error("update broke");
    });
    const gen = trace.generation({ iteration: 1, model: "m", input: [] });
    const genObs = (gen as unknown as { obs: { updateOtelSpanAttributes: () => void } }).obs;
    spyOn(genObs, "updateOtelSpanAttributes").mockImplementation(() => {
      throw new Error("attrs broke");
    });

    expect(() => {
      trace.setMetadata({ a: 1 });
      gen.firstChunk();
      gen.finish(RESULT);
      trace.end({ status: "ok" });
    }).not.toThrow();
    expect(warn.mock.calls.filter(([cat]) => cat === "TRACE").length).toBeGreaterThan(0);
    expect(mem.openSpans()).toEqual([]);
    warn.mockRestore();
  });

  it("start failures fall back to the disabled trace", async () => {
    installMemoryTracing();
    const tracing = await import("@langfuse/tracing");
    const { setLangfuseTracerProvider } = tracing;
    setLangfuseTracerProvider({
      getTracer: () => {
        throw new Error("no tracer");
      },
    });
    expect(TurnTrace.start(START)).toBe(TurnTrace.disabled);
  });
});

describe("shutdownTracing", () => {
  const hanging: SpanProcessor = {
    onStart: () => {},
    onEnd: () => {},
    forceFlush: () => new Promise(() => {}),
    shutdown: () => new Promise(() => {}),
  };

  it("is bounded, idempotent and logs the timeout", async () => {
    initTracing({ spanProcessors: [hanging] });
    const warn = spyOn(logger, "warn");
    const started = performance.now();
    const first = shutdownTracing({ timeoutMs: 50 });
    expect(shutdownTracing({ timeoutMs: 50 })).toBe(first);
    await first;
    expect(performance.now() - started).toBeLessThan(1000);
    expect(warn.mock.calls.some(([cat, event]) => cat === "TRACE" && event === "shutdown_timeout")).toBe(true);
    expect(tracingActive()).toBe(false);
    warn.mockRestore();
  });

  it("reports every rejected shutdown component without throwing", async () => {
    const env = { pub: process.env.LANGFUSE_PUBLIC_KEY, sec: process.env.LANGFUSE_SECRET_KEY };
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    try {
      initTracing({ spanProcessors: [{ ...hanging, shutdown: () => Promise.reject(new Error("export failed")) }] });
      const client = getScoreClient();
      expect(client).not.toBeNull();
      const clientShutdown = spyOn(client!, "shutdown").mockRejectedValue(new Error("score flush failed"));
      const warn = spyOn(logger, "warn").mockImplementation(() => {});
      try {
        await expect(shutdownTracing({ timeoutMs: 200 })).resolves.toBeUndefined();
        expect(clientShutdown).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls.filter(([, event]) => event === "shutdown_failed").map(([, , opts]) => opts?.data?.component).sort())
          .toEqual(["score_client", "tracer_provider"]);
      } finally { warn.mockRestore(); clientShutdown.mockRestore(); }
    } finally {
      process.env.LANGFUSE_PUBLIC_KEY = env.pub;
      process.env.LANGFUSE_SECRET_KEY = env.sec;
      if (env.pub === undefined) delete process.env.LANGFUSE_PUBLIC_KEY;
      if (env.sec === undefined) delete process.env.LANGFUSE_SECRET_KEY;
    }
  });

  it("reports a rejection that arrives after the shutdown timeout", async () => {
    let reject!: (error: Error) => void;
    initTracing({ spanProcessors: [{ ...hanging, shutdown: () => new Promise((_, fail) => { reject = fail; }) }] });
    const warn = spyOn(logger, "warn").mockImplementation(() => {});
    try {
      await shutdownTracing({ timeoutMs: 5 });
      reject(new Error("late export failure"));
      await Bun.sleep(1);
      expect(warn.mock.calls.some(([, event]) => event === "shutdown_timeout")).toBe(true);
      expect(warn.mock.calls.some(([, event, opts]) => event === "shutdown_failed" && opts?.data?.component === "tracer_provider")).toBe(true);
    } finally { warn.mockRestore(); }
  });

  it("does nothing when tracing never started", async () => {
    await expect(shutdownTracing()).resolves.toBeUndefined();
  });
});

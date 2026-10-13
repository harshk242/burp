/**
 * Turn tracing through processChat: the trace tree of a real turn (mock model,
 * spied MCP call and tool search), the trace id on the chat_turns row, and the
 * levels / no-open-spans guarantee for refusal, stream failure, abort mid-stream
 * and mid-tool, the consumer calling return(), and a server shutdown. Also the
 * turn signals (final finish reason, tool error count) on the row and the
 * online scores computed from it.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { loadLLMConfig, sanitizeToolName, type ModelOptions } from "../llm";
import { mcpManager } from "../mcp/manager";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";
import { hybridSearch } from "../search";
import * as langfuse from "../observability/langfuse";
import { resetTracingForTests } from "../observability/langfuse";
import { turnSignals } from "../observability/turn-signals";
import { traceIdForTurn } from "../observability/turn-trace";
import { LEVEL, STATUS_MESSAGE, TYPE, byName, installMemoryTracing, json, one } from "../observability/__tests__/trace-test-utils";
import { SEARCH_TOOL_NAME } from "../orchestration/context/tool-catalog";
import type { StreamEvent } from "../orchestration/types";

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

const USER_ID = "22222222-2222-4222-8222-222222222222";
const { provider } = loadLLMConfig();
const TOOL_FULL_NAME = [...ALWAYS_LOADED_TOOLS][0]!;
const TOOL_KEY = sanitizeToolName(TOOL_FULL_NAME, provider);
const SEARCH_KEY = sanitizeToolName(SEARCH_TOOL_NAME, provider);

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

let model: MockLanguageModelV4;
let transport: ModelOptions["fetch"];
mock.module("../llm/provider", () => ({
  getChatModel: (options?: ModelOptions) => {
    transport = options?.fetch;
    return model;
  },
  getTitleModel: () => model,
}));

const { processChat } = await import("../orchestration/chat-v2");
const { abortActiveTurns } = await import("../orchestration/chat-turn");

const usage = {
  inputTokens: { total: 1000, noCache: 100, cacheRead: 800, cacheWrite: 100 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

const finish = (reason: "tool-calls" | "stop" | "content-filter" | "length"): StreamPart => ({
  type: "finish",
  finishReason: { unified: reason, raw: reason === "content-filter" ? "refusal" : reason },
  usage,
});
const toolCall = (id: string, name = TOOL_KEY, input = "{}"): StreamPart => ({ type: "tool-call", toolCallId: id, toolName: name, input });
const text = (delta: string): StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta },
  { type: "text-end", id: "t" },
];

function streamOf(parts: StreamPart[]): ReadableStream<StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

type StreamFactory = (signal?: AbortSignal) => ReadableStream<StreamPart> | Promise<ReadableStream<StreamPart>>;
function scriptedModel(calls: StreamFactory[]) {
  let n = 0;
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const make = calls[n++] ?? (() => streamOf([...text("final answer"), finish("stop")]));
      const stream = await make(abortSignal);
      await transport?.("https://model.test/", { signal: abortSignal });
      return { stream };
    },
  });
}

/** A call that streams some text, then hangs until aborted. */
function hangingStream(onStarted: () => void): StreamFactory {
  return (signal) => new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "text-start", id: "t" });
      controller.enqueue({ type: "text-delta", id: "t", delta: "partial" });
      signal?.addEventListener("abort", () => controller.error(signal.reason));
      setTimeout(onStarted, 0);
    },
  });
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const turnRow = (sessionId: string) => q.chatTurnQueries.findBySessionId(sessionId)[0]!;
const mem = installMemoryTracing();

beforeEach(() => {
  spyOn(globalThis, "fetch").mockImplementation((async () => new Response(null)) as unknown as typeof fetch);
  q.userQueries.create(USER_ID, "clerk_t", "t@example.com", null, null, "user", null, null);
  const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
  toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
  mem.reset();
});

afterEach(() => {
  mock.restore();
  toolRegistry.clear();
  for (const table of ["usage_events", "model_transcript", "chat_turns", "messages", "chat_sessions", "users"]) {
    t.sqlite.run(`DELETE FROM ${table}`);
  }
});

afterAll(() => {
  resetTracingForTests();
  t.sqlite.close();
});

/** Every span ended exactly once and nothing is left open. */
function expectClosed() {
  expect(mem.openSpans()).toEqual([]);
  expect(mem.endedOnce()).toBe(true);
}

describe("turn tracing", () => {
  it("traces a 2-iteration turn: generations, a tool span and a retriever span under the root", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue({ content: '{"ok":true}', isError: false });
    spyOn(hybridSearch, "search").mockResolvedValue([]);
    model = scriptedModel([
      () => streamOf([...text("Let me look."), toolCall("c1"), toolCall("c2", SEARCH_KEY, '{"query":"clinvar variant"}'), finish("tool-calls")]),
    ]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "What is BRCA1?"));
    expect(events.some((e) => e.type === "done")).toBe(true);

    const row = turnRow(sessionId);
    expect(row.trace_id).toBe(traceIdForTurn(row.id));
    const spans = mem.spans();
    const root = one(spans, "chat-turn");
    const gens = byName(spans, "llm-call");
    expect(gens).toHaveLength(2);
    expect(one(spans, TOOL_FULL_NAME).attributes[TYPE]).toBe("tool");
    expect(one(spans, SEARCH_TOOL_NAME).attributes[TYPE]).toBe("retriever");
    expect(spans).toHaveLength(5);
    for (const span of spans) {
      expect(span.spanContext().traceId).toBe(row.trace_id!);
      expect(span.attributes["session.id"]).toBe(sessionId);
      expect(span.attributes["user.id"]).toBe(USER_ID);
      expect(span.attributes["langfuse.trace.name"]).toBe("chat-turn");
      if (span !== root) expect(span.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    }

    // Root: question in, answer out, turn metadata.
    expect(root.attributes["langfuse.observation.input"]).toBe("What is BRCA1?");
    expect(root.attributes["langfuse.observation.output"]).toBe("final answer");
    expect(root.attributes["langfuse.observation.metadata.turn_id"]).toBe(row.id);
    expect(root.attributes["langfuse.observation.metadata.iterations"]).toBe("2");
    expect(root.attributes[LEVEL]).toBe("DEFAULT");

    // Generations: delta inputs, tool calls out, our usage and cost.
    const [g1, g2] = [...gens].sort((a, b) => Number(a.attributes["langfuse.observation.metadata.iteration"]) - Number(b.attributes["langfuse.observation.metadata.iteration"]));
    expect(json(g1!, "langfuse.observation.input")).toEqual([{ role: "user", content: "What is BRCA1?" }]);
    const g2Input = json(g2!, "langfuse.observation.input") as { role: string }[];
    expect(g2Input.map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect((json(g1!, "langfuse.observation.output") as { tool_calls: { name: string }[] }).tool_calls.map((c) => c.name)).toEqual([TOOL_KEY, SEARCH_KEY]);
    expect(json(g1!, "langfuse.observation.usage_details")).toEqual({ input: 100, output: 20, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 });
    expect(g2!.attributes["langfuse.observation.metadata.finish_reason"]).toBe("stop");
    expect(g1!.attributes["langfuse.observation.completion_start_time"]).toBeDefined();

    // Generation costs add up to the ledger's turn cost (µUSD rounded up once).
    const costUsd = gens.reduce((sum, g) => sum + (json(g, "langfuse.observation.cost_details") as { total: number }).total, 0);
    const ledger = t.sqlite.query<{ cost_microusd: number }, []>("SELECT cost_microusd FROM usage_events").get()!;
    expect(Math.ceil(costUsd * 1e6 - 1e-6)).toBe(ledger.cost_microusd);

    // Tool span: what the model saw (with fetched_at) plus server and size.
    const tool = one(spans, TOOL_FULL_NAME);
    expect(String(tool.attributes["langfuse.observation.output"])).toMatch(/^\[fetched_at: .*\]\n\{"ok":true\}$/);
    expect(tool.attributes["langfuse.observation.metadata.raw_chars"]).toBe("11");
    expect(tool.attributes["langfuse.observation.metadata.stored_as_artifact"]).toBe("false");
    expect(json(one(spans, SEARCH_TOOL_NAME), "langfuse.observation.output")).toEqual([]);
    expectClosed();
  });

  it("a tool error and a failed search are ERROR spans; the turn still succeeds", async () => {
    spyOn(mcpManager, "callTool").mockRejectedValue(new Error("server down"));
    spyOn(hybridSearch, "search").mockRejectedValue(new Error("index broken"));
    model = scriptedModel([() => streamOf([toolCall("c1"), toolCall("c2", SEARCH_KEY, '{"query":"x"}'), finish("tool-calls")])]);

    await collect(processChat(crypto.randomUUID(), USER_ID, "hi"));

    const spans = mem.spans();
    expect(one(spans, TOOL_FULL_NAME).attributes[LEVEL]).toBe("ERROR");
    expect(one(spans, SEARCH_TOOL_NAME).attributes[LEVEL]).toBe("ERROR");
    expect(one(spans, SEARCH_TOOL_NAME).attributes[STATUS_MESSAGE]).toBe("index broken");
    const root = one(spans, "chat-turn");
    expect(root.attributes[LEVEL]).toBe("DEFAULT");
    expect(root.attributes["langfuse.observation.metadata.tool_calls_failed"]).toBe("2");
    expectClosed();
  });

  it("refusal: generation ERROR with usage, root ERROR", async () => {
    model = scriptedModel([() => streamOf([finish("content-filter")])]);
    await collect(processChat(crypto.randomUUID(), USER_ID, "hi"));

    const gen = one(mem.spans(), "llm-call");
    expect(gen.attributes[LEVEL]).toBe("ERROR");
    expect(json(gen, "langfuse.observation.usage_details")).toMatchObject({ output: 20 });
    expect((json(gen, "langfuse.observation.cost_details") as { total: number }).total).toBeGreaterThan(0);
    const root = one(mem.spans(), "chat-turn");
    expect(root.attributes[LEVEL]).toBe("ERROR");
    expect(json(root, "langfuse.observation.output")).toMatchObject({ error_code: "refusal" });
    expectClosed();
  });

  it("stream failure: generation and root ERROR", async () => {
    model = scriptedModel([() => streamOf([{ type: "error", error: new Error("overloaded") }])]);
    await collect(processChat(crypto.randomUUID(), USER_ID, "hi"));

    expect(one(mem.spans(), "llm-call").attributes[LEVEL]).toBe("ERROR");
    const root = one(mem.spans(), "chat-turn");
    expect(root.attributes[LEVEL]).toBe("ERROR");
    expect(json(root, "langfuse.observation.output")).toMatchObject({ error_code: "provider_error" });
    expectClosed();
  });

  it("abort mid-stream: generation and root WARNING", async () => {
    const turn = new AbortController();
    model = scriptedModel([hangingStream(() => turn.abort())]);
    await collect(processChat(crypto.randomUUID(), USER_ID, "hi", turn.signal));

    const gen = one(mem.spans(), "llm-call");
    expect(gen.attributes[LEVEL]).toBe("WARNING");
    expect(one(mem.spans(), "chat-turn").attributes[LEVEL]).toBe("WARNING");
    // The cut-off call carries the ledger's estimate, so the trace adds up to usage_events.
    expect(gen.attributes["langfuse.observation.metadata.usage_estimated"]).toBe("true");
    const total = (json(gen, "langfuse.observation.cost_details") as { total: number }).total;
    const ledger = t.sqlite.query<{ cost_microusd: number; usage_estimated: number }, []>("SELECT cost_microusd, usage_estimated FROM usage_events").get()!;
    expect(ledger.usage_estimated).toBe(1);
    expect(Math.ceil(total * 1e6 - 1e-6)).toBe(ledger.cost_microusd);
    expectClosed();
  });

  it("abort mid-tool: tool span and root WARNING", async () => {
    const turn = new AbortController();
    spyOn(mcpManager, "callTool").mockImplementation(((_s: string, _n: string, _a: unknown, _o: unknown, signal?: AbortSignal) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason));
        setTimeout(() => turn.abort(), 0);
      })) as unknown as typeof mcpManager.callTool);
    model = scriptedModel([() => streamOf([toolCall("c1"), finish("tool-calls")])]);
    await collect(processChat(crypto.randomUUID(), USER_ID, "hi", turn.signal));

    const spans = mem.spans();
    // The call itself finished: no level set (DEFAULT).
    expect(one(spans, "llm-call").attributes[LEVEL]).toBeUndefined();
    expect(one(spans, TOOL_FULL_NAME).attributes[LEVEL]).toBe("WARNING");
    expect(one(spans, "chat-turn").attributes[LEVEL]).toBe("WARNING");
    expectClosed();
  });

  it("consumer return(): open generation and root WARNING (closed)", async () => {
    model = scriptedModel([hangingStream(() => {})]);
    const gen = processChat(crypto.randomUUID(), USER_ID, "hi");
    for await (const event of gen) {
      if (event.type === "text") break; // calls gen.return()
    }

    expect(one(mem.spans(), "llm-call").attributes[LEVEL]).toBe("WARNING");
    const root = one(mem.spans(), "chat-turn");
    expect(root.attributes[LEVEL]).toBe("WARNING");
    expect(root.attributes["langfuse.observation.metadata.status"]).toBe("closed");
    expectClosed();
  });

  it("shutdown aborts a running turn and waits for its trace to end", async () => {
    let started!: () => void;
    const streaming = new Promise<void>((resolve) => (started = resolve));
    model = scriptedModel([hangingStream(() => started())]);
    const sessionId = crypto.randomUUID();
    const done = collect(processChat(sessionId, USER_ID, "hi"));
    await streaming;

    expect(await abortActiveTurns(2000)).toBe(0);
    await done;
    expect(turnRow(sessionId)).toMatchObject({ status: "aborted", error_message: "Server shutting down" });
    expect(one(mem.spans(), "chat-turn").attributes[LEVEL]).toBe("WARNING");
    expectClosed();
  });
});

describe("turn signals", () => {
  /** Score bodies sent through the shared score client. */
  function captureScores() {
    const scores: Record<string, unknown>[] = [];
    const client = { score: { create: (body: Record<string, unknown>) => scores.push(body) } };
    spyOn(langfuse, "getScoreClient").mockReturnValue(client as never);
    return scores;
  }

  it("a tool error and a failed search, then a provider failure: the failed row keeps both errors", async () => {
    const scores = captureScores();
    spyOn(mcpManager, "callTool").mockRejectedValue(new Error("server down"));
    spyOn(hybridSearch, "search").mockRejectedValue(new Error("index broken"));
    model = scriptedModel([
      () => streamOf([toolCall("c1"), toolCall("c2", SEARCH_KEY, '{"query":"x"}'), finish("tool-calls")]),
      () => streamOf([{ type: "error", error: new Error("overloaded") }]),
    ]);

    const sessionId = crypto.randomUUID();
    await collect(processChat(sessionId, USER_ID, "hi"));

    const row = turnRow(sessionId);
    expect(row).toMatchObject({ status: "error", error_code: "provider_error", tool_error_count: 2, final_finish_reason: "tool-calls" });
    expect(turnSignals(row)).toEqual({ turn_outcome: "provider_error", answer_truncated: false, tool_error_count: 2 });
    expect(scores.map((sc) => [sc.name, sc.value])).toEqual([
      ["turn_outcome", "provider_error"],
      ["answer_truncated", 0],
      ["tool_error_count", 2],
    ]);
    for (const sc of scores) {
      expect(sc.traceId).toBe(row.trace_id!);
      expect(sc.environment).toBe(langfuse.tracingEnvironment);
    }
  });

  it("a truncated answer stays ok but reports answer_truncated", async () => {
    const scores = captureScores();
    model = scriptedModel([() => streamOf([...text("cut o"), finish("length")])]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi"));
    expect(events.some((e) => e.type === "done")).toBe(true);

    const row = turnRow(sessionId);
    expect(row).toMatchObject({ status: "ok", final_finish_reason: "length", tool_error_count: 0 });
    expect(turnSignals(row)).toEqual({ turn_outcome: "ok", answer_truncated: true, tool_error_count: 0 });
    expect(scores.find((sc) => sc.name === "answer_truncated")?.value).toBe(1);
  });
});

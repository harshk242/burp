import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { loadLLMConfig, sanitizeToolName, type ModelOptions } from "../llm";
import { mcpManager } from "../mcp/manager";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";
import * as langfuse from "../observability/langfuse";
import { resetTracingForTests } from "../observability/langfuse";
import { installMemoryTracing, one } from "../observability/__tests__/trace-test-utils";
import { SharedCostBudget, type CostBudget } from "../orchestration/cost-budget";
import { UserCostBudgetRegistry } from "../orchestration/user-cost-budget";
import type { StreamEvent } from "../orchestration/types";

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

const USER_ID = "33333333-3333-4333-8333-333333333333";
const { provider } = loadLLMConfig();
const TOOL_FULL_NAME = [...ALWAYS_LOADED_TOOLS][0]!;
const TOOL_KEY = sanitizeToolName(TOOL_FULL_NAME, provider);

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

let model: MockLanguageModelV4;
let transport: ModelOptions["fetch"];
let modelCalls = 0;
mock.module("../llm/provider", () => ({
  getChatModel: (options?: ModelOptions) => {
    transport = options?.fetch;
    return model;
  },
  getTitleModel: () => model,
}));

const { processChat } = await import("../orchestration/chat-v2");

const usage = {
  inputTokens: { total: 1000, noCache: 100, cacheRead: 800, cacheWrite: 100 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};
const finish = (reason: "tool-calls" | "stop"): StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });
const text = (delta: string): StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta },
  { type: "text-end", id: "t" },
];
const streamOf = (parts: StreamPart[]) =>
  new ReadableStream<StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
type StreamFactory = (signal?: AbortSignal) => ReadableStream<StreamPart>;
function scriptedModel(calls: StreamFactory[]) {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const make = calls[modelCalls++] ?? (() => streamOf([...text("final answer"), finish("stop")]));
      const stream = make(abortSignal);
      await transport?.("https://model.test/", { signal: abortSignal });
      return { stream };
    },
  });
}
const toolTurn: StreamFactory = () => streamOf([{ type: "tool-call", toolCallId: "c1", toolName: TOOL_KEY, input: "{}" }, finish("tool-calls")]);
const hanging = (onStarted: () => void): StreamFactory => (signal) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "text-start", id: "t" });
      controller.enqueue({ type: "text-delta", id: "t", delta: "partial" });
      signal?.addEventListener("abort", () => controller.error(signal.reason));
      setTimeout(onStarted, 0);
    },
  });

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function recordingBudget(limitPico = Number.MAX_SAFE_INTEGER) {
  const shared = new SharedCostBudget(limitPico);
  const charges: number[] = [];
  const budget: CostBudget = {
    charge: (pico) => {
      charges.push(pico);
      shared.charge(pico);
    },
    check: () => shared.check(),
  };
  return { budget, charges, shared };
}

function captureScores() {
  const scores: Record<string, unknown>[] = [];
  spyOn(langfuse, "getScoreClient").mockReturnValue({ score: { create: (b: Record<string, unknown>) => scores.push(b) } } as never);
  return scores;
}

const ledgerMicrousd = () =>
  t.sqlite.query<{ cost_microusd: number }, []>("SELECT cost_microusd FROM usage_events").get()!.cost_microusd;
const turnRow = (sessionId: string) => q.chatTurnQueries.findBySessionId(sessionId)[0]!;
const mem = installMemoryTracing();

beforeEach(() => {
  modelCalls = 0;
  spyOn(globalThis, "fetch").mockImplementation((async () => new Response(null)) as unknown as typeof fetch);
  spyOn(mcpManager, "callTool").mockResolvedValue({ content: '{"ok":true}', isError: false });
  q.userQueries.create(USER_ID, "clerk_b", "b@example.com", null, null, "user", null, null);
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

describe("cost budget", () => {
  it("a normal turn charges each call once and nothing extra in finally", async () => {
    const { budget, charges } = recordingBudget();
    model = scriptedModel([toolTurn]);
    const events = await collect(processChat(crypto.randomUUID(), USER_ID, "hi", undefined, { costBudget: budget }));
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(charges).toHaveLength(2);
    expect(charges.every((c) => c > 0)).toBe(true);
    const total = charges.reduce((a, b) => a + b, 0);
    expect(Math.ceil(total / 1e6)).toBe(ledgerMicrousd());
  });

  it("a call cut off mid-stream: the reconciliation charges its estimate exactly once", async () => {
    const { budget, charges } = recordingBudget();
    const turn = new AbortController();
    model = scriptedModel([toolTurn, hanging(() => turn.abort())]);
    await collect(processChat(crypto.randomUUID(), USER_ID, "hi", turn.signal, { costBudget: budget }));

    expect(charges).toHaveLength(2);
    expect(charges[1]!).toBeGreaterThan(0);
    const ledger = t.sqlite.query<{ cost_microusd: number; usage_estimated: number }, []>("SELECT cost_microusd, usage_estimated FROM usage_events").get()!;
    expect(ledger.usage_estimated).toBe(1);
    expect(Math.ceil((charges[0]! + charges[1]!) / 1e6)).toBe(ledger.cost_microusd);
  });

  it("an exhausted budget fails the turn before any model call: budget_exceeded, no scores, tagged trace", async () => {
    const scores = captureScores();
    const { budget } = recordingBudget(0);
    model = scriptedModel([]);
    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi", undefined, { costBudget: budget }));

    expect(modelCalls).toBe(0);
    expect(events.find((e) => e.type === "error")?.data).toMatchObject({ code: "budget_exceeded" });
    expect(turnRow(sessionId)).toMatchObject({ status: "error", error_code: "budget_exceeded" });
    expect(scores).toEqual([]);
    const root = one(mem.spans(), "chat-turn");
    expect(root.attributes["langfuse.trace.tags"]).toContain("budget_exceeded");
  });

  it("a budget used up mid-turn stops before the next call; what ran is billed", async () => {
    const { budget, charges, shared } = recordingBudget(1);
    model = scriptedModel([toolTurn]);
    const sessionId = crypto.randomUUID();
    await collect(processChat(sessionId, USER_ID, "hi", undefined, { costBudget: budget }));
    expect(modelCalls).toBe(1);
    expect(charges).toHaveLength(1);
    expect(shared.exhausted).toBe(true);
    expect(turnRow(sessionId)).toMatchObject({ status: "error", error_code: "budget_exceeded", iterations: 1 });
    expect(Math.ceil(charges[0]! / 1e6)).toBe(ledgerMicrousd());
  });
});

describe("user cost budget integration", () => {
  it("shares charged spend across simultaneous turns in different sessions", async () => {
    const registry = new UserCostBudgetRegistry(q.usageEventQueries);
    const limits = { daily_cost_limit_microusd: 1, monthly_cost_limit_microusd: -1 };
    const firstBudget = registry.acquire(USER_ID, limits);
    const firstSession = crypto.randomUUID();
    model = scriptedModel([toolTurn]);
    const first = processChat(firstSession, USER_ID, "hi", undefined, { costBudget: firstBudget });
    const secondBudget = registry.acquire(USER_ID, limits);
    const secondSession = crypto.randomUUID();
    try {
      let event;
      do {
        event = await first.next();
      } while (!event.done && event.value.type !== "tool_end");
      expect(event.done).toBe(false);
      expect(firstBudget.spentPicoUsd).toBeGreaterThan(1e6);
      expect(q.usageEventQueries.getTotalsForDate(USER_ID).cost_microusd).toBe(0);
      const second = await collect(processChat(secondSession, USER_ID, "hi", undefined, { costBudget: secondBudget }));
      expect(modelCalls).toBe(1);
      expect(second.find((e) => e.type === "error")?.data).toMatchObject({ code: "budget_exceeded" });
      expect(turnRow(secondSession)).toMatchObject({ status: "error", error_code: "budget_exceeded" });
    } finally {
      await first.return(undefined);
      firstBudget.release();
      secondBudget.release();
    }
    expect(turnRow(firstSession).status).toBe("aborted");
    expect(() => registry.acquire(USER_ID, { ...limits, daily_cost_limit_microusd: ledgerMicrousd() + 1 }).check()).not.toThrow();
  });

  it("stops a turn after its remaining daily budget is spent and persists the SSE failure", async () => {
    const registry = new UserCostBudgetRegistry(q.usageEventQueries);
    const budget = registry.acquire(USER_ID, { daily_cost_limit_microusd: 1, monthly_cost_limit_microusd: -1 });
    model = scriptedModel([toolTurn]);
    const sessionId = crypto.randomUUID();
    let events: StreamEvent[] = [];
    try {
      events = await collect(processChat(sessionId, USER_ID, "hi", undefined, {
        costBudget: budget, onUsageRecorded: () => budget.release(),
      }));
    } finally {
      budget.release();
    }
    expect(modelCalls).toBe(1);
    expect(events.find((event) => event.type === "error")?.data).toMatchObject({
      code: "budget_exceeded", error: "You have used your daily dollar budget. Limits reset at midnight UTC.",
    });
    expect(turnRow(sessionId)).toMatchObject({ status: "error", error_code: "budget_exceeded" });
    expect(ledgerMicrousd()).toBeGreaterThan(1);
    expect(() => registry.acquire(USER_ID, { daily_cost_limit_microusd: ledgerMicrousd() + 1, monthly_cost_limit_microusd: -1 }).check()).not.toThrow();
  });

  it("settles recorded spend before yielding done so another active turn does not count it twice", async () => {
    const registry = new UserCostBudgetRegistry(q.usageEventQueries);
    const limits = { daily_cost_limit_microusd: 1_000_000, monthly_cost_limit_microusd: -1 };
    const first = registry.acquire(USER_ID, limits);
    const second = registry.acquire(USER_ID, limits);
    model = scriptedModel([]);
    const turn = processChat(crypto.randomUUID(), USER_ID, "hi", undefined, {
      costBudget: first, onUsageRecorded: () => first.release(),
    });
    try {
      for await (const event of turn) {
        if (event.type !== "done") continue;
        second.charge((limits.daily_cost_limit_microusd - ledgerMicrousd() - 1) * 1e6);
        expect(() => second.check()).not.toThrow();
        break;
      }
    } finally {
      first.release();
      second.release();
    }
  });
});

describe("traceParent", () => {
  it("nests the turn under the given span and scores the turn's own observation", async () => {
    const scores = captureScores();
    const parent = { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331" };
    model = scriptedModel([]);
    const sessionId = crypto.randomUUID();
    await collect(processChat(sessionId, USER_ID, "hi", undefined, { traceParent: parent }));

    const root = one(mem.spans(), "chat-turn");
    expect(root.spanContext().traceId).toBe(parent.traceId);
    expect(root.parentSpanContext?.spanId).toBe(parent.spanId);
    expect(root.attributes["langfuse.trace.name"]).toBeUndefined();
    for (const span of mem.spans()) expect(span.spanContext().traceId).toBe(parent.traceId);
    expect(turnRow(sessionId).trace_id).toBe(parent.traceId);

    const rootId = root.spanContext().spanId;
    expect(scores.map((s) => [s.traceId, s.observationId, s.id])).toEqual([
      [parent.traceId, rootId, `${parent.traceId}-${rootId}-turn_outcome`],
      [parent.traceId, rootId, `${parent.traceId}-${rootId}-answer_truncated`],
      [parent.traceId, rootId, `${parent.traceId}-${rootId}-tool_error_count`],
    ]);
  });
});

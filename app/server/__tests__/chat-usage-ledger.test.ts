import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { loadLLMConfig, sanitizeToolName } from "../llm";
import { mcpManager } from "../mcp/manager";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";
import type { StreamEvent } from "../orchestration/types";
import { priceCall, summarizeTurnCost } from "../usage";

type LanguageModelV4StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

const USER_ID = "22222222-2222-4222-8222-222222222222";
const TOOL_FULL_NAME = [...ALWAYS_LOADED_TOOLS][0]!;
const TOOL_KEY = sanitizeToolName(TOOL_FULL_NAME, loadLLMConfig().provider);

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

let model: MockLanguageModelV4;
mock.module("../llm/provider", () => ({ getChatModel: () => model, getTitleModel: () => model }));

const { processChat } = await import("../orchestration/chat-v2");

function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function finish(
  reason: "tool-calls" | "stop",
  input: { noCache: number; cacheRead: number; cacheWrite: number },
  cacheCreation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number }
): LanguageModelV4StreamPart {
  return {
    type: "finish",
    finishReason: { unified: reason, raw: reason },
    usage: {
      inputTokens: { total: input.noCache + input.cacheRead + input.cacheWrite, ...input },
      outputTokens: { total: 50, text: 50, reasoning: 0 },
    },
    providerMetadata: cacheCreation ? { anthropic: { usage: { cache_creation: cacheCreation } } } : undefined,
  };
}

function scriptedModel(calls: LanguageModelV4StreamPart[][]) {
  let n = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const parts = calls[n++];
      if (!parts) throw new Error("provider down");
      return { stream: streamOf(parts) };
    },
  });
}

const toolCallPart = (id: string): LanguageModelV4StreamPart => ({ type: "tool-call", toolCallId: id, toolName: TOOL_KEY, input: "{}" });

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

beforeEach(() => {
  q.userQueries.create(USER_ID, "clerk_ledger", "ledger@example.com", null, null, "user", null, null);
  const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
  toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
});

afterEach(() => {
  mock.restore();
  toolRegistry.clear();
  t.sqlite.run("DELETE FROM usage_events");
  t.sqlite.run("DELETE FROM messages");
  t.sqlite.run("DELETE FROM chat_sessions");
  t.sqlite.run("DELETE FROM users");
});

afterAll(() => t.sqlite.close());

describe("processChat usage ledger", () => {
  it("writes one row with every call's cache split", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue({ content: "ok", isError: false });
    model = scriptedModel([
      [
        { type: "tool-call", toolCallId: "c1", toolName: TOOL_KEY, input: "{}" },
        finish("tool-calls", { noCache: 100, cacheRead: 0, cacheWrite: 3000 }, {
          ephemeral_5m_input_tokens: 2000,
          ephemeral_1h_input_tokens: 1000,
        }),
      ],
      [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "done" },
        { type: "text-end", id: "t" },
        finish("stop", { noCache: 200, cacheRead: 3000, cacheWrite: 0 }),
      ],
    ]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi"));

    expect(events.find((e) => e.type === "done")?.data).toEqual({ messageId: q.messageQueries.findByChatId(sessionId).find((m) => m.role === "assistant")!.id, inputTokens: 6300, outputTokens: 100 });

    const rows = t.sqlite.query<Record<string, unknown>, []>("SELECT * FROM usage_events").all();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      status: "ok",
      usage_estimated: 0,
      input_tokens: 6300,
      output_tokens: 100,
      cache_read_tokens: 3000,
      cache_write_5m_tokens: 2000,
      cache_write_1h_tokens: 1000,
      llm_calls: 2,
      long_context_calls: 0,
    });
    expect(row.pricing_json).toBeString();
    expect(row.cost_microusd as number).toBeGreaterThan(0);

    const assistant = q.messageQueries.findByChatId(sessionId).find((m) => m.role === "assistant")!;
    expect(assistant).toMatchObject({ input_tokens: 6300, output_tokens: 100, cost_microusd: row.cost_microusd });
  });

  it("an error after 2 finished calls writes one error row with those 2 calls' cost", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue({ content: "ok", isError: false });
    const input1 = { noCache: 1000, cacheRead: 0, cacheWrite: 0 };
    const input2 = { noCache: 200, cacheRead: 1000, cacheWrite: 0 };
    model = scriptedModel([
      [toolCallPart("c1"), finish("tool-calls", input1)],
      [toolCallPart("c2"), finish("tool-calls", input2)],
    ]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi"));

    expect(model.doStreamCalls).toHaveLength(3);
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);

    const { provider, chatModel } = loadLLMConfig();
    const expected = summarizeTurnCost([
      priceCall(provider, chatModel, { noCacheTokens: 1000, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 50 }),
      priceCall(provider, chatModel, { noCacheTokens: 200, cacheReadTokens: 1000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 50 }),
    ]);

    const rows = t.sqlite.query<Record<string, unknown>, []>("SELECT * FROM usage_events").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "error",
      usage_estimated: 0,
      llm_calls: 2,
      input_tokens: 2200,
      output_tokens: 100,
      cache_read_tokens: 1000,
      cost_microusd: expected.costMicrousd,
      session_id: sessionId,
      message_id: null,
    });
    expect(q.usageEventQueries.getTotalsForDate(USER_ID).cost_microusd).toBe(expected.costMicrousd);
    expect(q.dailyUsageQueries.getTodayFull(USER_ID)).toMatchObject({ query_count: 0, input_tokens: 2200, output_tokens: 100 });
    expect(q.messageQueries.findByChatId(sessionId).map((m) => m.role)).toEqual(["user"]);
  });

  it("writes nothing when the turn fails before any call finished", async () => {
    model = scriptedModel([]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi"));

    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(t.sqlite.query("SELECT count(*) AS n FROM usage_events").get()).toEqual({ n: 0 });
  });

  it("records the finished calls when the consumer stops iterating early", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue({ content: "ok", isError: false });
    model = scriptedModel([[toolCallPart("c1"), finish("tool-calls", { noCache: 100, cacheRead: 0, cacheWrite: 0 })]]);

    const sessionId = crypto.randomUUID();
    for await (const event of processChat(sessionId, USER_ID, "hi")) {
      if (event.type === "tool_end") break;
    }

    const rows = t.sqlite.query<Record<string, unknown>, []>("SELECT status, llm_calls FROM usage_events").all();
    expect(rows).toEqual([{ status: "error", llm_calls: 1 }]);
  });

  it("a failing error-row write is logged and never masks the turn's error", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue({ content: "ok", isError: false });
    spyOn(q.usageEventQueries, "create").mockImplementation(() => {
      throw new Error("disk full");
    });
    model = scriptedModel([[toolCallPart("c1"), finish("tool-calls", { noCache: 100, cacheRead: 0, cacheWrite: 0 })]]);

    const events = await collect(processChat(crypto.randomUUID(), USER_ID, "hi"));

    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(t.sqlite.query("SELECT count(*) AS n FROM usage_events").get()).toEqual({ n: 0 });
    expect(q.dailyUsageQueries.getTodayFull(USER_ID)).toMatchObject({ input_tokens: 0, output_tokens: 0 });
  });
});

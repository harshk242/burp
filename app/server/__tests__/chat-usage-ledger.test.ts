/**
 * Usage ledger: processChat meters every LLM call of a turn and writes one
 * usage_events row with the cache split taken from the SDK usage and the
 * provider metadata.
 *
 * processChat runs against an in-memory DB and a mock language model (same
 * harness as chat-abort.test.ts).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { loadLLMConfig, sanitizeToolName } from "../llm";
import { mcpManager } from "../mcp/manager";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";
import type { StreamEvent } from "../orchestration/types";

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
  return new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(calls[n++]!) }) });
}

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

    // The SSE usage event keeps its shape: total input across categories.
    expect(events.find((e) => e.type === "usage")?.data).toEqual({ inputTokens: 6300, outputTokens: 100 });

    const rows = t.sqlite.query<Record<string, unknown>, []>("SELECT * FROM usage_events").all();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
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
});

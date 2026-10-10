/**
 * Abort wiring: aborting the turn's signal cancels the in-flight LLM call or
 * MCP tool call, and the loop stops — no further model calls, no further tool
 * calls, no assistant message, no error event to the (gone) client.
 *
 * processChat runs against an in-memory DB and a mock language model; the MCP
 * call is a spy on the mcpManager singleton.
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

// @ai-sdk/provider isn't a direct dependency; take the part type from the mock.
type LanguageModelV4StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOOL_FULL_NAME = [...ALWAYS_LOADED_TOOLS][0]!;
const TOOL_KEY = sanitizeToolName(TOOL_FULL_NAME, loadLLMConfig().provider);

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

// Each test installs its own model; processChat asks for it per call.
let model: MockLanguageModelV4;
mock.module("../llm/provider", () => ({ getChatModel: () => model, getTitleModel: () => model }));

const { processChat } = await import("../orchestration/chat-v2");

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function toolCall(id: string): LanguageModelV4StreamPart {
  return { type: "tool-call", toolCallId: id, toolName: TOOL_KEY, input: "{}" };
}

function finish(reason: "tool-calls" | "stop"): LanguageModelV4StreamPart {
  return { type: "finish", finishReason: { unified: reason, raw: reason }, usage };
}

function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

/** Model whose call N returns calls[N] (falls back to a final text answer). */
function scriptedModel(calls: Array<(signal?: AbortSignal) => ReadableStream<LanguageModelV4StreamPart>>) {
  let n = 0;
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const make = calls[n++] ?? (() => streamOf([
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "final" },
        { type: "text-end", id: "t" },
        finish("stop"),
      ]));
      return { stream: make(abortSignal) };
    },
  });
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const okResult = { content: "ok", isError: false };

beforeEach(() => {
  q.userQueries.create(USER_ID, "clerk_a", "a@example.com", null, null, "user", null, null);
  const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
  toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
});

afterEach(() => {
  mock.restore();
  toolRegistry.clear();
  t.sqlite.run("DELETE FROM messages");
  t.sqlite.run("DELETE FROM chat_sessions");
  t.sqlite.run("DELETE FROM users");
});

afterAll(() => t.sqlite.close());

describe("processChat abort", () => {
  it("aborting during LLM call 2 cancels it: no call 3, no further tool calls", async () => {
    const turn = new AbortController();
    const callTool = spyOn(mcpManager, "callTool").mockResolvedValue(okResult);

    model = scriptedModel([
      () => streamOf([toolCall("c1"), finish("tool-calls")]),
      // Call 2 streams some text, then the client goes away. If the abort
      // didn't reach the model call, it would go on to request another tool.
      (signal) => new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "partial" });
          signal?.addEventListener("abort", () => controller.error(signal.reason));
          setTimeout(() => turn.abort(), 0);
          setTimeout(() => {
            if (signal?.aborted) return;
            controller.enqueue({ type: "text-end", id: "t" });
            controller.enqueue(toolCall("c2"));
            controller.enqueue(finish("tool-calls"));
            controller.close();
          }, 50);
        },
      }),
    ]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi", turn.signal));

    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[1]!.abortSignal?.aborted).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === "tool_start")).toHaveLength(1);
    expect(events.some((e) => e.type === "error" || e.type === "done")).toBe(false);
    // Only the user message was stored; the aborted turn writes no assistant message.
    expect(q.messageQueries.findByChatId(sessionId).map((m) => m.role)).toEqual(["user"]);
  });

  it("aborting during an MCP tool call cancels it and skips the remaining calls", async () => {
    const turn = new AbortController();
    let toolSignal: AbortSignal | undefined;
    const callTool = spyOn(mcpManager, "callTool").mockImplementation((_s, _n, _a, _t, signal) => {
      toolSignal = signal;
      // An MCP call that would never settle on its own; only the signal ends it.
      const pending = new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));
      turn.abort();
      return pending;
    });

    model = scriptedModel([() => streamOf([toolCall("c1"), toolCall("c2"), finish("tool-calls")])]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi", turn.signal));

    expect(toolSignal).toBe(turn.signal);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(events.some((e) => e.type === "tool_end" || e.type === "error" || e.type === "done")).toBe(false);
    expect(q.messageQueries.findByChatId(sessionId).map((m) => m.role)).toEqual(["user"]);
  });

  it("drops an MCP result that arrives after the abort", async () => {
    const turn = new AbortController();
    const callTool = spyOn(mcpManager, "callTool").mockImplementation(async () => {
      turn.abort();
      return okResult;
    });

    model = scriptedModel([() => streamOf([toolCall("c1"), finish("tool-calls")])]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi", turn.signal));

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(events.some((e) => e.type === "tool_end")).toBe(false);
  });
});

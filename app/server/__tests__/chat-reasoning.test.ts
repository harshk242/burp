/**
 * Thinking in the chat stream (plan Phase 4a.3): reasoning deltas become
 * `reasoning` SSE events and are stored in the assistant message's reasoning,
 * alongside the pre-tool text that `text_block_end { isReasoning: true }` marks.
 *
 * processChat runs against an in-memory DB and a mock language model (same
 * harness as chat-usage-ledger.test.ts).
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

const USER_ID = "33333333-3333-4333-8333-333333333333";
const TOOL_FULL_NAME = [...ALWAYS_LOADED_TOOLS][0]!;
const TOOL_KEY = sanitizeToolName(TOOL_FULL_NAME, loadLLMConfig().provider);

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

let model: MockLanguageModelV4;
mock.module("../llm/provider", () => ({ getChatModel: () => model, getTitleModel: () => model }));

const { processChat } = await import("../orchestration/chat-v2");

function scriptedModel(calls: LanguageModelV4StreamPart[][]) {
  let n = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const parts = calls[n++];
      if (!parts) throw new Error("provider down");
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  });
}

const finish = (reason: "tool-calls" | "stop"): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified: reason, raw: reason },
  usage: {
    inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 50, text: 30, reasoning: 20 },
  },
});

const thinking = (id: string, ...deltas: string[]): LanguageModelV4StreamPart[] => [
  { type: "reasoning-start", id },
  ...deltas.map((delta): LanguageModelV4StreamPart => ({ type: "reasoning-delta", id, delta })),
  { type: "reasoning-end", id },
];

const text = (id: string, delta: string): LanguageModelV4StreamPart[] => [
  { type: "text-start", id },
  { type: "text-delta", id, delta },
  { type: "text-end", id },
];

const toolCall = (id: string): LanguageModelV4StreamPart => ({ type: "tool-call", toolCallId: id, toolName: TOOL_KEY, input: "{}" });

async function run(calls: LanguageModelV4StreamPart[][]) {
  model = scriptedModel(calls);
  const sessionId = crypto.randomUUID();
  const events: StreamEvent[] = [];
  for await (const event of processChat(sessionId, USER_ID, "hi")) events.push(event);
  const assistant = q.messageQueries.findByChatId(sessionId).find((m) => m.role === "assistant");
  return { events, assistant };
}

/** The stream as a compact trace: "r:<text>" ("r+:" starts a thinking block), "t:<text>", "pre-tool-end", "tool". */
function trace(events: StreamEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.type === "reasoning") {
      const { text, newBlock } = e.data as { text: string; newBlock: boolean };
      return [`${newBlock ? "r+" : "r"}:${text}`];
    }
    if (e.type === "text") return [`t:${e.data as string}`];
    if (e.type === "text_block_end") return ["pre-tool-end"];
    if (e.type === "tool_start") return ["tool"];
    return [];
  });
}

beforeEach(() => {
  q.userQueries.create(USER_ID, "clerk_reasoning", "reasoning@example.com", null, null, "user", null, null);
  const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
  toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
  spyOn(mcpManager, "callTool").mockResolvedValue({ content: "ok", isError: false });
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

describe("processChat reasoning", () => {
  it("streams reasoning deltas as reasoning events and stores them", async () => {
    const { events, assistant } = await run([
      [...thinking("r1", "Let me ", "", "think."), ...text("t1", "Answer"), finish("stop")],
    ]);

    // Empty deltas (as with display "omitted") are not sent.
    expect(trace(events)).toEqual(["r+:Let me ", "r:think.", "t:Answer"]);
    expect(assistant).toMatchObject({ content: "Answer", reasoning: "Let me think." });
  });

  it("keeps the pre-tool text path and stores thinking and pre-tool text in stream order", async () => {
    const { events, assistant } = await run([
      [...thinking("r1", "Plan A."), ...text("t1", "Looking it up."), toolCall("c1"), finish("tool-calls")],
      [toolCall("c2"), finish("tool-calls")],
      [...thinking("r2", "Got it."), ...text("t2", "Final"), finish("stop")],
    ]);

    expect(trace(events)).toEqual([
      "r+:Plan A.",
      "t:Looking it up.",
      "pre-tool-end",
      "tool",
      "tool",
      "r+:Got it.",
      "t:Final",
    ]);
    expect(assistant).toMatchObject({ content: "Final", reasoning: "Plan A.\n\nLooking it up.\n\nGot it." });
  });

  it("marks each thinking block's first delta and stores blocks separated by a blank line", async () => {
    const { events, assistant } = await run([
      [...thinking("r1", "First."), ...thinking("r2", "Second."), ...text("t1", "Done"), finish("stop")],
    ]);

    expect(trace(events)).toEqual(["r+:First.", "r+:Second.", "t:Done"]);
    expect(assistant?.reasoning).toBe("First.\n\nSecond.");
  });

  it("doesn't stack blank lines when summaries already end in one", async () => {
    // Anthropic summaries end in "\n\n"; whitespace-only pre-tool text adds nothing.
    const { assistant } = await run([
      [...thinking("r1", "Plan A.\n\n"), ...text("t1", "\n"), toolCall("c1"), finish("tool-calls")],
      [...thinking("r2", "\nPlan B.\n\n"), ...text("t2", "Looking.\n\n"), toolCall("c2"), finish("tool-calls")],
      [...thinking("r3", "Got it.\n\n"), ...text("t3", "Final"), finish("stop")],
    ]);

    expect(assistant?.reasoning).toBe("Plan A.\n\nPlan B.\n\nLooking.\n\nGot it.");
    expect(assistant?.reasoning).not.toContain("\n\n\n");
  });

  it("stores interleaved thinking and pre-tool text in stream order", async () => {
    const { events, assistant } = await run([
      [...thinking("r1", "A."), ...text("t1", "Checking."), ...thinking("r2", "B."), toolCall("c1"), finish("tool-calls")],
      [...text("t2", "Done"), finish("stop")],
    ]);

    expect(trace(events)).toEqual(["r+:A.", "t:Checking.", "r+:B.", "pre-tool-end", "tool", "t:Done"]);
    expect(assistant).toMatchObject({ content: "Done", reasoning: "A.\n\nChecking.\n\nB." });
  });

  it("keeps final-call text as the response when thinking interleaves it", async () => {
    const { assistant } = await run([
      [...text("t1", "Intro. "), ...thinking("r1", "Hmm."), ...text("t2", "Answer"), finish("stop")],
    ]);

    expect(assistant).toMatchObject({ content: "Intro. Answer", reasoning: "Hmm." });
  });

  it("stores no reasoning and sends no reasoning events when the model doesn't think", async () => {
    // Adaptive thinking at effort medium often skips thinking; an empty
    // (omitted) thinking block must not produce an empty reasoning entry.
    const { events, assistant } = await run([[...thinking("r1", ""), ...text("t1", "Plain"), finish("stop")]]);

    expect(events.some((e) => e.type === "reasoning")).toBe(false);
    expect(assistant).toMatchObject({ content: "Plain", reasoning: null });
  });

  it("still meters usage when consuming the full stream", async () => {
    const { events } = await run([[...thinking("r1", "Hmm."), ...text("t1", "Ok"), finish("stop")]]);

    expect(events.find((e) => e.type === "usage")?.data).toEqual({ inputTokens: 100, outputTokens: 50 });
    const rows = t.sqlite.query<Record<string, unknown>, []>("SELECT status, llm_calls FROM usage_events").all();
    expect(rows).toEqual([{ status: "ok", llm_calls: 1 }]);
  });
});

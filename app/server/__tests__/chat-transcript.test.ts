/**
 * Model transcript write path through processChat: each turn appends the user
 * message, every assistant message (the final one included) and every tool
 * result, as the model saw them, tagged with the turn. Cache markers are never
 * stored; tool results carry the same fetched_at line that was sent; failed
 * turns keep the messages they got to.
 *
 * Same harness as chat-turns.test.ts: in-memory DB, mock language model, and
 * a real Anthropic provider over a stubbed fetch for signatures and markers.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel, ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { chatProviderOptions, loadLLMConfig, sanitizeToolName, type ModelOptions } from "../llm";
import { mcpManager } from "../mcp/manager";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";
import type { StreamEvent } from "../orchestration/types";

type LanguageModelV4StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

const USER_ID = "55555555-5555-4555-8555-555555555555";
const TOOL_FULL_NAME = [...ALWAYS_LOADED_TOOLS][0]!;
const llmConfig = loadLLMConfig();
const TOOL_KEY = sanitizeToolName(TOOL_FULL_NAME, llmConfig.provider);
const FETCHED_AT = /^\[fetched_at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\]\n/;

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

let model: MockLanguageModelV4;
let realModel: ((options?: ModelOptions) => LanguageModel) | undefined;
mock.module("../llm/provider", () => ({
  getChatModel: (options?: ModelOptions) => realModel?.(options) ?? model,
  getTitleModel: () => model,
}));

const { processChat } = await import("../orchestration/chat-v2");
const { SYSTEM_PROMPT } = await import("../orchestration/context/system-prompt");
const { contextVersion } = await import("../orchestration/context/transcript");

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
type Finish = Extract<LanguageModelV4StreamPart, { type: "finish" }>;
const finish = (unified: Finish["finishReason"]["unified"], raw: string = unified): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified, raw },
  usage,
});
const toolCall = (id: string): LanguageModelV4StreamPart => ({ type: "tool-call", toolCallId: id, toolName: TOOL_KEY, input: "{}" });
const text = (delta: string): LanguageModelV4StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta },
  { type: "text-end", id: "t" },
];

/** Call N streams calls[N]; a call past the end fails before any response. */
function scriptedModel(calls: LanguageModelV4StreamPart[][]) {
  let n = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const call = calls[n++];
      if (!call) throw new Error("provider down");
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of call) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  });
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const rows = (sessionId: string) => q.modelTranscriptQueries.findBySessionId(sessionId);
const stored = (sessionId: string) => rows(sessionId).map((r) => JSON.parse(r.content_json) as ModelMessage);
const turns = (sessionId: string) => q.chatTurnQueries.findBySessionId(sessionId);
/** The text of the first tool result in a stored tool message. */
function toolResultText(message: ModelMessage): string {
  const part = (message.content as { type: string; output: { value: string } }[])[0]!;
  return part.output.value;
}

beforeEach(() => {
  q.userQueries.create(USER_ID, "clerk_transcript", "transcript@example.com", null, null, "user", null, null);
  const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
  toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
  spyOn(mcpManager, "callTool").mockResolvedValue({ content: '{"result":"ok"}', isError: false });
});

afterEach(() => {
  mock.restore();
  realModel = undefined;
  toolRegistry.clear();
  for (const table of ["model_transcript", "usage_events", "chat_turns", "messages", "chat_sessions", "users"]) {
    t.sqlite.run(`DELETE FROM ${table}`);
  }
});

afterAll(() => t.sqlite.close());

describe("model transcript", () => {
  it("appends user, tool-call, tool result and the final answer, tagged with the turn", async () => {
    model = scriptedModel([[toolCall("c1"), finish("tool-calls")], [...text("answer"), finish("stop")]]);
    const sessionId = crypto.randomUUID();
    expect((await collect(processChat(sessionId, USER_ID, "question"))).some((e) => e.type === "done")).toBe(true);

    const [turn] = turns(sessionId);
    const saved = rows(sessionId);
    expect(saved.map((r) => [r.seq, r.role, r.turn_id])).toEqual([
      [0, "user", turn!.id],
      [1, "assistant", turn!.id],
      [2, "tool", turn!.id],
      [3, "assistant", turn!.id],
    ]);
    for (const row of saved) {
      expect(row).toMatchObject({
        provider: llmConfig.provider,
        model: llmConfig.chatModel,
        context_version: contextVersion(SYSTEM_PROMPT, chatProviderOptions(llmConfig)),
      });
    }
    expect(saved.map((r) => JSON.parse(r.tool_names_json))).toEqual([[], [TOOL_KEY], [], []]);

    const [user, call, result, final] = stored(sessionId);
    expect(user).toEqual({ role: "user", content: "question" });
    expect(call).toMatchObject({ role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: TOOL_KEY }] });
    expect(final).toMatchObject({ role: "assistant", content: [{ type: "text", text: "answer" }] });

    // The tool result was stored with the fetched_at line it was sent with.
    const value = toolResultText(result!);
    expect(value).toMatch(FETCHED_AT);
    expect(value.replace(FETCHED_AT, "")).toBe('{"result":"ok"}');
    const sent = JSON.stringify(model.doStreamCalls[1]!.prompt);
    expect(sent).toContain(JSON.stringify(value));

    // Markers were on what was sent, never on what was stored.
    expect(sent).toContain("cacheControl");
    for (const row of saved) expect(row.content_json).not.toMatch(/cacheControl|cache_control/);
  });

  it("continues seq across turns", async () => {
    const sessionId = crypto.randomUUID();
    model = scriptedModel([[...text("one"), finish("stop")]]);
    await collect(processChat(sessionId, USER_ID, "first"));
    model = scriptedModel([[...text("two"), finish("stop")]]);
    await collect(processChat(sessionId, USER_ID, "second"));

    const [first, second] = turns(sessionId);
    expect(rows(sessionId).map((r) => [r.seq, r.role, r.turn_id])).toEqual([
      [0, "user", first!.id],
      [1, "assistant", first!.id],
      [2, "user", second!.id],
      [3, "assistant", second!.id],
    ]);
  });

  it("keeps a failed turn's messages up to the failure", async () => {
    // Call 1 asks for a tool, call 2 fails before any response.
    model = scriptedModel([[toolCall("c1"), finish("tool-calls")]]);
    const sessionId = crypto.randomUUID();
    await collect(processChat(sessionId, USER_ID, "question"));

    const [turn] = turns(sessionId);
    expect(turn).toMatchObject({ status: "error", error_code: "provider_error" });
    expect(rows(sessionId).map((r) => [r.role, r.turn_id])).toEqual([
      ["user", turn!.id],
      ["assistant", turn!.id],
      ["tool", turn!.id],
    ]);
  });

  it("keeps a refused response (never replayed: the turn is an error)", async () => {
    model = scriptedModel([[...text("I can"), finish("content-filter", "refusal")]]);
    const sessionId = crypto.randomUUID();
    await collect(processChat(sessionId, USER_ID, "question"));

    expect(turns(sessionId)).toEqual([expect.objectContaining({ status: "error", error_code: "refusal" })]);
    const [user, refused] = stored(sessionId);
    expect(user).toEqual({ role: "user", content: "question" });
    expect(refused).toMatchObject({ role: "assistant", content: [{ type: "text", text: "I can" }] });
  });
});

describe("model transcript on a real Anthropic stream", () => {
  const sse = (events: object[]) =>
    events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const messageStart = { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } };
  const end = (stopReason: string) => [
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 3 } },
    { type: "message_stop" },
  ];
  const call1 = sse([
    messageStart,
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Plan the lookup." } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-123" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "redacted-xyz" } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: TOOL_KEY, input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{}" } },
    { type: "content_block_stop", index: 2 },
    ...end("tool_use"),
  ]);
  const call2 = sse([
    messageStart,
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Final answer." } },
    { type: "content_block_stop", index: 0 },
    ...end("end_turn"),
  ]);

  it("stores signed and redacted thinking as returned, the final message, and no cache_control", async () => {
    realModel = (options) => createAnthropic({ apiKey: "test", fetch: options?.fetch })("claude-sonnet-5-5");
    const bodies: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation((async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(bodies.length === 1 ? call1 : call2, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch);

    const sessionId = crypto.randomUUID();
    expect((await collect(processChat(sessionId, USER_ID, "question"))).some((e) => e.type === "done")).toBe(true);
    expect(bodies).toHaveLength(2);

    const [, assistant, result, final] = stored(sessionId);
    expect(rows(sessionId).map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    // Parts in the order returned (the SDK also adds its own `custom` parts).
    const parts = (assistant!.content as { type: string }[]).filter((p) => p.type !== "custom");
    expect(parts).toMatchObject([
      { type: "reasoning", text: "Plan the lookup.", providerOptions: { anthropic: { signature: "sig-123" } } },
      { type: "reasoning", providerOptions: { anthropic: { redactedData: "redacted-xyz" } } },
      { type: "tool-call", toolCallId: "toolu_1", toolName: TOOL_KEY },
    ]);
    expect(final!.role).toBe("assistant");
    expect((final!.content as unknown[]).filter((p) => (p as { type: string }).type !== "custom")).toEqual([{ type: "text", text: "Final answer." }]);

    // Sent with cache_control and the same fetched_at text; stored without markers.
    const request2 = JSON.parse(bodies[1]!) as { messages: { content: { type: string; content?: unknown; signature?: string }[] }[] };
    expect(bodies[1]).toContain("cache_control");
    const sentResult = request2.messages.flatMap((m) => m.content).find((c) => c.type === "tool_result")!;
    expect(JSON.stringify(sentResult.content)).toContain(JSON.stringify(toolResultText(result!)));
    expect(request2.messages.flatMap((m) => m.content).find((c) => c.type === "thinking")?.signature).toBe("sig-123");
    for (const row of rows(sessionId)) expect(row.content_json).not.toMatch(/cacheControl|cache_control/);
  });
});

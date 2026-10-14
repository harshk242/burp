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
import { appConfig } from "../config";
import { logger } from "../logger";

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
const { contextVersion, loadTranscript, toTranscriptRow } = await import("../orchestration/context/transcript");

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
  for (const reason of ["provider", "model", "context_version", "missing_tools"] as const) {
    it(`production replay degrades the entire turn and logs ${reason}`, async () => {
      const sessionId = crypto.randomUUID();
      q.chatSessionQueries.create(sessionId, USER_ID, null);
      q.messageQueries.create("old-user", sessionId, "user", "old question", null);
      q.chatTurnQueries.start("old-turn", sessionId, "old-user");
      q.messageQueries.create("old-answer", sessionId, "assistant", "old UI answer", null);
      q.chatTurnQueries.finish("old-turn", { status: "ok", iterations: 1, assistantMessageId: "old-answer" });
      const tag = { provider: llmConfig.provider, model: llmConfig.chatModel, contextVersion: contextVersion(SYSTEM_PROMPT, chatProviderOptions(llmConfig)) };
      const first = toTranscriptRow("old-turn", { role: "user", content: "lossless question" }, tag);
      const last = toTranscriptRow("old-turn", {
        role: "assistant", content: [
          { type: "reasoning", text: "old thinking", providerOptions: { anthropic: { signature: "old-signature" } } },
          { type: "tool-call", toolCallId: "old-call", toolName: reason === "missing_tools" ? "removed__tool" : TOOL_KEY, input: {} },
        ],
      }, tag);
      if (reason === "provider") last.provider = "another-provider";
      if (reason === "model") last.model = "another-model";
      if (reason === "context_version") last.contextVersion = "another-version";
      q.modelTranscriptQueries.append(sessionId, [first, last]);
      const logs = spyOn(logger, "info");
      model = scriptedModel([[...text("new answer"), finish("stop")]]);
      const events = await collect(processChat(sessionId, USER_ID, "new question"));
      expect(events.some((event) => event.type === "done")).toBe(true);
      const prompt = model.doStreamCalls[0]!.prompt.filter((message) => message.role !== "system");
      expect(prompt.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
      expect(JSON.stringify(prompt)).toContain("old UI answer");
      expect(JSON.stringify(prompt)).not.toMatch(/lossless question|old-signature|old-call/);
      expect(prompt[0]!.providerOptions?.anthropic?.cacheControl).toBeUndefined();
      const degradation = logs.mock.calls.filter(([, event]) => event === "transcript_degraded");
      expect(degradation).toHaveLength(1);
      expect(degradation[0]![2]?.data).toEqual({
        turn_id: "old-turn", reason, ...(reason === "missing_tools" ? { missing_tools: ["removed__tool"] } : {}),
      });
    });
  }

  it("production replay retains lossless history after tools are added or described differently", async () => {
    const sessionId = crypto.randomUUID();
    model = scriptedModel([[toolCall("kept-call"), finish("tool-calls")], [...text("answer"), finish("stop")]]);
    await collect(processChat(sessionId, USER_ID, "first"));
    const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
    toolRegistry.register(server, { name, description: "changed description", inputSchema: { type: "object", properties: {} } });
    toolRegistry.register("new", { name: "added_tool", description: "added", inputSchema: { type: "object" } });
    const logs = spyOn(logger, "info");
    model = scriptedModel([[...text("followup"), finish("stop")]]);
    await collect(processChat(sessionId, USER_ID, "second"));
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain("kept-call");
    expect(logs.mock.calls.filter(([, event]) => event === "transcript_degraded")).toHaveLength(0);
  });

  it("replays complete successful messages as-is and carries the final input endpoint", async () => {
    const sessionId = crypto.randomUUID();
    model = scriptedModel([[toolCall("c1"), finish("tool-calls")], [...text("answer"), finish("stop")]]);
    await collect(processChat(sessionId, USER_ID, "first"));
    const original = stored(sessionId);
    expect(loadTranscript(sessionId)).toMatchObject({ messages: original, previousLastIndex: 2 });
    model = scriptedModel([[...text("followup"), finish("stop")]]);
    const logs = spyOn(logger, "info");
    await collect(processChat(sessionId, USER_ID, "second"));
    const prompt = model.doStreamCalls[0]!.prompt;
    expect(prompt.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant", "user"]);
    expect(prompt[3]!.providerOptions?.anthropic?.cacheControl).toEqual({ type: "ephemeral", ttl: "5m" });
    expect(JSON.stringify(prompt)).toContain("c1");
    expect(JSON.stringify(prompt)).toContain(JSON.stringify(toolResultText(original[2]!)));
    expect(logs.mock.calls.some(([, event, options]) => event === "first_call_cache_read" && options?.data?.first_call_cache_read === 0)).toBe(true);
    expect(logs.mock.calls.some(([, event, options]) => event === "turn_started" && typeof options?.data?.turn_gap_seconds === "number")).toBe(true);
  });

  it("omits failed and aborted questions and their tool history on the next turn", async () => {
    const sessionId = crypto.randomUUID();
    model = scriptedModel([[toolCall("bad"), finish("tool-calls")]]);
    await collect(processChat(sessionId, USER_ID, "failed question"));
    await collect(processChat(sessionId, USER_ID, "aborted question", AbortSignal.abort()));
    expect(turns(sessionId).map((turn) => turn.status)).toEqual(["error", "aborted"]);
    expect(loadTranscript(sessionId).messages).toEqual([]);
    model = scriptedModel([[...text("good"), finish("stop")]]);
    await collect(processChat(sessionId, USER_ID, "successful question"));
    expect(model.doStreamCalls[0]!.prompt.filter((m) => m.role !== "system")).toEqual([
      expect.objectContaining({ role: "user", content: [{ type: "text", text: "successful question" }] }),
    ]);
  });

  it("merges untracked legacy messages, ok text-only turns, and transcript turns deterministically", async () => {
    const sessionId = crypto.randomUUID();
    q.chatSessionQueries.create(sessionId, USER_ID, null);
    q.messageQueries.create("legacy-user", sessionId, "user", "legacy question", null);
    q.messageQueries.create("legacy-answer", sessionId, "assistant", "legacy answer", null);
    q.messageQueries.create("text-user", sessionId, "user", "text question", null);
    q.chatTurnQueries.start("text-turn", sessionId, "text-user");
    q.messageQueries.create("text-answer", sessionId, "assistant", "text answer", null);
    q.chatTurnQueries.finish("text-turn", { status: "ok", iterations: 1, assistantMessageId: "text-answer" });
    model = scriptedModel([[toolCall("c1"), finish("tool-calls")], [...text("answer"), finish("stop")]]);
    await collect(processChat(sessionId, USER_ID, "modern question"));
    const expected: ModelMessage[] = [
      { role: "user", content: "legacy question" }, { role: "assistant", content: "legacy answer" },
      { role: "user", content: "text question" }, { role: "assistant", content: "text answer" },
      ...stored(sessionId),
    ];
    expect(loadTranscript(sessionId).messages).toEqual(expected);
    expect(loadTranscript(sessionId).messages).toEqual(expected);
    expect(loadTranscript(sessionId).previousLastIndex).toBe(6);
  });

  it("refuses an oversized first request before sending and records context_budget", async () => {
    const sessionId = crypto.randomUUID();
    model = scriptedModel([[...text("unused"), finish("stop")]]);
    const events = await collect(processChat(sessionId, USER_ID, "x".repeat(appConfig.llm.max_context_tokens * 4)));
    expect(events).toContainEqual({ type: "error", data: { error: "this chat is too long, start a new chat", code: "context_budget" } });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(turns(sessionId)[0]).toMatchObject({ status: "error", error_code: "context_budget" });
    expect(loadTranscript(sessionId).messages).toEqual([]);
    expect(t.sqlite.query("SELECT * FROM usage_events").all()).toHaveLength(0);
  });

  it("refuses growth beyond the budget on a later call using measured prompt tokens", async () => {
    const sessionId = crypto.randomUUID();
    const hugeUsage = { ...usage, inputTokens: { ...usage.inputTokens, total: appConfig.llm.max_context_tokens, noCache: appConfig.llm.max_context_tokens } };
    model = scriptedModel([[toolCall("c1"), { ...finish("tool-calls"), usage: hugeUsage } as LanguageModelV4StreamPart]]);
    const events = await collect(processChat(sessionId, USER_ID, "question"));
    expect(events).toContainEqual({ type: "error", data: { error: "this chat is too long, start a new chat", code: "context_budget" } });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(turns(sessionId)[0]).toMatchObject({ status: "error", error_code: "context_budget" });
    expect(t.sqlite.query("SELECT status FROM usage_events").get()).toEqual({ status: "error" });
  });

  it("stores the last prompt size and refuses the next turn from it before sending", async () => {
    const sessionId = crypto.randomUUID();
    const nearBudget = appConfig.llm.max_context_tokens - 10;
    const bigUsage = { ...usage, inputTokens: { ...usage.inputTokens, total: nearBudget, noCache: nearBudget } };
    model = scriptedModel([[...text("first answer"), { ...finish("stop"), usage: bigUsage } as LanguageModelV4StreamPart]]);
    await collect(processChat(sessionId, USER_ID, "first"));
    expect(turns(sessionId)[0]).toMatchObject({ status: "ok", last_prompt_tokens: nearBudget });

    model = scriptedModel([[...text("unused"), finish("stop")]]);
    const events = await collect(processChat(sessionId, USER_ID, "second question that tips it over"));
    expect(events).toContainEqual({ type: "error", data: { error: "this chat is too long, start a new chat", code: "context_budget" } });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(turns(sessionId)[1]).toMatchObject({ status: "error", error_code: "context_budget", last_prompt_tokens: null });
  });

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

    const value = toolResultText(result!);
    expect(value).toMatch(FETCHED_AT);
    expect(value.replace(FETCHED_AT, "")).toBe('{"result":"ok"}');
    const sent = JSON.stringify(model.doStreamCalls[1]!.prompt);
    expect(sent).toContain(JSON.stringify(value));

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
    const parts = (assistant!.content as { type: string }[]).filter((p) => p.type !== "custom");
    expect(parts).toMatchObject([
      { type: "reasoning", text: "Plan the lookup.", providerOptions: { anthropic: { signature: "sig-123" } } },
      { type: "reasoning", providerOptions: { anthropic: { redactedData: "redacted-xyz" } } },
      { type: "tool-call", toolCallId: "toolu_1", toolName: TOOL_KEY },
    ]);
    expect(final!.role).toBe("assistant");
    expect((final!.content as unknown[]).filter((p) => (p as { type: string }).type !== "custom")).toEqual([{ type: "text", text: "Final answer." }]);

    const request2 = JSON.parse(bodies[1]!) as { messages: { content: { type: string; content?: unknown; signature?: string }[] }[] };
    expect(bodies[1]).toContain("cache_control");
    const sentResult = request2.messages.flatMap((m) => m.content).find((c) => c.type === "tool_result")!;
    expect(JSON.stringify(sentResult.content)).toContain(JSON.stringify(toolResultText(result!)));
    expect(request2.messages.flatMap((m) => m.content).find((c) => c.type === "thinking")?.signature).toBe("sig-123");
    for (const row of rows(sessionId)) expect(row.content_json).not.toMatch(/cacheControl|cache_control/);

    await collect(processChat(sessionId, USER_ID, "followup"));
    await collect(processChat(sessionId, USER_ID, "third"));
    expect(bodies).toHaveLength(4);
    const removeMarkers = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, item) => key === "cache_control" ? undefined : item));
    for (const i of [2, 3]) {
      const previous = JSON.parse(bodies[i - 1]!);
      const next = JSON.parse(bodies[i]!);
      const priorMessages = removeMarkers(previous.messages) as { content: unknown[] }[];
      const nextMessages = removeMarkers(next.messages) as { content: unknown[] }[];
      // Anthropic merges adjacent tool/user messages into one user block.
      for (let j = 0; j < priorMessages.length; j++) {
        expect(nextMessages[j]).toMatchObject({ ...priorMessages[j], content: priorMessages[j]!.content });
      }
      expect((bodies[i]!.match(/"cache_control"/g) ?? []).length).toBeLessThanOrEqual(3);
      expect(bodies[i]).toContain("sig-123");
      expect(bodies[i]).toContain("redacted-xyz");
    }
  });
});

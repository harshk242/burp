import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { loadLLMConfig, sanitizeToolName, type ModelOptions } from "../llm";
import { mcpManager } from "../mcp/manager";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";
import type { StreamEvent } from "../orchestration/types";

type LanguageModelV4StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

const USER_ID = "44444444-4444-4444-8444-444444444444";
const TOOL_FULL_NAME = [...ALWAYS_LOADED_TOOLS][0]!;
const TOOL_KEY = sanitizeToolName(TOOL_FULL_NAME, loadLLMConfig().provider);

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
const { TURN_IN_PROGRESS_MESSAGE, abortActiveTurns } = await import("../orchestration/chat-turn");

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

type Finish = Extract<LanguageModelV4StreamPart, { type: "finish" }>;
function finish(unified: Finish["finishReason"]["unified"], raw: string = unified, providerMetadata?: Finish["providerMetadata"]): LanguageModelV4StreamPart {
  return { type: "finish", finishReason: { unified, raw }, usage, providerMetadata };
}

const toolCall = (id: string): LanguageModelV4StreamPart => ({ type: "tool-call", toolCallId: id, toolName: TOOL_KEY, input: "{}" });
const text = (delta: string): LanguageModelV4StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta },
  { type: "text-end", id: "t" },
];

function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

type Call = LanguageModelV4StreamPart[] | (() => ReadableStream<LanguageModelV4StreamPart>);
function scriptedModel(calls: Call[]) {
  let n = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const call = calls[n++];
      if (!call) throw new Error("provider down");
      return { stream: typeof call === "function" ? call() : streamOf(call) };
    },
  });
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const okResult = { content: "ok", isError: false };
const turns = (sessionId: string) => q.chatTurnQueries.findBySessionId(sessionId);
const usageRows = () => t.sqlite.query<Record<string, unknown>, []>("SELECT * FROM usage_events").all();
const roles = (sessionId: string) => q.messageQueries.findByChatId(sessionId).map((m) => m.role);

beforeEach(() => {
  q.userQueries.create(USER_ID, "clerk_turns", "turns@example.com", null, null, "user", null, null);
  const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
  toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
});

afterEach(() => {
  mock.restore();
  realModel = undefined;
  toolRegistry.clear();
  t.sqlite.run("DELETE FROM usage_events");
  t.sqlite.run("DELETE FROM chat_turns");
  t.sqlite.run("DELETE FROM messages");
  t.sqlite.run("DELETE FROM chat_sessions");
  t.sqlite.run("DELETE FROM users");
});

afterAll(() => t.sqlite.close());

describe("chat_turns lifecycle", () => {
  it("a successful turn is ok, links both messages and its usage row", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue(okResult);
    model = scriptedModel([[toolCall("c1"), finish("tool-calls")], [...text("answer"), finish("stop")]]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi"));
    expect(events.some((e) => e.type === "done")).toBe(true);

    const [turn, ...rest] = turns(sessionId);
    expect(rest).toEqual([]);
    const [user, assistant] = q.messageQueries.findByChatId(sessionId);
    expect(turn).toMatchObject({
      status: "ok",
      error_code: null,
      error_message: null,
      iterations: 2,
      user_message_id: user!.id,
      assistant_message_id: assistant!.id,
    });
    expect(turn!.finished_at).toBeNumber();
    expect(usageRows()).toEqual([expect.objectContaining({ status: "ok", turn_id: turn!.id, message_id: assistant!.id })]);
    expect(q.chatSessionQueries.findById(sessionId)).toMatchObject({ user_id: USER_ID });
  });

  it("a new session whose first turn can't be stored is not left behind empty", async () => {
    model = scriptedModel([[...text("answer"), finish("stop")]]);
    t.sqlite.run("CREATE TEMP TRIGGER fail_turn BEFORE INSERT ON chat_turns BEGIN SELECT RAISE(ABORT, 'turn insert failed'); END");
    const sessionId = crypto.randomUUID();
    let events: StreamEvent[];
    try {
      events = await collect(processChat(sessionId, USER_ID, "hi"));
    } finally {
      t.sqlite.run("DROP TRIGGER fail_turn");
    }

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(q.chatSessionQueries.findById(sessionId)).toBeFalsy();
    expect(roles(sessionId)).toEqual([]);

    const retry = await collect(processChat(sessionId, USER_ID, "hi"));
    expect(retry.some((e) => e.type === "done")).toBe(true);
    expect(roles(sessionId)).toEqual(["user", "assistant"]);
  });

  it("a failed turn is recorded as error and its cost is linked to it", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue(okResult);
    model = scriptedModel([[toolCall("c1"), finish("tool-calls")]]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi"));

    expect(events.at(-1)).toEqual({ type: "error", data: { error: expect.stringContaining("provider down"), code: "provider_error" } });
    const [turn] = turns(sessionId);
    expect(turn).toMatchObject({ status: "error", error_code: "provider_error", iterations: 2, assistant_message_id: null });
    expect(turn!.error_message).toContain("provider down");
    expect(turn!.finished_at).toBeNumber();
    expect(roles(sessionId)).toEqual(["user"]);
    expect(usageRows()).toEqual([expect.objectContaining({ status: "error", turn_id: turn!.id, llm_calls: 1, message_id: null })]);
  });

  it("exceeding the tool iteration limit is recorded as max_tool_iterations", async () => {
    spyOn(mcpManager, "callTool").mockResolvedValue(okResult);
    const { maxToolIterations } = loadLLMConfig();
    model = scriptedModel(Array.from({ length: maxToolIterations }, (_, i) => [toolCall(`c${i}`), finish("tool-calls")]));

    const sessionId = crypto.randomUUID();
    await collect(processChat(sessionId, USER_ID, "hi"));

    expect(turns(sessionId)).toEqual([
      expect.objectContaining({ status: "error", error_code: "max_tool_iterations", iterations: maxToolIterations }),
    ]);
    expect(usageRows()).toEqual([expect.objectContaining({ turn_id: turns(sessionId)[0]!.id, llm_calls: maxToolIterations })]);
  });

  it("a client disconnect marks the turn aborted and links its cost", async () => {
    const turnAbort = new AbortController();
    spyOn(mcpManager, "callTool").mockImplementation(async () => {
      turnAbort.abort();
      return okResult;
    });
    model = scriptedModel([[toolCall("c1"), finish("tool-calls")]]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi", turnAbort.signal));

    expect(events.some((e) => e.type === "error" || e.type === "done")).toBe(false);
    const [turn] = turns(sessionId);
    expect(turn).toMatchObject({ status: "aborted", error_code: "aborted", iterations: 1, assistant_message_id: null });
    expect(turn!.finished_at).toBeNumber();
    expect(usageRows()).toEqual([expect.objectContaining({ status: "error", turn_id: turn!.id, llm_calls: 1 })]);
  });

  it("a consumer that stops reading marks the turn aborted (closed)", async () => {
    model = scriptedModel([[...text("partial answer"), finish("stop")]]);

    const sessionId = crypto.randomUUID();
    for await (const event of processChat(sessionId, USER_ID, "hi")) {
      if (event.type === "text") break;
    }

    expect(turns(sessionId)).toEqual([expect.objectContaining({ status: "aborted", error_code: "closed" })]);
  });
});

describe("per-session lock", () => {
  async function startBlockedTurn(sessionId: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    model = scriptedModel([
      () => new ReadableStream({
        async start(controller) {
          for (const part of text("first")) controller.enqueue(part);
          await gate;
          controller.enqueue(finish("stop"));
          controller.close();
        },
      }),
    ]);
    const running = processChat(sessionId, USER_ID, "first question");
    for (let r = await running.next(); !r.done && r.value.type !== "text"; r = await running.next());
    return { running, release };
  }

  it("rejects a second request while a reply is in progress, then accepts the next one", async () => {
    const sessionId = crypto.randomUUID();
    const first = await startBlockedTurn(sessionId);

    const rejected = await collect(processChat(sessionId, USER_ID, "second question"));
    expect(rejected).toEqual([{ type: "error", data: { error: TURN_IN_PROGRESS_MESSAGE, code: "turn_in_progress" } }]);
    expect(q.messageQueries.findByChatId(sessionId).map((m) => m.content)).toEqual(["first question"]);
    expect(turns(sessionId)).toHaveLength(1);

    first.release();
    const rest = await collect(first.running);
    expect(rest.some((e) => e.type === "done")).toBe(true);
    expect(turns(sessionId)).toEqual([expect.objectContaining({ status: "ok" })]);

    model = scriptedModel([[...text("third answer"), finish("stop")]]);
    const third = await collect(processChat(sessionId, USER_ID, "third question"));
    expect(third.some((e) => e.type === "done")).toBe(true);
    expect(turns(sessionId).map((turn) => turn.status)).toEqual(["ok", "ok"]);
  });

  it("does not block other sessions, and is released when a turn fails", async () => {
    const sessionId = crypto.randomUUID();
    const first = await startBlockedTurn(sessionId);

    const other = crypto.randomUUID();
    const otherEvents = await collect(processChat(other, USER_ID, "elsewhere"));
    expect(otherEvents.at(-1)).toMatchObject({ type: "error", data: { code: "provider_error" } });

    model = scriptedModel([[...text("ok"), finish("stop")]]);
    expect((await collect(processChat(other, USER_ID, "retry"))).some((e) => e.type === "done")).toBe(true);

    first.release();
    await collect(first.running);
  });
});

describe("cleanup failures", () => {
  it("releases the session lock and drains when the failed-turn usage callback throws", async () => {
    model = scriptedModel([]);
    const sessionId = crypto.randomUUID();
    await expect(collect(processChat(sessionId, USER_ID, "hi", undefined, {
      onUsageRecorded: () => { throw new Error("usage callback failed"); },
    }))).rejects.toThrow("usage callback failed");
    expect(await abortActiveTurns(10)).toBe(0);

    model = scriptedModel([[...text("answer"), finish("stop")]]);
    expect((await collect(processChat(sessionId, USER_ID, "retry"))).some((e) => e.type === "done")).toBe(true);
    expect(turns(sessionId).map((turn) => turn.status)).toEqual(["error", "ok"]);
  });
});

describe("refusals", () => {
  it("records stop_reason refusal with its category instead of saving an empty answer", async () => {
    model = scriptedModel([
      [
        ...text("I can"),
        finish("content-filter", "refusal", {
          anthropic: { stopDetails: { type: "refusal", category: "bio", explanation: "classifier" } },
        }),
      ],
    ]);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi"));

    expect(events.some((e) => e.type === "done")).toBe(false);
    const error = events.at(-1)!;
    expect(error).toMatchObject({ type: "error", data: { code: "refusal" } });
    expect((error.data as { error: string }).error).toContain("declined");
    expect((error.data as { error: string }).error).toContain("bio");

    expect(roles(sessionId)).toEqual(["user"]);
    const [turn] = turns(sessionId);
    expect(turn).toMatchObject({ status: "error", error_code: "refusal", iterations: 1, assistant_message_id: null });
    expect(turn!.error_message).toBe("stop_reason=refusal; category=bio; explanation=classifier");
    expect(usageRows()).toEqual([expect.objectContaining({ status: "error", turn_id: turn!.id, llm_calls: 1, usage_estimated: 0 })]);
  });

  it("reads the category from a real Anthropic stream", async () => {
    realModel = (options) => createAnthropic({ apiKey: "test", fetch: options?.fetch })("claude-sonnet-5-5");
    const sse = [
      { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I can" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "refusal", stop_sequence: null, stop_details: { type: "refusal", category: "bio" } }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ]
      .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join("");
    spyOn(globalThis, "fetch").mockImplementation((async () =>
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch);

    const sessionId = crypto.randomUUID();
    const events = await collect(processChat(sessionId, USER_ID, "hi"));

    expect(events.at(-1)).toMatchObject({ type: "error", data: { code: "refusal" } });
    expect(turns(sessionId)).toEqual([
      expect.objectContaining({ status: "error", error_code: "refusal", error_message: "stop_reason=refusal; category=bio" }),
    ]);
  });
});

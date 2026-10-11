/**
 * Prompt-cache breakpoints (Anthropic): the system message carries one marker
 * (tools + system); each call marks its last message and the previous call's
 * last message, on a copy. The loop's messages are never modified.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { loadLLMConfig, sanitizeToolName } from "../llm";
import { mcpManager } from "../mcp/manager";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";
import { applyCacheMarkers, cachedInstructions, EPHEMERAL_5M } from "../orchestration/context/cache-markers";
import { SYSTEM_PROMPT } from "../orchestration/context/system-prompt";

type LanguageModelV4StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;
type CallPrompt = Parameters<MockLanguageModelV4["doStream"]>[0]["prompt"];

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

let model: MockLanguageModelV4;
mock.module("../llm/provider", () => ({ getChatModel: () => model, getTitleModel: () => model }));

const { processChat } = await import("../orchestration/chat-v2");

const USER_ID = "44444444-4444-4444-8444-444444444444";
const TOOL_FULL_NAME = [...ALWAYS_LOADED_TOOLS][0]!;
const MARK = { anthropic: { cacheControl: EPHEMERAL_5M } };

const marked = (message: { providerOptions?: Record<string, unknown> }) =>
  (message.providerOptions?.anthropic as { cacheControl?: unknown } | undefined)?.cacheControl !== undefined;

function conversation(): ModelMessage[] {
  return [
    { role: "user", content: "earlier question" },
    { role: "assistant", content: "earlier answer" },
    { role: "user", content: "question" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "t", input: {} }] },
    {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "c1", toolName: "t", output: { type: "text", value: "r1" } }],
    },
  ];
}

describe("cachedInstructions", () => {
  it("is the system prompt as a system message with a 5-minute ephemeral marker", () => {
    expect(cachedInstructions("SYS")).toEqual({ role: "system", content: "SYS", providerOptions: MARK });
    expect(EPHEMERAL_5M).toEqual({ type: "ephemeral", ttl: "5m" });
  });
});

describe("applyCacheMarkers", () => {
  it("marks only the last message on a turn's first call", () => {
    const out = applyCacheMarkers(conversation().slice(0, 3));
    expect(out.map(marked)).toEqual([false, false, true]);
    expect(out[2]!.providerOptions).toEqual(MARK);
  });

  it("marks the last message and the previous call's last message", () => {
    const out = applyCacheMarkers(conversation(), 2);
    expect(out.map(marked)).toEqual([false, false, true, false, true]);
  });

  it("never marks more than two messages, and ignores an out-of-range or current-last previous index", () => {
    for (const previous of [undefined, -1, 4, 9]) {
      expect(applyCacheMarkers(conversation(), previous).map(marked)).toEqual([false, false, false, false, true]);
    }
    expect(applyCacheMarkers([])).toEqual([]);
  });

  it("leaves the input array and its messages unchanged", () => {
    const input = conversation();
    input[4]!.providerOptions = { anthropic: { other: 1 }, google: { x: true } };
    const snapshot = structuredClone(input);
    const originals = [...input];

    const out = applyCacheMarkers(input, 2);

    expect(out).not.toBe(input);
    expect(input).toEqual(snapshot);
    expect(input.every((message, i) => message === originals[i])).toBe(true);
    // Unmarked messages are shared, marked ones are copies that keep other options.
    expect(out[0]).toBe(input[0]!);
    expect(out[2]).not.toBe(input[2]!);
    expect(out[4]!.providerOptions).toEqual({
      anthropic: { other: 1, cacheControl: EPHEMERAL_5M },
      google: { x: true },
    });
    expect(out[4]!.content).toBe(input[4]!.content);
  });
});

describe("Anthropic request body", () => {
  it("puts cache_control on the system block and the marked messages' last blocks: 3 of 4", async () => {
    type Block = Record<string, unknown> & { cache_control?: unknown };
    let body: { system: Block[]; messages: { content: Block[] }[] } | undefined;
    const anthropic = createAnthropic({
      apiKey: "test",
      fetch: (async (_url: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stub" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    await generateText({
      model: anthropic("claude-sonnet-5-5"),
      instructions: cachedInstructions("SYS"),
      messages: applyCacheMarkers(conversation(), 2),
      maxRetries: 0,
    }).catch(() => undefined);

    const cacheControl = { type: "ephemeral", ttl: "5m" };
    expect(body!.system).toEqual([{ type: "text", text: "SYS", cache_control: cacheControl }]);
    const markedBlocks = body!.messages.flatMap((message, m) =>
      message.content.flatMap((block, b) => (block.cache_control ? [[m, b, block.cache_control]] : []))
    );
    // Anthropic merges consecutive same-role messages; the request has
    // user, assistant, user(question), assistant(tool_use), user(tool_result).
    expect(markedBlocks).toEqual([
      [2, 0, cacheControl],
      [4, 0, cacheControl],
    ]);
  });
});

describe("processChat cache markers", () => {
  function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
    return new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    });
  }

  const finish = (reason: "tool-calls" | "stop"): LanguageModelV4StreamPart => ({
    type: "finish",
    finishReason: { unified: reason, raw: reason },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
  });

  beforeEach(() => {
    q.userQueries.create(USER_ID, "clerk_cache", "cache@example.com", null, null, "user", null, null);
    const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
    toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
  });

  afterEach(() => {
    mock.restore();
    toolRegistry.clear();
  });

  afterAll(() => t.sqlite.close());

  it("marks system, the previous call's last and the last message on every call", async () => {
    expect(loadLLMConfig().provider).toBe("anthropic");
    spyOn(mcpManager, "callTool").mockResolvedValue({ content: "ok", isError: false });
    const toolKey = sanitizeToolName(TOOL_FULL_NAME, "anthropic");
    const toolCall = (id: string): LanguageModelV4StreamPart => ({ type: "tool-call", toolCallId: id, toolName: toolKey, input: "{}" });
    const script: LanguageModelV4StreamPart[][] = [
      [toolCall("c1"), finish("tool-calls")],
      [toolCall("c2"), finish("tool-calls")],
      [{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "done" }, { type: "text-end", id: "t" }, finish("stop")],
    ];
    const prompts: CallPrompt[] = [];
    model = new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        prompts.push(structuredClone(prompt));
        return { stream: streamOf(script[prompts.length - 1]!) };
      },
    });

    for await (const event of processChat(crypto.randomUUID(), USER_ID, "hi")) void event;

    expect(prompts).toHaveLength(3);
    for (const prompt of prompts) {
      expect(prompt[0]).toMatchObject({ role: "system", content: SYSTEM_PROMPT, providerOptions: MARK });
    }
    const messageMarks = prompts.map((prompt) => prompt.slice(1).map(marked));
    // Call 1: [user]. Call 2: + assistant(tool_use), tool. Call 3: + assistant, tool.
    // Earlier markers don't linger: the loop's own messages were never marked.
    expect(messageMarks).toEqual([
      [true],
      [true, false, true],
      [false, false, true, false, true],
    ]);
  });
});

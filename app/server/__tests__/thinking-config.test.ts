/**
 * Thinking config (Anthropic): adaptive thinking with summarized display and an
 * explicit effort, sent as provider options on every chat call. No sampling
 * parameters (temperature / top_p / top_k) and no top-level `reasoning` option.
 * Google gets no provider options.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { loadConfig } from "../config";
import { createQueries } from "../db/queries";
import { chatProviderOptions, loadLLMConfig } from "../llm";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";

type CallOptions = Parameters<MockLanguageModelV4["doStream"]>[0];
type LanguageModelV4StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

let model: MockLanguageModelV4;
mock.module("../llm/provider", () => ({ getChatModel: () => model, getTitleModel: () => model }));

const { processChat } = await import("../orchestration/chat-v2");

const USER_ID = "55555555-5555-4555-8555-555555555555";
const EXPECTED = { anthropic: { thinking: { type: "adaptive", display: "summarized" }, effort: "medium" } } as const;

const loadLlm = (llm: Record<string, unknown>) => loadConfig({}, { llm, server: {}, tool_search: {} }).llm;

describe("llm config", () => {
  it("config.yaml: summarized thinking, effort medium, 16K output tokens", () => {
    expect(loadConfig({}).llm).toMatchObject({ thinking_display: "summarized", effort: "medium", max_output_tokens: 16000 });
  });

  it("requires effort and rejects unknown levels", () => {
    expect(() => loadLlm({})).toThrow(/effort/);
    expect(() => loadLlm({ effort: "extreme" })).toThrow(/effort/);
    for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) expect(loadLlm({ effort }).effort).toBe(effort);
  });

  it("defaults display to summarized and output tokens to 16000", () => {
    expect(loadLlm({ effort: "low" })).toMatchObject({ thinking_display: "summarized", max_output_tokens: 16000 });
    expect(() => loadLlm({ effort: "low", thinking_display: "full" })).toThrow(/thinking_display/);
  });
});

describe("chatProviderOptions", () => {
  it("Anthropic: adaptive thinking with the configured display, and effort", () => {
    expect(chatProviderOptions({ provider: "anthropic", thinkingDisplay: "summarized", effort: "medium" })).toEqual(EXPECTED);
    expect(chatProviderOptions({ provider: "anthropic", thinkingDisplay: "omitted", effort: "xhigh" })).toEqual({
      anthropic: { thinking: { type: "adaptive", display: "omitted" }, effort: "xhigh" },
    });
  });

  it("Google: none", () => {
    expect(chatProviderOptions({ provider: "google", thinkingDisplay: "summarized", effort: "medium" })).toBeUndefined();
  });
});

describe("Anthropic request body", () => {
  it("sends thinking + output_config.effort and no sampling parameters", async () => {
    let body: Record<string, unknown> | undefined;
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
      prompt: "hi",
      maxOutputTokens: 16000,
      providerOptions: chatProviderOptions(loadLLMConfig()),
      maxRetries: 0,
    }).catch(() => undefined);

    expect(body).toMatchObject({
      max_tokens: 16000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
    });
    for (const key of ["temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(key);
  });
});

describe("processChat thinking options", () => {
  beforeEach(() => {
    q.userQueries.create(USER_ID, "clerk_thinking", "thinking@example.com", null, null, "user", null, null);
    // With no tools available the turn fails before any LLM call.
    const { server, name } = toolRegistry.parseToolName([...ALWAYS_LOADED_TOOLS][0]!);
    toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
  });

  afterEach(() => {
    mock.restore();
    toolRegistry.clear();
  });
  afterAll(() => t.sqlite.close());

  it("passes thinking + effort on the chat call, with no sampling parameters or reasoning", async () => {
    expect(loadLLMConfig().provider).toBe("anthropic");
    const calls: CallOptions[] = [];
    const parts: LanguageModelV4StreamPart[] = [
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "done" },
      { type: "text-end", id: "t" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
      },
    ];
    model = new MockLanguageModelV4({
      doStream: async (options) => {
        calls.push(options);
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

    for await (const event of processChat(crypto.randomUUID(), USER_ID, "hi")) void event;

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.providerOptions).toEqual(EXPECTED);
    expect(call.maxOutputTokens).toBe(16000);
    expect(call.temperature).toBeUndefined();
    expect(call.topP).toBeUndefined();
    expect(call.topK).toBeUndefined();
    // Effort comes only from provider options, never the top-level option.
    expect(call.reasoning).toBeUndefined();
  });
});

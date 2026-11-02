import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { chatProviderOptions, loadLLMConfig, sanitizeToolName, type ModelOptions } from "../llm";
import { mcpManager } from "../mcp/manager";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";
import * as langfuse from "../observability/langfuse";
import { resetTracingForTests } from "../observability/langfuse";
import { installMemoryTracing, json, one } from "../observability/__tests__/trace-test-utils";
import type { StreamEvent } from "../orchestration/types";
import { priceCall, summarizeTurnCost } from "../usage";

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;
type CallOptions = Parameters<MockLanguageModelV4["doStream"]>[0];

const USER_ID = "44444444-4444-4444-8444-444444444444";
const config = loadLLMConfig();
const TOOL_FULL_NAME = [...ALWAYS_LOADED_TOOLS][0]!;
const OVERRIDE = { model: "claude-haiku-5-5", effort: "xhigh", max_output_tokens: 64000 } as const;

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

const requestedModels: (string | undefined)[] = [];
const calls: CallOptions[] = [];
const usage = {
  inputTokens: { total: 1000, noCache: 100, cacheRead: 800, cacheWrite: 100 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};
const model = new MockLanguageModelV4({
  doStream: async (options) => {
    calls.push(options);
    const parts: StreamPart[] = [
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "answer" },
      { type: "text-end", id: "t" },
      { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
    ];
    return {
      stream: new ReadableStream<StreamPart>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }),
    };
  },
});
mock.module("../llm/provider", () => ({
  getChatModel: (options?: ModelOptions) => {
    requestedModels.push(options?.model);
    return model;
  },
  getTitleModel: () => model,
}));

const { processChat } = await import("../orchestration/chat-v2");

async function drain(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const mem = installMemoryTracing();

beforeEach(() => {
  calls.length = 0;
  requestedModels.length = 0;
  spyOn(globalThis, "fetch").mockImplementation((async () => new Response(null)) as unknown as typeof fetch);
  spyOn(mcpManager, "callTool").mockResolvedValue({ content: '{"ok":true}', isError: false });
  q.userQueries.create(USER_ID, "clerk_llm", "llm@example.com", null, null, "user", null, null);
  const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
  toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
  spyOn(langfuse, "getScoreClient").mockReturnValue({ score: { create: () => undefined } } as never);
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

const usageRow = () => t.sqlite.query<{ model: string; cost_microusd: number }, []>("SELECT model, cost_microusd FROM usage_events").get()!;
const transcriptModels = () =>
  t.sqlite.query<{ model: string; context_version: string }, []>("SELECT DISTINCT model, context_version FROM model_transcript").all();
const expectedMicrousd = (model: string) =>
  summarizeTurnCost([
    priceCall(config.provider, model, { noCacheTokens: 100, cacheReadTokens: 800, cacheWrite5mTokens: 100, cacheWrite1hTokens: 0, outputTokens: 20 }),
  ]).costMicrousd;

describe("processChat llm override", () => {
  it("without an override the model call gets exactly the app config", async () => {
    await drain(processChat(crypto.randomUUID(), USER_ID, "hi"));
    expect(calls).toHaveLength(1);
    expect(requestedModels).toEqual([config.chatModel]);
    expect(calls[0]!.maxOutputTokens).toBe(config.maxOutputTokens);
    expect(JSON.stringify(calls[0]!.providerOptions)).toBe(JSON.stringify(chatProviderOptions(config)));
    expect(usageRow().model).toBe(config.chatModel);

    const gen = one(mem.spans(), "llm-call");
    expect(gen.attributes["langfuse.observation.model.name"]).toBe(config.chatModel);
    expect(json(gen, "langfuse.observation.model.parameters")).toMatchObject({ effort: config.effort, max_output_tokens: config.maxOutputTokens });
  });

  it("with an override the call, trace generation, transcript and priced usage follow it", async () => {
    expect(OVERRIDE.model).not.toBe(config.chatModel);
    await drain(processChat(crypto.randomUUID(), USER_ID, "hi", undefined, { llm: OVERRIDE }));
    expect(requestedModels).toEqual([OVERRIDE.model]);
    expect(calls[0]!.maxOutputTokens).toBe(OVERRIDE.max_output_tokens);
    expect(calls[0]!.providerOptions).toEqual(chatProviderOptions({ ...config, effort: OVERRIDE.effort }) as never);

    const gen = one(mem.spans(), "llm-call");
    expect(gen.attributes["langfuse.observation.model.name"]).toBe(OVERRIDE.model);
    expect(json(gen, "langfuse.observation.model.parameters")).toMatchObject({ effort: OVERRIDE.effort, max_output_tokens: OVERRIDE.max_output_tokens });
    const root = one(mem.spans(), "chat-turn");
    expect(root.attributes["langfuse.observation.metadata.effort"]).toBe(OVERRIDE.effort);
    expect(root.attributes["langfuse.observation.metadata.model"]).toBe(OVERRIDE.model);

    const row = usageRow();
    expect(row.model).toBe(OVERRIDE.model);
    expect(row.cost_microusd).toBe(expectedMicrousd(OVERRIDE.model));
    expect(row.cost_microusd).not.toBe(expectedMicrousd(config.chatModel));
    expect(transcriptModels().map((r) => r.model)).toEqual([OVERRIDE.model]);
  });

  it("an override never leaks into the next turn", async () => {
    await drain(processChat(crypto.randomUUID(), USER_ID, "hi", undefined, { llm: OVERRIDE }));
    await drain(processChat(crypto.randomUUID(), USER_ID, "hi"));
    expect(requestedModels).toEqual([OVERRIDE.model, config.chatModel]);
    expect(calls.map((c) => c.maxOutputTokens)).toEqual([OVERRIDE.max_output_tokens, config.maxOutputTokens]);
  });
});

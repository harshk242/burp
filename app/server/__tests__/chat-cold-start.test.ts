import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { loadLLMConfig, sanitizeToolName } from "../llm";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";
import type { StreamEvent } from "../orchestration/types";

const USER_ID = "55555555-5555-4555-8555-555555555555";
const TOOL_FULL_NAME = [...ALWAYS_LOADED_TOOLS][0]!;
const TOOL_KEY = sanitizeToolName(TOOL_FULL_NAME, loadLLMConfig().provider);

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

let model: MockLanguageModelV4;
mock.module("../llm/provider", () => ({
  getChatModel: () => model,
  getTitleModel: () => model,
}));

const { processChat } = await import("../orchestration/chat-v2");
const { trackToolsBoot } = await import("../boot/tools");

function answerModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "answer" });
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
          });
          controller.close();
        },
      }),
    }),
  });
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

beforeEach(() => {
  q.userQueries.create(USER_ID, "clerk_cold", "cold@example.com", null, null, "user", null, null);
  model = answerModel();
});

afterEach(() => {
  trackToolsBoot(null);
  toolRegistry.clear();
  t.sqlite.run("DELETE FROM usage_events");
  t.sqlite.run("DELETE FROM chat_turns");
  t.sqlite.run("DELETE FROM messages");
  t.sqlite.run("DELETE FROM chat_sessions");
  t.sqlite.run("DELETE FROM users");
});

afterAll(() => t.sqlite.close());

describe("chat during a cold start", () => {
  it("waits for tool boot instead of running against an empty catalog", async () => {
    const boot = Promise.withResolvers<void>();
    trackToolsBoot(boot.promise);
    expect(toolRegistry.availableCount).toBe(0);

    const turn = collect(processChat(crypto.randomUUID(), USER_ID, "hi"));
    await Bun.sleep(20);
    expect(model.doStreamCalls).toHaveLength(0);

    const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
    toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
    boot.resolve();

    const events = await turn;
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    expect(events.some((e) => e.type === "done")).toBe(true);

    const call = model.doStreamCalls[0]!;
    expect(call.tools?.map((tool) => tool.name)).toContain(TOOL_KEY);
    const system = call.prompt.find((m) => m.role === "system");
    expect(JSON.stringify(system)).toContain(TOOL_FULL_NAME);
  });

  it("still runs the turn when tool boot fails", async () => {
    const { server, name } = toolRegistry.parseToolName(TOOL_FULL_NAME);
    toolRegistry.register(server, { name, description: "test tool", inputSchema: { type: "object", properties: {} } });
    const failedBoot = Promise.reject(new Error("mcp spawn failed"));
    failedBoot.catch(() => {});
    trackToolsBoot(failedBoot);

    const events = await collect(processChat(crypto.randomUUID(), USER_ID, "hi"));
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});

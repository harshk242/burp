/**
 * Signal-safe cleanup: SIGINT during a slow turn (real item task and
 * processChat, mock model) aborts the turn and waits for its `finally` (root
 * span end, online scores) before tracing is shut down and MCP stopped. A
 * second signal exits at once.
 */
import { afterAll, afterEach, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createTestDb } from "../../server/__test-utils__/db";
import { createQueries } from "../../server/db/queries";
import type { ModelOptions } from "../../server/llm";
import { toolRegistry } from "../../server/mcp/registry";
import { ALWAYS_LOADED_TOOLS } from "../../server/mcp/platforms.config";
import * as langfuse from "../../server/observability/langfuse";
import { initTracing, resetTracingForTests } from "../../server/observability/langfuse";
import { SharedCostBudget } from "../../server/orchestration/cost-budget";
import { RunLifecycle } from "../lib/lifecycle";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const t = createTestDb();
const q = createQueries(t.db);
mock.module("../../server/db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

let started: () => void = () => {};
let transport: ModelOptions["fetch"];
const slowModel = new MockLanguageModelV4({
  doStream: async ({ abortSignal }) => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "t" });
        controller.enqueue({ type: "text-delta", id: "t", delta: "thinking slowly" });
        abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
        setTimeout(() => started(), 0);
      },
    });
    await transport?.("https://model.test/", { signal: abortSignal });
    return { stream };
  },
});
mock.module("../../server/llm/provider", () => ({
  getChatModel: (options?: ModelOptions) => {
    transport = options?.fetch;
    return slowModel;
  },
  getTitleModel: () => slowModel,
}));

const { createItemTask, RunStoppedError } = await import("../lib/task");

const events: string[] = [];
const rootEnds: SpanProcessor = {
  onStart: () => {},
  onEnd: (span: ReadableSpan) => {
    if (span.name === "chat-turn") events.push(`root-end:${span.attributes["langfuse.observation.level"]}`);
  },
  forceFlush: async () => {},
  shutdown: async () => {},
};

beforeEach(() => {
  events.length = 0;
  resetTracingForTests();
  initTracing({ spanProcessors: [rootEnds] });
  spyOn(langfuse, "getScoreClient").mockReturnValue({ score: { create: (b: { name: string; value: unknown }) => events.push(`score:${b.name}=${b.value}`) } } as never);
  spyOn(globalThis, "fetch").mockImplementation((async () => new Response(null)) as unknown as typeof fetch);
});

afterEach(() => mock.restore());

afterAll(() => {
  resetTracingForTests();
  t.sqlite.close();
});

it("SIGINT during a slow turn: the turn's finally runs before tracing shutdown", async () => {
  q.userQueries.create(USER_ID, "clerk_l", "l@example.com", null, null, "user", null, null);
  const [full] = [...ALWAYS_LOADED_TOOLS];
  const { server, name } = toolRegistry.parseToolName(full!);
  toolRegistry.register(server, { name, description: "t", inputSchema: { type: "object", properties: {} } });

  let exited: (code: number) => void = () => {};
  const exitCode = new Promise<number>((resolve) => (exited = resolve));
  const lifecycle = new RunLifecycle({
    shutdownTracing: async () => void events.push("shutdownTracing"),
    stopMcp: async () => void events.push("stopMcp"),
    exit: (code) => {
      events.push(`exit:${code}`);
      exited(code);
    },
    log: () => {},
  });
  const removeHandlers = lifecycle.installSignalHandlers();
  try {
    const task = createItemTask({ userId: USER_ID, provider: "anthropic", budget: SharedCostBudget.usd(100), lifecycle, log: () => {} });
    const turnStarted = new Promise<void>((resolve) => (started = resolve));
    const item = task({ id: "slow-item", input: { turns: ["first", "never sent"] } });
    item.catch(() => {});
    await turnStarted;

    process.emit("SIGINT");
    expect(await exitCode).toBe(130);
    await expect(item).rejects.toBeInstanceOf(RunStoppedError);

    expect(events).toEqual([
      "root-end:WARNING",
      "score:turn_outcome=aborted",
      "score:answer_truncated=0",
      "score:tool_error_count=0",
      "shutdownTracing",
      "stopMcp",
      "exit:130",
    ]);
    // Only the first turn ran; no new turn launched after the signal.
    expect(t.sqlite.query<{ n: number }, []>("SELECT count(*) AS n FROM chat_turns").get()!.n).toBe(1);
  } finally {
    removeHandlers();
    toolRegistry.clear();
  }
});

it("a second signal exits immediately; cleanup is idempotent", async () => {
  const codes: number[] = [];
  let calls = 0;
  let release!: () => void;
  const lifecycle = new RunLifecycle({
    shutdownTracing: () => {
      calls++;
      return new Promise<void>((resolve) => (release = resolve));
    },
    stopMcp: async () => {},
    exit: (code) => codes.push(code),
    log: () => {},
  });
  const first = lifecycle.onSignal("SIGTERM");
  await Bun.sleep(1);
  await lifecycle.onSignal("SIGINT");
  expect(codes).toEqual([130]);
  release();
  await first;
  await lifecycle.cleanup();
  expect(calls).toBe(1);
  expect(codes).toEqual([130, 143]);
  expect(lifecycle.abort.signal.aborted).toBe(true);
});

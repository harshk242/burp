import { afterAll, afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Tool } from "ai";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import type { StreamEvent } from "../orchestration/types";

const t = createTestDb();
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...createQueries(t.db) }));

const { dispatchToolCall } = await import("../orchestration/tool-dispatch");
const { hybridSearch } = await import("../search");

const SEARCH = "system__search_available_tools";
const SYSTEM = "system__inspect_artifact";

function context(turn: AbortController, activeTools: Record<string, Tool> = {}) {
  return {
    sessionId: "s1",
    provider: "anthropic" as const,
    sanitize: (name: string) => name,
    activeTools,
    ctx: {},
    signal: turn.signal,
  };
}

async function run(
  toolName: string,
  turn: AbortController,
  activeTools: Record<string, Tool> = {},
  onEvent: (event: StreamEvent) => void = () => {},
) {
  const events: StreamEvent[] = [];
  const gen = dispatchToolCall({ toolCallId: "c1", toolName, input: { query: "q" } }, context(turn, activeTools));
  let error: unknown;
  try {
    for (;;) {
      const step = await gen.next();
      if (step.done) break;
      events.push(step.value);
      onEvent(step.value);
    }
  } catch (err) {
    error = err;
  }
  return { events, error };
}

const abortOnToolStart = (turn: AbortController) => (event: StreamEvent) => {
  if (event.type === "tool_start") turn.abort();
};

function systemTool(execute: Tool["execute"]): Record<string, Tool> {
  return { [SYSTEM]: { description: "test", inputSchema: { type: "object" } as never, execute } as Tool };
}

afterEach(() => mock.restore());
afterAll(() => t.sqlite.close());

describe("dispatchToolCall abort", () => {
  it("returns a failed search record alongside the error result", async () => {
    spyOn(hybridSearch, "search").mockRejectedValue(new Error("index unavailable"));
    const gen = dispatchToolCall(
      { toolCallId: "failed-search", toolName: SEARCH, input: { query: "TP53" } },
      context(new AbortController()),
    );
    const events: StreamEvent[] = [];
    for (;;) {
      const step = await gen.next();
      if (!step.done) { events.push(step.value); continue; }
      expect(step.value.record).toEqual({
        id: "failed-search", name: SEARCH, server: "system",
        toolName: "search_available_tools", input: { query: "TP53" }, error: "index unavailable",
      });
      expect(step.value.part.output).toMatchObject({ type: "error-text" });
      break;
    }
    expect(events.at(-1)).toMatchObject({ type: "tool_end", data: { error: "index unavailable" } });
  });

  it("search tool: abort at the tool_start write skips the search", async () => {
    const turn = new AbortController();
    const search = spyOn(hybridSearch, "search").mockResolvedValue([]);

    const { events, error } = await run(SEARCH, turn, {}, abortOnToolStart(turn));

    expect(search).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["tool_start"]);
    expect(error).toBe(turn.signal.reason);
  });

  it("search tool: a result that lands after the abort is dropped", async () => {
    const turn = new AbortController();
    spyOn(hybridSearch, "search").mockImplementation(async () => {
      turn.abort();
      return [];
    });

    const { events, error } = await run(SEARCH, turn);

    expect(events.map((e) => e.type)).toEqual(["tool_start"]);
    expect(error).toBe(turn.signal.reason);
  });

  it("search tool: an abort mid-search releases dispatch even if the embedder ignores it", async () => {
    const turn = new AbortController();
    let received: AbortSignal | undefined;
    hybridSearch.attachEmbeddings(
      {
        id: "stalled",
        embedQuery(_text, signal) {
          received = signal;
          return new Promise(() => {});
        },
      },
      new Map([["demo__tool", new Float32Array([1, 0])]]),
    );
    const activeTools: Record<string, Tool> = {};

    const pending = run(SEARCH, turn, activeTools);
    while (!received) await Bun.sleep(0);
    const started = performance.now();
    turn.abort();
    const { events, error } = await pending;

    expect(performance.now() - started).toBeLessThan(1000);
    expect(received).toBe(turn.signal);
    expect(events.map((e) => e.type)).toEqual(["tool_start"]);
    expect(error).toBe(turn.signal.reason);
    expect(Object.keys(activeTools)).toEqual([]);
  });

  it("system tool: abort at the tool_start write skips execution", async () => {
    const turn = new AbortController();
    const execute = mock(async () => "out");

    const { events, error } = await run(SYSTEM, turn, systemTool(execute), abortOnToolStart(turn));

    expect(execute).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["tool_start"]);
    expect(error).toBe(turn.signal.reason);
  });

  it("system tool: a result that lands after the abort is dropped", async () => {
    const turn = new AbortController();
    const execute = mock(async () => {
      turn.abort();
      return "out";
    });

    const { events, error } = await run(SYSTEM, turn, systemTool(execute));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(["tool_start"]);
    expect(error).toBe(turn.signal.reason);
  });
});

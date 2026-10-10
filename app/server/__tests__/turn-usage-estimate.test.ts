/**
 * CallTracker.estimateCutOffCall for a cut-off call after the first: the input
 * estimate is the previous call's prompt plus everything added since, including
 * tool declarations activated mid-turn (search_available_tools) and changed
 * instructions, so the estimate is never priced below the tier it reached.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { LanguageModelCallStartEvent } from "ai";
import { estimateTokens } from "../logger";
import { CallTracker } from "../orchestration/turn-usage";
import { UsageMeter } from "../orchestration/usage-meter";

const ctx = { session_id: "s", user_id: "u" };

type Tool = Record<string, unknown>;
const tool = (name: string, descriptionChars = 10): Tool => ({
  type: "function",
  name,
  description: "d".repeat(descriptionChars),
  inputSchema: { type: "object", properties: {} },
});

const deferred = (t: Tool): Tool => ({ ...t, providerOptions: { anthropic: { deferLoading: true } } });

/** A search_available_tools result referencing `names` (Anthropic). */
const references = (names: string[]) => ({
  role: "tool",
  content: [{
    type: "tool-result",
    toolCallId: "t1",
    toolName: "search_available_tools",
    output: {
      type: "content",
      value: names.map((toolName) => ({ type: "custom", providerOptions: { anthropic: { type: "tool-reference", toolName } } })),
    },
  }],
});

const request = (opts: { messages: number; tools: Tool[]; instructions?: string; extra?: unknown[] }) =>
  ({
    callId: "c",
    provider: "mock",
    modelId: "mock",
    instructions: opts.instructions ?? "system",
    messages: [
      ...Array.from({ length: opts.messages }, (_, i) => ({ role: "user", content: `m${i}` })),
      ...(opts.extra ?? []),
    ],
    tools: opts.tools,
  }) as unknown as LanguageModelCallStartEvent;

/** Runs one call through the tracker up to the point the provider accepted it. */
async function sendCall(tracker: CallTracker, iteration: number, req: LanguageModelCallStartEvent) {
  tracker.begin(iteration);
  tracker.onRequest(req);
  await tracker.fetch("https://model.test/");
}

/** Call 1 finishes with `promptTokens` of uncached input; call 2 is cut off. */
async function cutOffSecondCall(
  meter: UsageMeter,
  promptTokens: number,
  first: LanguageModelCallStartEvent,
  second: LanguageModelCallStartEvent
) {
  const tracker = new CallTracker();
  await sendCall(tracker, 1, first);
  tracker.finish(
    meter.add({ noCacheTokens: promptTokens, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 10 })
  );
  await sendCall(tracker, 2, second);
  return tracker.estimateCutOffCall()!;
}

describe("CallTracker.estimateCutOffCall", () => {
  beforeEach(() => {
    spyOn(globalThis, "fetch").mockImplementation((async () => new Response(null)) as unknown as typeof fetch);
  });
  afterEach(() => mock.restore());

  it("adds tool declarations activated since the previous call", async () => {
    const base = [tool("search_available_tools"), tool("always_loaded")];
    const added = [tool("found_a", 17_500), tool("found_b", 17_500)];
    const meter = new UsageMeter("anthropic", "claude-sonnet-5-5", ctx);
    const cutOff = await cutOffSecondCall(
      meter,
      5_000,
      request({ messages: 2, tools: base }),
      request({ messages: 2, tools: [...base, ...added] })
    );
    expect(cutOff.usage.noCacheTokens).toBeGreaterThanOrEqual(5_000 + estimateTokens(JSON.stringify(added)));
  });

  it("does not count unchanged tools or instructions again", async () => {
    const tools = [tool("a", 5_000), tool("b", 5_000)];
    const meter = new UsageMeter("anthropic", "claude-sonnet-5-5", ctx);
    const cutOff = await cutOffSecondCall(
      meter,
      5_000,
      request({ messages: 2, tools }),
      request({ messages: 2, tools: [...tools].reverse() })
    );
    expect(cutOff.usage.noCacheTokens).toBe(5_000 + estimateTokens("[]"));
  });

  it("adds the instructions when they changed", async () => {
    const instructions = "x".repeat(8_000);
    const meter = new UsageMeter("anthropic", "claude-sonnet-5-5", ctx);
    const cutOff = await cutOffSecondCall(
      meter,
      5_000,
      request({ messages: 2, tools: [] }),
      request({ messages: 2, tools: [], instructions })
    );
    expect(cutOff.usage.noCacheTokens).toBeGreaterThanOrEqual(5_000 + estimateTokens(JSON.stringify(instructions)));
  });

  it("prices a call pushed over Haiku 5.5's long-context threshold by new tools at the long-context tier", async () => {
    const base = [tool("search_available_tools")];
    // ~35,000 chars of new declarations ≈ 10,000 tokens: 99,020 → above 100,000.
    const added = Array.from({ length: 5 }, (_, i) => tool(`found_${i}`, 7_000));
    const meter = new UsageMeter("anthropic", "claude-haiku-5-5", ctx);
    const cutOff = await cutOffSecondCall(
      meter,
      99_020,
      request({ messages: 2, tools: base }),
      request({ messages: 2, tools: [...base, ...added] })
    );
    const call = meter.add(cutOff.usage, { estimated: true });
    expect(call.promptTokens).toBeGreaterThan(100_000);
    expect(call.tier).toBe("long_context");
  });

  it("first call: undiscovered deferred tools are not counted", async () => {
    const tracker = new CallTracker();
    await sendCall(tracker, 1, request({ messages: 1, tools: [tool("core"), deferred(tool("big", 35_000))] }));
    const withDeferred = tracker.estimateCutOffCall()!.usage.noCacheTokens;
    await sendCall(tracker, 1, request({ messages: 1, tools: [tool("core")] }));
    expect(withDeferred).toBe(tracker.estimateCutOffCall()!.usage.noCacheTokens);
  });

  it("adds a deferred tool's definition once a search result references it", async () => {
    const big = deferred(tool("big", 35_000));
    const tools = [tool("search_available_tools"), big];
    const meter = new UsageMeter("anthropic", "claude-sonnet-5-5", ctx);
    const cutOff = await cutOffSecondCall(
      meter,
      5_000,
      request({ messages: 2, tools }),
      request({ messages: 2, tools, extra: [references(["big"])] })
    );
    expect(cutOff.usage.noCacheTokens).toBeGreaterThanOrEqual(5_000 + estimateTokens(JSON.stringify([big])));
  });

  it("prices the input as a 5-minute cache write when the provider caches", async () => {
    const tracker = new CallTracker();
    await sendCall(tracker, 1, request({ messages: 2, tools: [tool("core")] }));
    const uncached = tracker.estimateCutOffCall()!.usage;
    const cached = tracker.estimateCutOffCall(true)!.usage;
    expect(cached.noCacheTokens).toBe(0);
    expect(cached.cacheWrite5mTokens).toBe(uncached.noCacheTokens);
  });
});

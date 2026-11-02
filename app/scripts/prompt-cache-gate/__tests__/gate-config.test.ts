import { expect, it } from "bun:test";
import { coldCacheWritten, parseGateEffort, preflightThinking } from "../gate-config";
import type { LLMConfig } from "../../../server/llm/config";

const config: LLMConfig = { provider: "anthropic", chatModel: "fixture-model", titleModel: "fixture-model", maxRetries: 0, maxOutputTokens: 100, maxContextTokens: 1000, maxToolIterations: 3, thinkingDisplay: "summarized", effort: "high" };

it("parses only supported effort levels before any request", () => {
  expect(parseGateEffort()).toBe("high");
  for (const level of ["low", "medium", "high", "xhigh", "max"] as const) expect(parseGateEffort(level)).toBe(level);
  for (const invalid of ["", "HIGH", "arbitrary"]) expect(() => parseGateEffort(invalid)).toThrow("GATE_EFFORT");
});

it("preflights adaptive thinking and the selected effort using the Models API", async () => {
  let requests = 0;
  const api = (adaptive: boolean, effort: boolean) => ({ apiKey: "offline", fetch: (async (url: string | URL | Request) => {
    requests++;
    expect(String(url)).toEndWith("/models/fixture-model");
    return Response.json({ id: "fixture-model", capabilities: { thinking: { types: { adaptive: { supported: adaptive } } }, effort: { supported: true, high: { supported: effort } } } });
  }) as typeof fetch });
  await expect(preflightThinking(config, "high", api(false, true))).rejects.toThrow("adaptive thinking");
  await expect(preflightThinking(config, "high", api(true, false))).rejects.toThrow("effort level");
  await preflightThinking(config, "high", api(true, true));
  await expect(preflightThinking({ ...config, provider: "google" }, "high", api(true, true))).rejects.toThrow("Anthropic");
  expect(requests).toBe(3);
});

it("judges cold-cache creation by observed usage rather than a model-independent token threshold", () => {
  expect(coldCacheWritten({ cacheRead: 0, cacheWrite: 1 })).toBe(true);
  expect(coldCacheWritten({ cacheRead: 0, cacheWrite: 0 })).toBe(false);
  expect(coldCacheWritten({ cacheRead: 5000, cacheWrite: 10 })).toBe(false);
  expect(coldCacheWritten({})).toBe(false);
});

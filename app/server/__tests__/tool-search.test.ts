import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { generateText, jsonSchema, tool, type ModelMessage, type Tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { appConfig } from "../config";
import { sanitizeToolName } from "../llm";
import { toolRegistry } from "../mcp/registry";
import { HybridToolSearch, type SearchResult } from "../search/hybrid-search";
import type { StreamEvent } from "../orchestration/types";

const t = createTestDb();
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...createQueries(t.db) }));

const { runToolSearch } = await import("../orchestration/tools/search-tool");
const { dispatchToolCall } = await import("../orchestration/tool-dispatch");
const { hybridSearch } = await import("../search");

const SEARCH = "system__search_available_tools";
const CORE = "open-targets__search_entities";
const HITS = [CORE, "chembl__get_mechanism_of_action", "open-targets__get_drug_info"];
const schema = { type: "object", properties: {} };
const description = (fullName: string) => `UNIQUE-DESC ${fullName}`;

function hit(fullName: string, score: number): SearchResult {
  const { server, name } = toolRegistry.parseToolName(fullName);
  return { fullName, server, toolName: name, description: description(fullName), score };
}

function mockSearch(fullNames: string[] = HITS) {
  return spyOn(hybridSearch, "search").mockResolvedValue(fullNames.map((n, i) => hit(n, 0.03 - i * 0.001)));
}

async function dispatch(provider: "anthropic" | "google", activeTools: Record<string, Tool>) {
  const sanitize = (n: string) => sanitizeToolName(n, provider);
  const gen = dispatchToolCall(
    { toolCallId: "c1", toolName: SEARCH, input: { query: "drug mechanism" } },
    { sessionId: "s1", provider, sanitize, activeTools, ctx: {} },
  );
  const events: StreamEvent[] = [];
  for (;;) {
    const step = await gen.next();
    if (step.done) return { events, result: step.value };
    events.push(step.value);
  }
}

beforeEach(() => {
  for (const fullName of HITS) {
    const { server, name } = toolRegistry.parseToolName(fullName);
    toolRegistry.register(server, { name, description: description(fullName), inputSchema: schema });
  }
});

afterEach(() => {
  mock.restore();
  toolRegistry.clear();
});

afterAll(() => t.sqlite.close());

describe("top_k", () => {
  it("returns tool_search.top_k tools when more match", async () => {
    expect(appConfig.tool_search.top_k).toBe(5);
    const search = new HybridToolSearch(createQueries(createTestDb().db).toolSearchQueries);
    search.indexTools(
      Array.from({ length: 12 }, (_, i) => ({
        fullName: `demo__protein_${i}`, server: "demo", toolName: `protein_${i}`, description: "protein lookup",
      })),
    );
    expect(await search.search("protein")).toHaveLength(appConfig.tool_search.top_k);
  });
});

describe("runToolSearch", () => {
  it("Anthropic: one tool-reference per tool shown, no text, no descriptions", async () => {
    mockSearch();
    const run = await runToolSearch("q", { provider: "anthropic", sanitize: (n) => n });

    expect(run.modelOutput).toEqual({
      type: "content",
      value: HITS.map((toolName) => ({
        type: "custom",
        providerOptions: { anthropic: { type: "tool-reference", toolName } },
      })),
    });
    expect(run.uiSummary.tools.map((x) => x.name)).toEqual(HITS);
    expect(JSON.stringify(run.modelOutput)).not.toContain("UNIQUE-DESC");
  });

  it("Gemini: name + score text only, sanitized names", async () => {
    mockSearch();
    const run = await runToolSearch("q", { provider: "google", sanitize: (n) => sanitizeToolName(n, "google") });

    expect(run.modelOutput.type).toBe("text");
    const text = (run.modelOutput as { value: string }).value;
    for (const h of run.hits) expect(text).toContain(`- ${h.name} (score ${h.score.toFixed(4)})`);
    expect(run.hits.map((h) => h.name)).toEqual(HITS.map((n) => n.replace(/-/g, "_")));
    expect(text).not.toContain("UNIQUE-DESC");
  });

  it("UI summary keeps name, description and score", async () => {
    mockSearch();
    const run = await runToolSearch("q", { provider: "anthropic", sanitize: (n) => n });
    expect(run.uiSummary.found).toBe(HITS.length);
    expect(run.uiSummary.tools).toEqual(
      HITS.map((name, i) => ({ name, description: description(name), relevance_score: 0.03 - i * 0.001 })),
    );
  });

  it("zero hits: a text-only result (references and text can't mix)", async () => {
    mockSearch([]);
    const run = await runToolSearch("q", { provider: "anthropic", sanitize: (n) => n });
    expect(run.modelOutput).toEqual({ type: "text", value: expect.stringContaining("No matching tools") });
    expect(run.uiSummary.tools).toEqual([]);
  });

  it("drops hits that aren't registered from both outputs", async () => {
    mockSearch([...HITS, "ghost__tool"]);
    const run = await runToolSearch("q", { provider: "anthropic", sanitize: (n) => n });
    expect(run.hits.map((h) => h.name)).toEqual(HITS);
    expect(run.uiSummary.found).toBe(HITS.length);
  });

  it("Anthropic: drops hits the turn's catalog doesn't declare (registered mid-turn)", async () => {
    mockSearch();
    const declared = { [SEARCH]: {}, [HITS[0]!]: {}, [HITS[2]!]: {} };
    const run = await runToolSearch("q", { provider: "anthropic", sanitize: (n) => n, declared });
    expect(run.hits.map((h) => h.name)).toEqual([HITS[0], HITS[2]]);
    expect(JSON.stringify(run.modelOutput)).not.toContain(HITS[1]);
    expect(run.uiSummary.found).toBe(2);
  });
});

describe("search dispatch", () => {
  it("Anthropic: adds no tools; the model gets references, the UI and DB the summary", async () => {
    mockSearch();
    const activeTools: Record<string, Tool> = {};
    for (const name of [SEARCH, ...HITS]) activeTools[name] = { description: name, inputSchema: schema } as unknown as Tool;
    const declared = Object.keys(activeTools);
    const { events, result } = await dispatch("anthropic", activeTools);

    expect(Object.keys(activeTools)).toEqual(declared);
    expect(JSON.stringify(result.part.output)).toContain(HITS[2]);
    const end = events.find((e) => e.type === "tool_end")!;
    const summary = (end.data as { output: { tools: { description: string }[] } }).output;
    expect(summary.tools.map((x) => x.description)).toEqual(HITS.map(description));
    expect(result.record?.output).toEqual(summary);
    expect(result.part.output.type).toBe("content");
    expect(JSON.stringify(result.part.output)).not.toContain("UNIQUE-DESC");
  });

  it("Gemini: activates exactly the tools shown", async () => {
    mockSearch();
    const activeTools: Record<string, Tool> = {};
    const { result } = await dispatch("google", activeTools);

    const shown = (result.record?.output as { tools: { name: string }[] }).tools.map((x) => x.name);
    expect(Object.keys(activeTools).sort()).toEqual([...shown].sort());
    expect(shown).toEqual(HITS.map((n) => n.replace(/-/g, "_")));
  });
});

describe("Anthropic request body", () => {
  it("the search result is a tool_result of tool_reference blocks only", async () => {
    mockSearch();
    const run = await runToolSearch("q", { provider: "anthropic", sanitize: (n) => n });
    let body: { messages: { content: { type: string; content?: unknown }[] }[] } | undefined;
    const anthropic = createAnthropic({
      apiKey: "test",
      fetch: (async (_url: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return new Response("{}", { status: 500 });
      }) as typeof fetch,
    });
    const tools: Record<string, Tool> = {};
    for (const name of [SEARCH, ...HITS]) {
      tools[name] = tool({ description: name, inputSchema: jsonSchema(schema) });
      if (name !== SEARCH && name !== CORE) tools[name]!.providerOptions = { anthropic: { deferLoading: true } };
    }
    const messages: ModelMessage[] = [
      { role: "user", content: "find drug tools" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: SEARCH, input: { query: "q" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: SEARCH, output: run.modelOutput }] },
    ];

    await generateText({ model: anthropic("claude-sonnet-5-5"), tools, messages, maxRetries: 0 }).catch(() => {});

    const toolResult = body!.messages.at(-1)!.content.find((c) => c.type === "tool_result")!;
    expect(toolResult.content).toEqual(HITS.map((tool_name) => ({ type: "tool_reference", tool_name })));
  });
});

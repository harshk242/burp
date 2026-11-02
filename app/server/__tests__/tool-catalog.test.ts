import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { sanitizeToolName } from "../llm";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { toolRegistry } from "../mcp/registry";
import { logger } from "../logger";
import type { StreamEvent } from "../orchestration/types";

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));

const model = new MockLanguageModelV4();
mock.module("../llm/provider", () => ({ getChatModel: () => model, getTitleModel: () => model }));

const { buildToolCatalog, countDeferred, INSPECT_TOOL_NAME, SEARCH_TOOL_NAME } = await import(
  "../orchestration/context/tool-catalog"
);
const { processChat } = await import("../orchestration/chat-v2");

const USER_ID = "33333333-3333-4333-8333-333333333333";
const CORE = "open-targets__search_entities";
const SYSTEM_TOOLS = [INSPECT_TOOL_NAME, SEARCH_TOOL_NAME];
const identity = (name: string) => name;
const schema = { type: "object", properties: {} };

function register(fullNames: string[], available = true) {
  for (const fullName of fullNames) {
    const { server, name } = toolRegistry.parseToolName(fullName);
    toolRegistry.register(server, { name, description: `does ${name}`, inputSchema: schema }, available);
  }
}

function declarations(tools: ReturnType<typeof buildToolCatalog>) {
  return Object.entries(tools).map(([key, tool]) => [key, tool.description, tool.providerOptions ?? null]);
}

const deferred = (tools: ReturnType<typeof buildToolCatalog>, key: string) =>
  tools[key]!.providerOptions?.anthropic?.deferLoading === true;

beforeEach(() => {
  expect(ALWAYS_LOADED_TOOLS.has(CORE)).toBe(true);
  register(["uniprot__zeta", CORE, "chembl__get_drug_info", "ensembl__alpha"]);
  register(["pubmed__fetch_down", "chembl__search_compounds"], false);
});

afterEach(() => {
  mock.restore();
  toolRegistry.clear();
});

afterAll(() => t.sqlite.close());

describe("buildToolCatalog (anthropic)", () => {
  it("declares every registered tool, available or not, sorted by name", () => {
    const tools = buildToolCatalog("anthropic", identity, "s1");
    const keys = Object.keys(tools);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual([
      "chembl__get_drug_info",
      "chembl__search_compounds",
      "ensembl__alpha",
      "open-targets__search_entities",
      "pubmed__fetch_down",
      INSPECT_TOOL_NAME,
      SEARCH_TOOL_NAME,
      "uniprot__zeta",
    ]);
    expect(tools["chembl__get_drug_info"]!.description).toBe("[chembl] does get_drug_info");
  });

  it("loads core and system tools and defers everything else", () => {
    const tools = buildToolCatalog("anthropic", identity, "s1");
    const loaded = Object.keys(tools).filter((key) => !deferred(tools, key));
    expect(loaded).toEqual([
      "chembl__search_compounds",
      CORE,
      INSPECT_TOOL_NAME,
      SEARCH_TOOL_NAME,
    ]);
    expect(countDeferred(tools)).toBe(4);
    expect(tools[INSPECT_TOOL_NAME]!.execute).toBeFunction();
    expect(tools[SEARCH_TOOL_NAME]!.execute).toBeUndefined();
  });

  it("keeps at least one tool loaded with an empty registry", () => {
    toolRegistry.clear();
    const tools = buildToolCatalog("anthropic", identity, "s1");
    expect(Object.keys(tools)).toEqual(SYSTEM_TOOLS);
    expect(countDeferred(tools)).toBe(0);
  });

  it("is identical across builds and availability changes, and doesn't warn", () => {
    const first = declarations(buildToolCatalog("anthropic", identity, "s1"));
    const warn = spyOn(logger, "warn");
    toolRegistry.setAllAvailability(false);
    const second = declarations(buildToolCatalog("anthropic", identity, "s2"));
    toolRegistry.setAllAvailability(true);
    const third = declarations(buildToolCatalog("anthropic", identity, "s3"));
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(warn.mock.calls.filter(([, event]) => event === "catalog_changed")).toEqual([]);
  });

  it("logs catalog_changed with old/new hash and count when the catalog changes", () => {
    buildToolCatalog("anthropic", identity, "s1");
    const warn = spyOn(logger, "warn");
    register(["reactome__search_pathways"]);
    const tools = buildToolCatalog("anthropic", identity, "s1");
    const calls = warn.mock.calls.filter(([, event]) => event === "catalog_changed");
    expect(calls).toHaveLength(1);
    const data = (calls[0]![2] as { data: { old_hash: string; new_hash: string; tool_count: number } }).data;
    expect(data.old_hash).not.toBe(data.new_hash);
    expect(data.tool_count).toBe(Object.keys(tools).length);
  });
});

describe("buildToolCatalog (google)", () => {
  it("returns today's set: available core tools plus the system tools, nothing deferred", () => {
    const sanitize = (name: string) => sanitizeToolName(name, "google");
    const tools = buildToolCatalog("google", sanitize, "s1");
    expect(Object.keys(tools).sort()).toEqual(["open_targets__search_entities", ...SYSTEM_TOOLS].sort());
    expect(countDeferred(tools)).toBe(0);
    expect(tools["open_targets__search_entities"]!.execute).toBeUndefined();
  });
});

describe("processChat with every server down", () => {
  it("returns the 'No MCP tools available' error before any LLM call", async () => {
    q.userQueries.create(USER_ID, "clerk_catalog", "catalog@example.com", null, null, "user", null, null);
    toolRegistry.setAllAvailability(false);
    const doStream = spyOn(model, "doStream");

    const events: StreamEvent[] = [];
    for await (const event of processChat("cat-s1", USER_ID, "hi")) events.push(event);

    expect(events.at(-1)).toEqual({
      type: "error",
      data: { error: "No MCP tools available. All database servers may be down.", code: "no_tools_available" },
    });
    expect(doStream).not.toHaveBeenCalled();
    expect(t.sqlite.query("SELECT * FROM usage_events").all()).toEqual([]);
    expect(q.chatTurnQueries.findBySessionId("cat-s1")).toEqual([
      expect.objectContaining({ status: "error", error_code: "no_tools_available", iterations: 0 }),
    ]);
  });
});

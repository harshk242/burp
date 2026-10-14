import { randomUUID } from "node:crypto";
import { streamText, type ModelMessage, type SystemModelMessage, type Tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { initializeTools, type ToolsBoot } from "../../server/boot/tools";
import { runMigrations, sqlite } from "../../server/db";
import { mcpManager } from "../../server/mcp/manager";
import { toolRegistry } from "../../server/mcp/registry";
import { ALWAYS_LOADED_TOOLS } from "../../server/mcp/platforms.config";
import { loadLLMConfig } from "../../server/llm";
import { SYSTEM_PROMPT } from "../../server/orchestration/context/system-prompt";
import { createSearchTool } from "../../server/orchestration/tools/search-tool";
import { createInspectArtifactTool } from "../../server/orchestration/tools/artifact-inspector";
import { toDeclarations } from "../../server/orchestration/tool-dispatch";
import { MOA_HITS, sha, verdict, verdicts } from "./gate-lib";
import { check4b } from "./phase4b-checks";
import { checkRedactedOffline } from "./phase4b-redacted";

const MODEL_ID = loadLLMConfig().chatModel;
const MAX_OUTPUT = 256;
const SEARCH = "system__search_available_tools";
const INSPECT = "system__inspect_artifact";
const MIN_CACHEABLE = 512;
const RUN_ID = randomUUID().slice(0, 8);

interface Capture { status: number; beta: string | null; body: any; errorText?: string }
let last: Capture | null = null;

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  fetch: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    const res = await fetch(url, init);
    last = { status: res.status, beta: headers.get("anthropic-beta"), body };
    if (!res.ok) last.errorText = await res.clone().text();
    return res;
  },
});

type Mode = "core-only" | "deferred" | "all-loaded";

function mcpDecl(fullName: string): Tool {
  const t = toolRegistry.getVercelTool(fullName);
  if (!t) throw new Error(`unknown tool ${fullName}`);
  return t.tool;
}

function buildCatalog(mode: Mode, nonce: string): Record<string, Tool> {
  const system: Record<string, Tool> = toDeclarations({
    [SEARCH]: createSearchTool(),
    [INSPECT]: createInspectArtifactTool("phase0-session"),
  });
  system[SEARCH] = { ...system[SEARCH], description: `${system[SEARCH].description} (gate run ${nonce})` };
  const names = toolRegistry.getAll().map((t) => `${t.server}__${t.name}`);
  const entries: [string, Tool][] = [...Object.entries(system)];
  for (const name of names) {
    const core = ALWAYS_LOADED_TOOLS.has(name);
    if (mode === "core-only" && !core) continue;
    const decl = mcpDecl(name);
    entries.push([
      name,
      mode === "deferred" && !core ? { ...decl, providerOptions: { anthropic: { deferLoading: true } } } : decl,
    ]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

type Cache = "cold" | "warm" | "none";

interface CallResult {
  label: string;
  cache: Cache;
  status: number;
  toolsSent: number;
  deferredSent: number;
  inputTokens?: number;
  noCache?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheCreation?: unknown;
  outputTokens?: number;
  finishReason?: string;
  toolCalls?: string[];
  text?: string;
  beta: string | null;
  error?: string;
  toolsHash?: string;
  systemHash?: string;
}

const results: CallResult[] = [];

async function runCall(
  label: string,
  cache: Cache,
  opts: { tools: Record<string, Tool>; messages: ModelMessage[]; cacheSystem?: boolean; maxOutput?: number },
): Promise<CallResult & { responseMessages: ModelMessage[]; body?: any }> {
  const instructions: SystemModelMessage | string = opts.cacheSystem
    ? { role: "system", content: SYSTEM_PROMPT, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
    : SYSTEM_PROMPT;
  last = null;
  let text = "";
  let r: CallResult & { responseMessages: ModelMessage[] };
  try {
    const result = streamText({
      model: anthropic(MODEL_ID),
      instructions,
      messages: opts.messages,
      tools: opts.tools,
      maxRetries: 0,
      onError: () => {},
      maxOutputTokens: opts.maxOutput ?? MAX_OUTPUT,
    });
    for await (const t of result.textStream) text += t;
    const usage = await result.usage;
    const step = await result.finalStep;
    const raw = step.providerMetadata?.anthropic?.usage as Record<string, unknown> | undefined;
    r = {
      label,
      cache,
      status: last?.status ?? -1,
      toolsSent: last?.body?.tools?.length ?? 0,
      deferredSent: (last?.body?.tools ?? []).filter((t: any) => t.defer_loading).length,
      inputTokens: usage.inputTokens,
      noCache: usage.inputTokenDetails?.noCacheTokens,
      cacheRead: usage.inputTokenDetails?.cacheReadTokens,
      cacheWrite: usage.inputTokenDetails?.cacheWriteTokens,
      cacheCreation: raw?.cache_creation,
      outputTokens: usage.outputTokens,
      finishReason: await result.finishReason,
      toolCalls: (await result.toolCalls).map((c) => c.toolName),
      text: text.slice(0, 120),
      beta: last?.beta ?? null,
      responseMessages: step.response.messages,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    r = {
      label,
      cache,
      status: last?.status ?? -1,
      toolsSent: last?.body?.tools?.length ?? 0,
      deferredSent: (last?.body?.tools ?? []).filter((t: any) => t.defer_loading).length,
      beta: last?.beta ?? null,
      error: `${error}${last?.errorText ? ` | ${last.errorText.slice(0, 400)}` : ""}`,
      responseMessages: [],
    };
  }
  const body = last?.body;
  if (body) Object.assign(r, { toolsHash: sha(body.tools), systemHash: sha(body.system) });
  const { responseMessages: _, ...row } = r;
  results.push(row);
  console.log(`\n[${label}] (${cache} cache)`, JSON.stringify(row, null, 2));
  return { ...r, body };
}

const ok = (c: CallResult) => c.status === 200 && !c.error;
const tok = (c: CallResult) => `in ${c.inputTokens} = noCache ${c.noCache} + read ${c.cacheRead} + write ${c.cacheWrite}`;

function withCacheMarkers(messages: ModelMessage[], prevLastIndex?: number): ModelMessage[] {
  const mark = (m: ModelMessage): ModelMessage =>
    ({ ...m, providerOptions: { ...m.providerOptions, anthropic: { ...m.providerOptions?.anthropic, cacheControl: { type: "ephemeral" } } } }) as ModelMessage;
  return messages.map((m, i) => (i === messages.length - 1 || i === prevLastIndex ? mark(m) : m));
}

type SearchShape = "mixed" | "refs";
const HIT_TEXT = (tools: { name: string; score: number }[]) =>
  `Found ${tools.length} tools. Call one by its exact name:\n` + tools.map((t) => `- ${t.name} (score ${t.score.toFixed(2)})`).join("\n");

function searchOutput(tools: { name: string; score: number }[], shape: SearchShape = "refs") {
  const refs = tools.map((t) => ({ type: "custom" as const, providerOptions: { anthropic: { type: "tool-reference", toolName: t.name } } }));
  return {
    type: "content" as const,
    value: shape === "mixed" ? [{ type: "text" as const, text: HIT_TEXT(tools) }, ...refs] : refs,
  };
}

const searchResult = (id: string, tools: { name: string; score: number }[], shape: SearchShape = "refs"): ModelMessage =>
  ({ role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName: SEARCH, output: searchOutput(tools, shape) }] });

function searchTurn(id: string, query: string, tools: { name: string; score: number }[], shape: SearchShape = "refs"): ModelMessage[] {
  return [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: SEARCH, input: { query } }] },
    searchResult(id, tools, shape),
  ];
}

function inspectBody(body: any) {
  const refs: string[] = [];
  const marked: string[] = [];
  if (Array.isArray(body?.system)) body.system.forEach((b: any, i: number) => b.cache_control && marked.push(`system[${i}]`));
  (body?.messages ?? []).forEach((m: any, mi: number) => {
    if (!Array.isArray(m.content)) return;
    m.content.forEach((b: any, bi: number) => {
      if (b.cache_control) marked.push(`messages[${mi}].${b.type}[${bi}]`);
      if (b.type === "tool_result" && Array.isArray(b.content))
        for (const c of b.content) if (c.type === "tool_reference") refs.push(c.tool_name);
    });
  });
  return { toolReferences: refs, cacheControlOn: marked };
}

const ask = (content: string): ModelMessage[] => [{ role: "user", content }];
const PROBE = "Reply with exactly the word OK. Do not call any tools.";

async function check5() {
  const c = await runCall("5 call1 deferred + system cacheControl", "cold", {
    tools: buildCatalog("deferred", `${RUN_ID}-c5`),
    messages: ask(PROBE),
    cacheSystem: true,
  });
  console.log("\n── check 5 verdicts ──");
  verdict("5 call 1 → 200", "required", ok(c), `HTTP ${c.status}${c.error ? ` — ${c.error}` : ""}`);
  verdict("5 prompt ≥ min cacheable", "required", (c.inputTokens ?? 0) >= MIN_CACHEABLE, `inputTokens ${c.inputTokens} vs ${MIN_CACHEABLE}`);
  verdict("5 cold: cacheRead = 0", "required", c.cacheRead === 0, `cacheRead ${c.cacheRead} (non-zero = the nonce didn't make it cold)`);
  verdict("5 cold call 1 writes the cache", "required", (c.cacheWrite ?? 0) > 0, `${tok(c)}; cache_creation ${JSON.stringify(c.cacheCreation)}`);
}

async function check1() {
  const nonce = `${RUN_ID}-c1`;
  const a = await runCall("1a core-only (deferred absent)", "none", { tools: buildCatalog("core-only", nonce), messages: ask(PROBE) });
  const b = await runCall("1b deferred present", "none", { tools: buildCatalog("deferred", nonce), messages: ask(PROBE) });
  const c = await runCall("1c control: all tools loaded", "none", { tools: buildCatalog("all-loaded", nonce), messages: ask(PROBE) });
  const nonCore = toolRegistry.getAll().filter((t) => !ALWAYS_LOADED_TOOLS.has(`${t.server}__${t.name}`)).length;
  const deferredDelta = (b.inputTokens ?? NaN) - (a.inputTokens ?? NaN);
  const loadedDelta = (c.inputTokens ?? NaN) - (a.inputTokens ?? NaN);
  console.log("\n── check 1 verdicts ──");
  verdict("1 all three → 200", "required", [a, b, c].every(ok), [a, b, c].map((x) => `${x.label}: ${x.status}${x.error ? ` — ${x.error}` : ""}`).join("; "));
  verdict("1 deferred flags sent", "required", b.deferredSent === nonCore && b.deferredSent > 0, `${b.deferredSent} of ${b.toolsSent} tools deferred (${nonCore} non-core)`);
  verdict("1 deferred delta small", "required", deferredDelta >= 0 && deferredDelta <= 500 && loadedDelta >= 20 * Math.max(deferredDelta, 1),
    `deferred +${deferredDelta} tokens (limit 500) vs all-loaded +${loadedDelta} (${a.inputTokens} / ${b.inputTokens} / ${c.inputTokens})`);
}

const MOA_QUESTION =
  "Using ChEMBL, what is the mechanism of action of imatinib (CHEMBL941)? You don't have a suitable core tool, " +
  "so find one with system__search_available_tools first. Keep the answer to one sentence.";

const toolCallsOf = (msgs: ModelMessage[]) =>
  msgs.flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : [])).filter((p: any) => p.type === "tool-call") as any[];

async function check23() {
  const tools = buildCatalog("deferred", `${RUN_ID}-c23`);
  for (const h of MOA_HITS) if (ALWAYS_LOADED_TOOLS.has(h.name) || !tools[h.name]) throw new Error(`${h.name} must be a declared deferred tool`);
  const run = (label: string, cache: Cache, messages: ModelMessage[], prevLast?: number, maxOutput = 1024) =>
    runCall(label, cache, { tools, messages: withCacheMarkers(messages, prevLast), cacheSystem: true, maxOutput });

  const c1 = await run("2/3 call1 (user question)", "cold", ask(MOA_QUESTION));
  const searchCall = toolCallsOf(c1.responseMessages).find((p) => p.toolName === SEARCH);
  const query = searchCall?.input?.query ?? "mechanism of action of a drug in ChEMBL";
  console.log(`call1: model ${searchCall ? `called ${SEARCH} (query: ${JSON.stringify(query)})` : "did NOT call search → constructing the tool_use"}`);
  const id = searchCall?.toolCallId ?? "toolu_phase0_search_1";
  const base: ModelMessage[] = searchCall
    ? [...ask(MOA_QUESTION), ...c1.responseMessages]
    : [...ask(MOA_QUESTION), searchTurn(id, query, MOA_HITS)[0]];
  const prevLast1 = 0;

  const history: ModelMessage[] = [...base, searchResult(id, MOA_HITS, "refs")];
  const c2 = await run("2/3 call2 (tool_reference only)", "warm", history, prevLast1);
  const b2 = inspectBody(c2.body);
  console.log("call2 body:", JSON.stringify(b2));
  const called = toolCallsOf(c2.responseMessages);
  const refCall = called.find((p) => MOA_HITS.some((h) => h.name === p.toolName));
  console.log(`call2: tool calls ${JSON.stringify(called.map((p) => ({ name: p.toolName, input: p.input })))}`);

  const prevLast2 = history.length - 1;
  history.push(...c2.responseMessages);
  if (called.length) {
    history.push({
      role: "tool",
      content: called.map((p) => ({
        type: "tool-result" as const, toolCallId: p.toolCallId, toolName: p.toolName,
        output: { type: "text" as const, value: JSON.stringify({ molecule_chembl_id: "CHEMBL941", mechanism_of_action: "BCR/ABL, KIT and PDGFR tyrosine kinase inhibitor", action_type: "INHIBITOR", target_chembl_id: "CHEMBL1862" }) },
      })),
    });
  } else {
    history.push({ role: "user", content: "Continue." });
  }
  const c3 = await run("2/3 call3 (tool result replay)", "warm", history, prevLast2, 512);
  console.log("call3 body:", JSON.stringify(inspectBody(c3.body)));

  const pA = await run("2 probe A: text + tool_reference in one tool_result", "warm", [...base, searchResult(id, MOA_HITS, "mixed")], prevLast1);
  const pB = await run("2 probe B: tool_reference only + text as a separate user block", "warm",
    [...base, searchResult(id, MOA_HITS), { role: "user", content: HIT_TEXT(MOA_HITS) }], prevLast1);

  const seq = [c1, c2, c3];
  const same = (k: "toolsHash" | "systemHash") => new Set(seq.map((c) => c[k])).size === 1;
  const prompt = (c: CallResult) => (c.cacheRead ?? 0) + (c.cacheWrite ?? 0);
  console.log("\n── checks 2/3 verdicts ──");
  verdict("2 call 1 → 200", "required", ok(c1), `HTTP ${c1.status}${c1.error ? ` — ${c1.error}` : ""}`);
  verdict("2 call 1 live search tool_use", "warn", !!searchCall,
    searchCall ? `model called ${SEARCH} (query ${JSON.stringify(query)})` : "model did not search: call 2 replays a CONSTRUCTED tool_use");
  verdict("2 call 2 refs-only → 200", "required", ok(c2), `HTTP ${c2.status}${c2.error ? ` — ${c2.error}` : ""}`);
  verdict("2 references serialized", "required", b2.toolReferences.length === MOA_HITS.length, `tool_reference in body: ${JSON.stringify(b2.toolReferences)}`);
  verdict("2 model calls a referenced deferred tool", "required", !!refCall,
    refCall ? `${refCall.toolName} ${JSON.stringify(refCall.input)}` : `tool calls: ${JSON.stringify(called.map((p) => p.toolName))}`);
  verdict("2 probe A (mixed) → 400 mixed-content", "expected-negative",
    pA.status === 400 && /cannot be mixed with other content/.test(pA.error ?? ""), `HTTP ${pA.status}; ${pA.error?.split(" | ")[1]?.slice(0, 200) ?? "no error"}`);
  verdict("2 probe B (refs + user text) → 200", "warn", ok(pB), `HTTP ${pB.status}; tool calls ${JSON.stringify(pB.toolCalls)}`);
  verdict("3 calls 1–3 → 200", "required", seq.every(ok), seq.map((c) => c.status).join(" / "));
  verdict("3 call 1 cold write", "required", c1.cacheRead === 0 && (c1.cacheWrite ?? 0) > 0, tok(c1));
  verdict("3 call 2 reads all of call 1's cached prompt", "required", (c2.cacheRead ?? 0) > 0 && (c2.cacheRead ?? 0) >= prompt(c1), `${tok(c2)}; call 1 cached ${prompt(c1)}`);
  verdict("3 call 3 reads all of call 2's cached prompt", "required", (c3.cacheRead ?? 0) > 0 && (c3.cacheRead ?? 0) >= prompt(c2), `${tok(c3)}; call 2 cached ${prompt(c2)}`);
  verdict("3 tools/system hashes stable", "required", same("toolsHash") && same("systemHash"),
    `tools ${seq.map((c) => c.toolsHash).join(",")}; system ${seq.map((c) => c.systemHash).join(",")}`);
}

async function check4() {
  const core = "chembl__search_compounds";
  if (!ALWAYS_LOADED_TOOLS.has(core)) throw new Error(`${core} is not core anymore; pick another`);
  const tools = buildCatalog("deferred", `${RUN_ID}-c4`);
  const q = ask("Find the ChEMBL ID for imatinib, then its mechanism of action. Keep it to one sentence.");
  const c4a = await runCall("4a tool_reference to a loaded (core) tool", "cold", {
    tools, cacheSystem: true, maxOutput: 512,
    messages: withCacheMarkers([...q, ...searchTurn("toolu_phase0_search_core", "find compound by name and mechanism of action", [
      { name: core, score: 0.93 },
      { name: "chembl__get_mechanism_of_action", score: 0.88 },
    ])]),
  });
  console.log("check4a body:", JSON.stringify(inspectBody(c4a.body)));

  const c4b = await runCall("4b parallel: refs tool_result + text tool_result", "warm", {
    tools, cacheSystem: true, maxOutput: 512,
    messages: withCacheMarkers([
      ...q,
      { role: "assistant", content: [
        { type: "tool-call", toolCallId: "toolu_phase0_par_search", toolName: SEARCH, input: { query: "mechanism of action of a drug" } },
        { type: "tool-call", toolCallId: "toolu_phase0_par_core", toolName: core, input: { query: "imatinib" } },
      ] },
      { role: "tool", content: [
        { type: "tool-result", toolCallId: "toolu_phase0_par_search", toolName: SEARCH, output: searchOutput(MOA_HITS) },
        { type: "tool-result", toolCallId: "toolu_phase0_par_core", toolName: core, output: { type: "text", value: '{"results":[{"molecule_chembl_id":"CHEMBL941","pref_name":"IMATINIB"}]}' } },
      ] },
    ]),
  });
  console.log("check4b body:", JSON.stringify(inspectBody(c4b.body)));
  console.log("\n── check 4 verdicts ──");
  verdict("4a reference to a loaded tool → 200", "required", ok(c4a), `HTTP ${c4a.status}${c4a.error ? ` — ${c4a.error}` : ""}; tool calls ${JSON.stringify(c4a.toolCalls)}`);
  verdict("4b parallel refs + text results → 200", "required", ok(c4b), `HTTP ${c4b.status}${c4b.error ? ` — ${c4b.error}` : ""}; tool calls ${JSON.stringify(c4b.toolCalls)}`);
}

const CHECKS: [string, () => Promise<void>][] = [
  ["5", check5], ["1", check1], ["2", check23], ["4", check4], ["4b", () => check4b(`${RUN_ID}-c4b`)],
];

async function main() {
  const which = process.argv[2] ?? "all";
  if (which === "--help" || which === "-h") {
    console.log("Usage: bun run gate:prompt-cache [all|1|2|3|4|5|4b|--offline]");
    console.log("Live checks require ANTHROPIC_API_KEY, an Anthropic chat model, and a built mcp-server.");
    console.log("--offline checks redacted-thinking serialization with stubbed fetches; use ANTHROPIC_API_KEY=offline.");
    console.log("See app/scripts/prompt-cache-gate/README.md for setup and verdict meanings.");
    return 0;
  }
  if (loadLLMConfig().provider !== "anthropic") throw new Error("This gate requires LLM_PROVIDER=anthropic");
  const target = which === "3" ? "2" : which;
  if (target !== "all" && target !== "--offline" && !CHECKS.some(([id]) => id === target)) throw new Error(`unknown check ${which}`);
  if (which === "--offline") {
    const result = await checkRedactedOffline();
    verdict("4b.2 offline redacted-thinking round-trip", "required", result.pass, result.detail);
    console.log(result.pass ? "OFFLINE CHECK PASSED (live gate not run)" : "OFFLINE CHECK FAILED");
    return result.pass ? 0 : 1;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set (run from app/ so .env loads)");
  const pkg = async (p: string) => (await import(`${p}/package.json`, { with: { type: "json" } })).default.version;
  console.log("model:", MODEL_ID, "| ai", await pkg("ai"), "| @ai-sdk/anthropic", await pkg("@ai-sdk/anthropic"), "| run", RUN_ID);

  runMigrations(sqlite);
  tools = initializeTools();
  await tools.ready;
  const all = toolRegistry.getAll();
  const core = all.filter((t) => ALWAYS_LOADED_TOOLS.has(`${t.server}__${t.name}`));
  console.log(`registry: ${all.length} tools, ${core.length} core (+${SEARCH}, ${INSPECT})`);
  if (all.length === 0) throw new Error("no tools registered — is mcp-server built (bun run build)?");

  for (const [id, fn] of CHECKS) {
    if (target !== "all" && target !== id) continue;
    try {
      await fn();
    } catch (e) {
      verdict(`${id} ran to completion`, "required", false, e instanceof Error ? e.message : String(e));
    }
  }

  console.log("\n── calls ──");
  console.table(results.map(({ label, cache, status, toolsSent, deferredSent, inputTokens, noCache, cacheRead, cacheWrite, outputTokens, toolsHash, systemHash, error }) =>
    ({ label, cache, status, toolsSent, deferredSent, inputTokens, noCache, cacheRead, cacheWrite, outputTokens, toolsHash, systemHash, error: error?.slice(0, 60) })));
  console.log("\n── verdicts ──");
  console.table(verdicts.map(({ check, kind, pass, detail }) =>
    ({ result: pass ? "PASS" : kind === "warn" ? "WARN" : "FAIL", kind, check, detail: detail.slice(0, 110) })));
  const failed = verdicts.filter((v) => !v.pass && v.kind !== "warn");
  const warned = verdicts.filter((v) => !v.pass && v.kind === "warn");
  console.log(failed.length ? `GATE FAILED: ${failed.length} blocking verdict(s) failed` : `GATE PASSED (${verdicts.length} verdicts, ${warned.length} warning(s))`);
  return failed.length ? 1 : 0;
}

let tools: ToolsBoot | null = null;
let code = 0;
try {
  code = await main();
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  tools?.embeddingSync?.stop();
  await mcpManager.stopAll();
  process.exit(code);
}

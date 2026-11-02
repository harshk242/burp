import { Database } from "bun:sqlite";
import { streamText, type ModelMessage, type TextStreamPart, type Tool, type ToolSet } from "ai";
import { chatProviderOptions, getChatModel, loadLLMConfig, sanitizeToolName } from "../../server/llm";
import { buildSystemPrompt } from "../../server/orchestration/context/system-prompt";
import { applyCacheMarkers, cachedInstructions } from "../../server/orchestration/context/cache-markers";
import { buildToolCatalog, SEARCH_TOOL_NAME } from "../../server/orchestration/context/tool-catalog";
import { toDeclarations } from "../../server/orchestration/tool-dispatch";
import { parseGateEffort, preflightThinking } from "./gate-config";
import { MOA_HITS, sha, verdict } from "./gate-lib";
import { checkRedactedOffline, REDACTED_TRIGGER } from "./phase4b-redacted";

const config = loadLLMConfig();
const EFFORT = parseGateEffort(process.env.GATE_EFFORT);
let preflight: Promise<void> | undefined;
export function ensureThinkingCapabilities(): Promise<void> {
  return preflight ??= preflightThinking(config, EFFORT, {
    apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: process.env.ANTHROPIC_BASE_URL,
  });
}

const providerOptions = chatProviderOptions({ ...config, effort: EFFORT });

interface Req { raw: string; body: any; status: number; errorText?: string; signal?: AbortSignal | null }
const requests: Req[] = [];
const loggingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const req: Req = { raw: String(init?.body), body: JSON.parse(String(init?.body)), status: -1, signal: init?.signal };
  requests.push(req);
  const res = await fetch(url, init);
  req.status = res.status;
  if (!res.ok) req.errorText = await res.clone().text();
  return res;
}) as typeof fetch;
const model = getChatModel({ fetch: loggingFetch });

interface Call {
  label: string; status: number; error?: string; req?: Req; aborted?: boolean;
  inputTokens?: number; noCache?: number; cacheRead?: number; cacheWrite?: number;
  outputTokens?: number; reasoningTokens?: number; finishReason?: string;
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
  responseMessages: ModelMessage[];
}
const calls: Call[] = [];

type Part = TextStreamPart<ToolSet>;
interface CallOpts { signal?: AbortSignal; onPart?: (p: Part) => void }

async function call(label: string, tools: Record<string, Tool>, messages: ModelMessage[], prevLast?: number, opts: CallOpts = {}): Promise<Call> {
  const before = requests.length;
  let streamError: unknown;
  const result = streamText({
    model,
    instructions: cachedInstructions(buildSystemPrompt()),
    messages: applyCacheMarkers(messages, prevLast),
    tools,
    maxRetries: 0,
    maxOutputTokens: config.maxOutputTokens,
    providerOptions,
    abortSignal: opts.signal,
    onError: ({ error }) => { streamError ??= error; },
  });
  try {
    for await (const part of result.stream) {
      if (part.type === "error") streamError ??= part.error;
      opts.onPart?.(part);
    }
  } catch (e) {
    streamError ??= e;
  }
  const req = requests[before];
  let c: Call;
  if (opts.signal?.aborted) {
    c = { label, status: req?.status ?? -1, req, aborted: true, toolCalls: [], responseMessages: [] };
  } else if (streamError !== undefined) {
    const msg = streamError instanceof Error ? streamError.message : String(streamError);
    c = { label, status: req?.status ?? -1, req, error: `${msg}${req?.errorText ? ` | ${req.errorText.slice(0, 400)}` : ""}`, toolCalls: [], responseMessages: [] };
  } else {
    const step = await result.finalStep;
    const u = step.usage;
    c = {
      label, status: req?.status ?? -1, req,
      inputTokens: u.inputTokens, noCache: u.inputTokenDetails?.noCacheTokens,
      cacheRead: u.inputTokenDetails?.cacheReadTokens, cacheWrite: u.inputTokenDetails?.cacheWriteTokens,
      outputTokens: u.outputTokens, reasoningTokens: u.outputTokenDetails?.reasoningTokens,
      finishReason: step.finishReason,
      toolCalls: step.toolCalls.map((t) => ({ toolCallId: t.toolCallId, toolName: t.toolName, input: t.input })),
      responseMessages: step.response.messages,
    };
  }
  calls.push(c);
  console.log(`[${label}] ${c.status} ${c.error ?? c.finishReason ?? (c.aborted ? "aborted" : "")} ${tok(c)} tools ${JSON.stringify(c.toolCalls.map((t) => t.toolName))}`);
  return c;
}

const ok = (c?: Call) => !!c && c.status === 200 && !c.error && !c.aborted;
const tok = (c: Call) => `in ${c.inputTokens} = noCache ${c.noCache} + read ${c.cacheRead} + write ${c.cacheWrite}; out ${c.outputTokens} (thinking ${c.reasoningTokens})`;
const cachedPrompt = (c: Call) => (c.cacheRead ?? 0) + (c.cacheWrite ?? 0);
const status = (c?: Call) => `HTTP ${c?.status}${c?.error ? ` — ${c.error.slice(0, 300)}` : ""}`;
const THINKING_ERROR = /thinking|signature/i;

const HITS = [...MOA_HITS.map((h) => h.name), "chembl__get_target_info"];
const STUBS: Record<string, unknown> = {
  chembl__get_mechanism_of_action: { molecule_chembl_id: "CHEMBL941", mechanism_of_action: "BCR/ABL, KIT and PDGFR tyrosine kinase inhibitor", action_type: "INHIBITOR", target_chembl_id: "CHEMBL1862" },
  chembl__get_target_info: { target_chembl_id: "CHEMBL1862", pref_name: "Tyrosine-protein kinase ABL1", target_type: "SINGLE PROTEIN", organism: "Homo sapiens", accession: "P00519" },
};
function stubOutput(toolName: string) {
  if (toolName === SEARCH_TOOL_NAME) {
    return { type: "content" as const, value: HITS.map((name) => ({ type: "custom" as const, providerOptions: { anthropic: { type: "tool-reference", toolName: name } } })) };
  }
  return { type: "text" as const, value: JSON.stringify({ ...(STUBS[toolName] as object ?? { note: "no data" }), fetched_at: "2026-10-10T12:00:00Z" }) };
}

interface Turn { appended: ModelMessage[]; calls: Call[]; aborted: boolean; requestsMade: number }

async function runTurn(label: string, tools: Record<string, Tool>, history: ModelMessage[], userText: string, prevLast?: number, opts: CallOpts & { maxIterations?: number } = {}): Promise<Turn> {
  const messages: ModelMessage[] = [...history, { role: "user", content: userText }];
  const turn: Turn = { appended: [messages.at(-1)!], calls: [], aborted: false, requestsMade: 0 };
  const before = requests.length;
  for (let i = 1; i <= (opts.maxIterations ?? 6); i++) {
    if (opts.signal?.aborted) { turn.aborted = true; break; }
    const callLast = messages.length - 1;
    const c = await call(`${label} call${i}`, tools, messages, prevLast, opts);
    turn.calls.push(c);
    if (c.aborted || opts.signal?.aborted) { turn.aborted = true; break; }
    if (!ok(c)) break;
    prevLast = callLast;
    const response = c.responseMessages.filter((m) => m.role !== "tool");
    messages.push(...response);
    turn.appended.push(...response);
    if (c.finishReason !== "tool-calls" || c.toolCalls.length === 0) break;
    const toolMsg: ModelMessage = {
      role: "tool",
      content: c.toolCalls.map((t) => ({ type: "tool-result" as const, toolCallId: t.toolCallId, toolName: t.toolName, output: stubOutput(t.toolName) })),
    };
    messages.push(toolMsg);
    turn.appended.push(toolMsg);
  }
  turn.requestsMade = requests.length - before;
  return turn;
}

const db = new Database(":memory:");
db.run("CREATE TABLE model_transcript (session_id TEXT, seq INTEGER, content_json TEXT, UNIQUE (session_id, seq))");
function storeAndLoad(sessionId: string, msgs: ModelMessage[]): ModelMessage[] {
  const insert = db.prepare("INSERT INTO model_transcript VALUES (?, ?, ?)");
  msgs.forEach((m, seq) => insert.run(sessionId, seq, JSON.stringify(m)));
  return db.query("SELECT content_json FROM model_transcript WHERE session_id = ? ORDER BY seq").all(sessionId)
    .map((r: any) => JSON.parse(r.content_json));
}

const assistantParts = (msgs: ModelMessage[]) =>
  msgs.flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : [])) as any[];
const thinkingParts = (msgs: ModelMessage[]) => assistantParts(msgs).filter((p) => p.type === "reasoning");
const signed = (msgs: ModelMessage[]) => thinkingParts(msgs).filter((p) => p.providerOptions?.anthropic?.signature);
const redacted = (msgs: ModelMessage[]) => thinkingParts(msgs).filter((p) => p.providerOptions?.anthropic?.redactedData);
const bodyBlocks = (body: any, type: string) =>
  (body?.messages ?? []).flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === type);

function degrade(turn: ModelMessage[]): ModelMessage[] {
  const user = turn[0]!;
  const finalText = assistantParts([turn.at(-1)!]).filter((p) => p.type === "text").map((p) => p.text).join("");
  return [{ role: "user", content: typeof user.content === "string" ? user.content : "" }, { role: "assistant", content: finalText }];
}

const stripCacheControl = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v), (k, val) => (k === "cache_control" ? undefined : val));

const Q1 =
  "First, without tools: how many positive divisors of 7! are perfect squares? Work it out carefully; call it N. " +
  "Then, using ChEMBL, find the mechanism of action of imatinib (CHEMBL941). You don't have a suitable core tool, " +
  "so find one with system__search_available_tools first. Answer in one sentence: N and the mechanism.";
const Q2 =
  "First, without tools: five people sit in a row; Ana is not at either end and Ben sits immediately right of Cy. " +
  "How many seatings satisfy both? Work it out carefully; call it M. Then look up that target (its ChEMBL target ID " +
  "is in the result above) with ChEMBL. Answer in one sentence: M, its preferred name and UniProt accession.";
const Q3 = "Without calling any tools: in one sentence, what drug class does that make imatinib?";

export async function check4b(nonce: string) {
  await ensureThinkingCapabilities();
  const tools = toDeclarations(buildToolCatalog(config.provider, (n) => sanitizeToolName(n, config.provider), "phase4b-gate"));
  tools[SEARCH_TOOL_NAME] = { ...tools[SEARCH_TOOL_NAME]!, description: `${tools[SEARCH_TOOL_NAME]!.description} (gate run ${nonce})` } as Tool;
  for (const n of HITS) if (!tools[n]) throw new Error(`${n} is not in the catalog`);
  console.log(`4b: ${Object.keys(tools).length} tools, model ${config.chatModel}, effort ${EFFORT}, display ${config.thinkingDisplay}, nonce ${nonce}`);

  const t1 = await runTurn("T1", tools, [], Q1);
  const t1Last = t1.calls.at(-1)!;
  const stored1 = storeAndLoad("s1", t1.appended);
  const roundTripExact = JSON.stringify(stored1) === JSON.stringify(t1.appended);
  console.log(`T1: ${t1.appended.length} messages, ${thinkingParts(t1.appended).length} reasoning parts (${signed(t1.appended).length} signed), tool calls ${t1.calls.flatMap((c) => c.toolCalls.map((t) => t.toolName)).join(", ")}`);

  const t2 = await runTurn("T2", tools, stored1, Q2, stored1.length - 2);
  const t2First = t2.calls[0]!;
  const replayedThinking = bodyBlocks(t2First.req?.body, "thinking").length;
  const stored2 = storeAndLoad("s2", t2.appended);

  console.log("\n── 4b.6 check 1 (round-trip) ──");
  verdict("4b.1 T1 all calls 200", "required", t1.calls.every(ok), t1.calls.map(status).join(" / "));
  verdict("4b.1 T1 has tool calls", "required", t1.calls.some((c) => c.toolCalls.length > 0), `${t1.calls.length} calls`);
  verdict("4b.1 T1 has signed thinking parts", "required", signed(t1.appended).length > 0, `${signed(t1.appended).length} signed / ${thinkingParts(t1.appended).length} reasoning parts`);
  verdict("4b.1 JSON → SQLite → parse is exact", "required", roundTripExact && stored1.length === t1.appended.length, `${stored1.length} rows, sha ${sha(t1.appended)} vs ${sha(stored1)}`);
  verdict("4b.1 T2 replay sends T1's thinking", "required", replayedThinking >= signed(t1.appended).length && replayedThinking > 0, `${replayedThinking} thinking blocks in T2 call 1 body`);
  verdict("4b.1 T2 all calls 200, no thinking error", "required", t2.calls.every(ok), t2.calls.map(status).join(" / "));
  verdict("4b.1 T2 call 1 reads T1's last prompt", "required", (t2First.cacheRead ?? 0) >= cachedPrompt(t1Last),
    `T2 call1 ${tok(t2First)}; T1 last call cached ${cachedPrompt(t1Last)} (inputTokens ${t1Last.inputTokens})`);

  const a = t1Last.req?.body, b = t2First.req?.body;
  const k = a?.messages?.length ?? 0;
  const prefixA = a?.messages?.slice(0, k), prefixB = b?.messages?.slice(0, k);
  const strictDiff = (prefixA ?? []).map((m: any, i: number) => (sha(m) === sha(prefixB?.[i]) ? null : i)).filter((i: number | null) => i !== null);
  console.log("\n── 4b.6 check 4 (request prefix hash) ──");
  console.log(`T1 last request: ${k} messages; T2 first: ${b?.messages?.length}. tools ${sha(a?.tools)}/${sha(b?.tools)}, system ${sha(a?.system)}/${sha(b?.system)}`);
  verdict("4b.4 tools + system bytes identical", "required", sha(a?.tools) === sha(b?.tools) && sha(a?.system) === sha(b?.system), `tools ${sha(a?.tools)}, system ${sha(a?.system)}`);
  verdict("4b.4 message prefix identical (cache_control stripped)", "required", !!prefixA && sha(stripCacheControl(prefixA)) === sha(stripCacheControl(prefixB)),
    `prefix of ${k} messages: ${sha(stripCacheControl(prefixA))} vs ${sha(stripCacheControl(prefixB))}`);
  verdict("4b.4 message prefix identical incl. cache_control", "warn", strictDiff.length === 0,
    strictDiff.length ? `differs only at messages ${JSON.stringify(strictDiff)} (moved breakpoints)` : "identical");

  const lastTool = stored1.findLastIndex((m) => m.role === "tool");
  const c3 = await call("3 tool_result + new user", tools, [...stored1.slice(0, lastTool + 1), { role: "user", content: Q3 }], lastTool);
  const lastUser = c3.req?.body?.messages?.at(-1);
  const merged = lastUser?.role === "user" && lastUser.content.some((x: any) => x.type === "tool_result") && lastUser.content.some((x: any) => x.type === "text");
  console.log("\n── 4b.6 check 3 ──");
  verdict("4b.3 tool_result + user text accepted", "required", ok(c3), status(c3));
  verdict("4b.3 sent as one user message", "warn", !!merged, JSON.stringify(lastUser?.content?.map((x: any) => x.type)));

  const c6a = await call("6a T1 degraded", tools, [...degrade(stored1), { role: "user", content: Q3 }]);
  const c6b = await call("6b T1 degraded + T2 lossless", tools, [...degrade(stored1), ...stored2, { role: "user", content: Q3 }]);
  const c6c = await call("6c T1 lossless + T2 degraded", tools, [...stored1, ...degrade(stored2), { role: "user", content: Q3 }]);
  console.log("\n── 4b.6 check 6 (degraded replay) ──");
  verdict("4b.6a degraded T1 (after thinking) → 200", "required", ok(c6a), status(c6a));
  verdict("4b.6b degraded T1 + lossless T2 with thinking → 200", "required", ok(c6b) && signed(stored2).length > 0,
    `${status(c6b)}; T2 signed thinking parts ${signed(stored2).length}`);
  verdict("4b.6c lossless T1 + degraded T2 → 200", "required", ok(c6c), status(c6c));
  for (const c of [c6a, c6b, c6c]) if (c.error && THINKING_ERROR.test(c.error)) console.log(`  !! ${c.label}: preserved-thinking error → 4b.4 needs a redesign`);

  const editThinking = (msgs: ModelMessage[], edit: (p: any) => any) =>
    msgs.map((m) => (m.role === "assistant" && Array.isArray(m.content)
      ? ({ ...m, content: (m.content as any[]).map((p) => (p.type === "reasoning" ? edit(p) : p)).filter(Boolean) } as ModelMessage)
      : m));
  const c6d = await call("6d control: T1 thinking text edited", tools, [...editThinking(stored1, (p) => ({ ...p, text: `${p.text} (edited)` })), { role: "user", content: Q3 }]);
  const c6e = await call("6e control: T1 thinking removed", tools, [...editThinking(stored1, () => null), { role: "user", content: Q3 }]);
  const c6f = await call("6f control: T1 thinking signature edited", tools, [...editThinking(stored1, (p) => {
    const sig: string = p.providerOptions.anthropic.signature;
    return { ...p, providerOptions: { anthropic: { ...p.providerOptions.anthropic, signature: `${sig.slice(0, 40)}${sig[40] === "A" ? "B" : "A"}${sig.slice(41)}` } } };
  }), { role: "user", content: Q3 }]);
  verdict("4b.6d control: edited thinking text → 400", "warn", c6d.status === 400, status(c6d));
  verdict("4b.6f control: edited signature → 400", "warn", c6f.status === 400, status(c6f));
  verdict("4b.6e control: thinking removed (info)", "warn", true, status(c6e));

  console.log("\n── 4b.6 check 2 (redacted thinking) ──");
  const r1 = await runTurn("R1", tools, [], `${REDACTED_TRIGGER} Reply with one word.`, undefined, { maxIterations: 1 });
  const rStored = storeAndLoad("r", r1.appended);
  const liveRedacted = redacted(r1.appended).length;
  verdict("4b.2 trigger call 200", "warn", r1.calls.every(ok), r1.calls.map(status).join(" / "));
  verdict("4b.2 live redacted_thinking triggered", "warn", liveRedacted > 0, `${liveRedacted} redacted parts, ${thinkingParts(r1.appended).length} reasoning parts`);
  if (liveRedacted > 0) {
    const r2 = await call("R2 replay redacted", tools, [...rStored, { role: "user", content: "Reply with one more word." }], rStored.length - 1);
    const sent = bodyBlocks(r2.req?.body, "redacted_thinking");
    const same = sent.map((x: any) => x.data).join() === redacted(r1.appended).map((p) => p.providerOptions.anthropic.redactedData).join();
    verdict("4b.2 redacted thinking replayed live → 200, data intact", "required", ok(r2) && same, `${status(r2)}; ${sent.length} redacted_thinking blocks sent, data identical ${same}`);
  }
  const off = await checkRedactedOffline();
  verdict("4b.2 offline: provider parses + replays redacted_thinking through JSON", "required", off.pass, off.detail);

  console.log("\n── 4b.6 check 5 (abort) ──");
  const ac = new AbortController();
  let partsAfterAbort = 0, abortedAt = 0;
  const started = Date.now();
  const tA = await runTurn("A1", tools, [], Q1, undefined, {
    signal: ac.signal,
    onPart: (p) => {
      if (ac.signal.aborted) { partsAfterAbort++; return; }
      if (p.type === "reasoning-delta" || p.type === "text-delta" || p.type === "tool-input-start") { abortedAt = Date.now(); ac.abort(); }
    },
  });
  const loopExit = Date.now();
  const countAfter = requests.length;
  await Bun.sleep(2000);
  const abortReq = tA.calls[0]?.req;
  verdict("4b.5 abort stops the turn", "required", tA.aborted && tA.calls.length === 1, `aborted ${tA.aborted}, calls ${tA.calls.length}, requests ${tA.requestsMade}`);
  verdict("4b.5 request signal aborted, response 200 before abort", "required", abortReq?.status === 200 && !!abortReq?.signal?.aborted,
    `status ${abortReq?.status}, signal.aborted ${abortReq?.signal?.aborted}, first part after ${abortedAt - started} ms`);
  verdict("4b.5 no further request after abort", "required", requests.length === countAfter && tA.requestsMade === 1, `${requests.length - countAfter} requests in the 2 s after exit`);
  verdict("4b.5 loop exits promptly", "warn", loopExit - abortedAt < 1000, `${loopExit - abortedAt} ms abort → loop exit; ${partsAfterAbort} parts seen after abort`);

  console.log("\n── 4b calls ──");
  console.table(calls.map((c) => ({
    label: c.label, status: c.status, finish: c.finishReason ?? (c.aborted ? "aborted" : "error"), in: c.inputTokens, noCache: c.noCache,
    read: c.cacheRead, write: c.cacheWrite, out: c.outputTokens, thinking: c.reasoningTokens, tools: c.toolCalls.map((t) => t.toolName).join(","),
    thinkingParts: signed(c.responseMessages).length, err: c.error?.slice(0, 60),
  })));
}

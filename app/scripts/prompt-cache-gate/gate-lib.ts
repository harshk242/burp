import { createHash } from "node:crypto";
import { modelMessageSchema, type AssistantModelMessage, type ModelMessage } from "ai";
import { asRecord, isRecord } from "../../shared/json";

export type Kind = "required" | "expected-negative" | "warn";
export interface Verdict { check: string; kind: Kind; pass: boolean; detail: string }
export const verdicts: Verdict[] = [];

export function verdict(check: string, kind: Kind, pass: boolean, detail: string) {
  verdicts.push({ check, kind, pass, detail });
  console.log(`  ${pass ? "PASS" : kind === "warn" ? "WARN" : "FAIL"} [${kind}] ${check}: ${detail}`);
}

export const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 12);

export const MOA_HITS = [
  { name: "chembl__get_mechanism_of_action", score: 0.91 },
  { name: "open-targets__get_drug_info", score: 0.84 },
  { name: "chembl__get_drug_info", score: 0.8 },
];

// Loose views of what the gates inspect: captured Anthropic Messages API request bodies. Only the
// fields the checks read are named; the rest of each block is kept as sent.
export interface WireBlock {
  type: string;
  cache_control?: unknown;
  content?: unknown;
  data?: string | undefined;
  tool_name?: string | undefined;
  [key: string]: unknown;
}
export interface WireMessage { role: string; content: string | WireBlock[] }
export interface WireTool { defer_loading?: boolean | undefined; [key: string]: unknown }
export interface WireBody { system?: string | WireBlock[] | undefined; messages?: WireMessage[] | undefined; tools?: WireTool[] | undefined }

const optString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** The content blocks of a wire `content` array; non-block elements are dropped. */
export const wireBlocks = (value: unknown): WireBlock[] =>
  (Array.isArray(value) ? value : []).flatMap((block: unknown) =>
    isRecord(block) && typeof block.type === "string"
      ? [{ ...block, type: block.type, data: optString(block.data), tool_name: optString(block.tool_name) }]
      : []);

export function parseWireBody(raw: string): WireBody {
  const body = asRecord(JSON.parse(raw));
  const messages = Array.isArray(body.messages)
    ? body.messages.flatMap((m: unknown) =>
      isRecord(m) && typeof m.role === "string"
        ? [{ role: m.role, content: typeof m.content === "string" ? m.content : wireBlocks(m.content) }]
        : [])
    : undefined;
  const tools = Array.isArray(body.tools)
    ? body.tools.filter(isRecord).map((t) => ({ ...t, defer_loading: typeof t.defer_loading === "boolean" ? t.defer_loading : undefined }))
    : undefined;
  return {
    system: typeof body.system === "string" ? body.system : Array.isArray(body.system) ? wireBlocks(body.system) : undefined,
    messages,
    tools,
  };
}

/** The request body a provider passed to `fetch` (always a JSON string for the Messages API). */
export const requestBody = (init: RequestInit | undefined): string => (typeof init?.body === "string" ? init.body : "");

/** A `fetch` stand-in; Bun's `typeof fetch` also carries `preconnect`. */
export const gateFetch = (fn: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>): typeof fetch =>
  Object.assign(fn, { preconnect: (...args: Parameters<typeof fetch.preconnect>) => globalThis.fetch.preconnect(...args) });

/** Content blocks of one type across every message of a request body. */
export const bodyBlocks = (body: WireBody | undefined, type: string): WireBlock[] =>
  (body?.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === type);

export type GatePart = Exclude<AssistantModelMessage["content"], string>[number];
export type ReasoningPart = Extract<GatePart, { type: "reasoning" }>;
export type TextPart = Extract<GatePart, { type: "text" }>;

/** Content parts of every assistant message. */
export const assistantParts = (msgs: ModelMessage[]): GatePart[] =>
  msgs.flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : []));

export const isReasoning = (p: GatePart): p is ReasoningPart => p.type === "reasoning";
export const isText = (p: GatePart): p is TextPart => p.type === "text";

/**
 * Model messages read back from JSON. Each is checked against the SDK's schema and kept as parsed
 * (the schema's output would drop keys it does not list, and the gates check what survives a round trip).
 */
export function parseModelMessages(json: string): ModelMessage[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) throw new Error("expected an array of model messages");
  return value.map(parseModelMessageValue);
}

export function parseModelMessageValue(value: unknown): ModelMessage {
  if (!isModelMessage(value)) throw new Error(`not a model message: ${JSON.stringify(value).slice(0, 200)}`);
  return value;
}

function isModelMessage(value: unknown): value is ModelMessage {
  return modelMessageSchema.safeParse(value).success;
}

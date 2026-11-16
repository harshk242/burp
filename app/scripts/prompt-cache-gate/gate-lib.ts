import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";

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

// Loose views of what the gates inspect: captured Anthropic Messages API request bodies and
// AI SDK assistant parts. Only the fields the checks read are named.
export interface WireBlock {
  type: string;
  cache_control?: unknown;
  content?: unknown;
  data?: string;
  tool_name?: string;
  [key: string]: unknown;
}
export interface WireMessage { role: string; content: string | WireBlock[] }
export interface WireTool { defer_loading?: boolean; [key: string]: unknown }
export interface WireBody { system?: string | WireBlock[]; messages?: WireMessage[]; tools?: WireTool[] }

export const parseWireBody = (raw: string): WireBody => JSON.parse(raw) as WireBody;

/** Content blocks of one type across every message of a request body. */
export const bodyBlocks = (body: WireBody | undefined, type: string): WireBlock[] =>
  (body?.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === type);

export interface GatePart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: { query?: string; [key: string]: unknown };
  providerOptions?: { anthropic?: { signature?: string; redactedData?: string; [key: string]: unknown } };
}

/** Content parts of every assistant message, typed loosely for inspection. */
export const assistantParts = (msgs: ModelMessage[]): GatePart[] =>
  msgs.flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? (m.content as unknown as GatePart[]) : []));

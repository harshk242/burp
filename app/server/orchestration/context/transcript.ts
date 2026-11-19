import { modelMessageSchema, type ModelMessage } from "ai";
import { chatTurnQueries, messageQueries, modelTranscriptQueries, type DbTranscriptRow, type NewTranscriptRow } from "../../db";
import { shortHash } from "../usage-meter";
import { stringArray } from "../../../shared/json";

export interface TranscriptTag {
  provider: string;
  model: string;
  contextVersion: string;
}

export function contextVersion(systemPrompt: string, providerOptions: unknown): string {
  return shortHash(JSON.stringify({ systemPrompt, providerOptions: providerOptions ?? null }));
}

type ProviderOptions = NonNullable<ModelMessage["providerOptions"]>;
const CACHE_KEYS = ["cacheControl", "cache_control"] as const;

function withoutCacheMarkers(options: ProviderOptions | undefined): ProviderOptions | undefined {
  const anthropic = options?.anthropic;
  if (!options || !anthropic || !CACHE_KEYS.some((key) => key in anthropic)) return options;
  const rest = Object.fromEntries(Object.entries(anthropic).filter(([key]) => !(CACHE_KEYS as readonly string[]).includes(key)));
  const { anthropic: _marked, ...others } = options;
  const result: ProviderOptions = Object.keys(rest).length > 0 ? { ...options, anthropic: rest } : others;
  return Object.keys(result).length > 0 ? result : undefined;
}

/** A shallow copy of `item` whose `providerOptions` is `options` (removed when `undefined`). */
function withOptions<T extends { providerOptions?: ProviderOptions }>(item: T, options: ProviderOptions | undefined): T {
  const copy = { ...item };
  if (options === undefined) delete copy.providerOptions;
  else copy.providerOptions = options;
  return copy;
}

function stripPart<P extends { providerOptions?: ProviderOptions }>(part: P): P {
  const stripped = withoutCacheMarkers(part.providerOptions);
  return stripped === part.providerOptions ? part : withOptions(part, stripped);
}

/** `parts.map(fn)`, or the same array when `fn` returned every part unchanged. */
function mapParts<P>(parts: P[], fn: (part: P) => P): P[] {
  const result = parts.map(fn);
  return result.some((part, i) => part !== parts[i]) ? result : parts;
}

function stripContentMarkers(message: ModelMessage): ModelMessage {
  switch (message.role) {
    case "system":
      return message;
    case "user": {
      if (typeof message.content === "string") return message;
      const content = mapParts(message.content, stripPart);
      return content === message.content ? message : { ...message, content };
    }
    case "assistant": {
      if (typeof message.content === "string") return message;
      const content = mapParts(message.content, (part) => (part.type === "tool-approval-request" ? part : stripPart(part)));
      return content === message.content ? message : { ...message, content };
    }
    case "tool": {
      const content = mapParts(message.content, (part) => (part.type === "tool-approval-response" ? part : stripPart(part)));
      return content === message.content ? message : { ...message, content };
    }
  }
}

export function stripCacheMarkers(message: ModelMessage): ModelMessage {
  const options = withoutCacheMarkers(message.providerOptions);
  const result = options === message.providerOptions ? message : withOptions(message, options);
  return stripContentMarkers(result);
}

export function transcriptToolNames(message: ModelMessage): string[] {
  const names = new Set<string>();
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "tool-call") names.add(part.toolName);
      if (part.type === "tool-result" && part.output.type === "content") {
        for (const item of part.output.value) {
          const ref = item.providerOptions?.anthropic;
          if (ref?.type === "tool-reference" && typeof ref.toolName === "string") names.add(ref.toolName);
        }
      }
    }
  }
  return [...names].sort();
}

export function toTranscriptRow(turnId: string, message: ModelMessage, tag: TranscriptTag): NewTranscriptRow {
  const stored = stripCacheMarkers(message);
  return {
    turnId,
    role: stored.role,
    contentJson: JSON.stringify(stored),
    provider: tag.provider,
    model: tag.model,
    contextVersion: tag.contextVersion,
    toolNamesJson: JSON.stringify(transcriptToolNames(stored)),
  };
}

export function appendTranscript(
  sessionId: string,
  turnId: string,
  messages: readonly ModelMessage[],
  tag: TranscriptTag,
): void {
  modelTranscriptQueries.append(
    sessionId,
    messages.map((message) => toTranscriptRow(turnId, message, tag)),
  );
}

export interface TranscriptContext {
  messages: ModelMessage[];
  previousLastIndex?: number | undefined;
  previousPromptTokens?: number | undefined;
  previousInputIdentity?: string | undefined;
  previousFinishedAt?: number | undefined;
}

export interface TranscriptCompatibility extends TranscriptTag {
  toolNames: ReadonlySet<string>;
  onDegraded?: (turnId: string, reason: TranscriptDegradedReason) => void;
}

export type TranscriptDegradedReason =
  | { reason: "provider" | "model" | "context_version" | "system_message" | "malformed_message" }
  | { reason: "missing_tools"; missing_tools: string[] };

function incompatibility(rows: DbTranscriptRow[], current: TranscriptCompatibility): TranscriptDegradedReason | undefined {
  if (rows.some((row) => row.provider !== current.provider)) return { reason: "provider" };
  if (rows.some((row) => row.model !== current.model)) return { reason: "model" };
  if (rows.some((row) => row.context_version !== current.contextVersion)) return { reason: "context_version" };
  const missing = new Set<string>();
  for (const row of rows) {
    for (const name of stringArray(JSON.parse(row.tool_names_json))) {
      if (!current.toolNames.has(name)) missing.add(name);
    }
  }
  if (missing.size) return { reason: "missing_tools", missing_tools: [...missing].sort() };
  return undefined;
}

/**
 * Checks a stored row against the SDK's message schema. The parsed JSON itself is kept rather than
 * the schema's output, which would drop keys the schema does not list.
 */
function isModelMessage(value: unknown): value is ModelMessage {
  return modelMessageSchema.safeParse(value).success;
}

export function loadTranscript(sessionId: string, current?: TranscriptCompatibility): TranscriptContext {
  const history = messageQueries.findByChatId(sessionId);
  const turns = chatTurnQueries.findBySessionId(sessionId);
  const rows = modelTranscriptQueries.findBySessionId(sessionId);
  const byUser = new Map(turns.map((turn) => [turn.user_message_id, turn]));
  const byAssistant = new Map(turns.flatMap((turn) => turn.assistant_message_id ? [[turn.assistant_message_id, turn] as const] : []));
  const byTurn = new Map<string, ModelMessage[]>();
  const rowsByTurn = new Map<string, DbTranscriptRow[]>();
  const okIds = new Set(turns.filter((turn) => turn.status === "ok").map((turn) => turn.id));
  const untrusted = new Set<string>();
  const malformed = new Set<string>();
  for (const row of rows) {
    if (!okIds.has(row.turn_id)) continue;
    const message: unknown = JSON.parse(row.content_json);
    if (!isModelMessage(message)) {
      malformed.add(row.turn_id);
      continue;
    }
    if (row.role === "system" || message.role === "system") untrusted.add(row.turn_id);
    const messages = byTurn.get(row.turn_id) ?? [];
    messages.push(message);
    byTurn.set(row.turn_id, messages);
    const turnRows = rowsByTurn.get(row.turn_id) ?? [];
    turnRows.push(row);
    rowsByTurn.set(row.turn_id, turnRows);
  }

  const degraded = new Set<string>();
  for (const turnId of untrusted) {
    degraded.add(turnId);
    current?.onDegraded?.(turnId, { reason: "system_message" });
  }
  for (const turnId of malformed) {
    if (degraded.has(turnId)) continue;
    degraded.add(turnId);
    current?.onDegraded?.(turnId, { reason: "malformed_message" });
  }
  if (current) {
    for (const [turnId, turnRows] of rowsByTurn) {
      if (degraded.has(turnId)) continue;
      const reason = incompatibility(turnRows, current);
      if (!reason) continue;
      degraded.add(turnId);
      current.onDegraded?.(turnId, reason);
    }
  }

  const context: TranscriptContext = { messages: [] };
  for (const msg of history) {
    const turn = byUser.get(msg.id) ?? byAssistant.get(msg.id);
    if (turn) {
      if (turn.status !== "ok") continue;
      const replay = degraded.has(turn.id) ? undefined : byTurn.get(turn.id);
      if (replay) {
        if (msg.id !== turn.user_message_id) continue;
        const offset = context.messages.length;
        context.messages.push(...replay);
        const count = turn.last_input_message_count;
        const valid = count !== null && count > offset && count <= context.messages.length && turn.last_input_identity !== null;
        context.previousLastIndex = valid ? count - 1 : undefined;
        context.previousInputIdentity = valid ? turn.last_input_identity! : undefined;
        context.previousPromptTokens = valid ? turn.last_prompt_tokens ?? undefined : undefined;
        context.previousFinishedAt = turn.finished_at ?? undefined;
        continue;
      }
      context.previousFinishedAt = turn.finished_at ?? undefined;
      context.previousLastIndex = undefined;
      context.previousPromptTokens = undefined;
    }
    if (msg.role === "user" || msg.role === "assistant") {
      context.messages.push({ role: msg.role, content: msg.content || "" });
      if (!turn) {
        context.previousLastIndex = undefined;
        context.previousPromptTokens = undefined;
      }
    }
  }
  return context;
}

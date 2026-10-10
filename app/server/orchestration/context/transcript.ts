/**
 * Model transcript write path (plan Phase 4b.1): every `ModelMessage` the chat
 * loop sends is appended to `model_transcript` once, in send order, tagged with
 * its turn and a compatibility tag. Replay parses successful turns as-is,
 * falling back to UI text only for turns without transcript rows.
 *
 * Rules:
 * - R1, append-only: rows are inserted once and never updated (the queries
 *   have no update method; a trigger rejects UPDATEs).
 * - R2, no cache markers: `applyCacheMarkers` marks a per-call copy, so the
 *   loop's messages carry none; `stripCacheMarkers` removes any that would get
 *   through anyway, leaving every other byte as it was.
 * - R3, what the model saw: the loop's own messages (tool output after
 *   handleLargeOutput, with its `fetched_at` line; reasoning parts with their
 *   signatures / redacted data, as the SDK returned them).
 */

import type { ModelMessage } from "ai";
import { chatTurnQueries, messageQueries, modelTranscriptQueries, type NewTranscriptRow } from "../../db";
import { shortHash } from "../usage-meter";

/** Compatibility tag stored on every row (4b.4): replay needs all three to match. */
export interface TranscriptTag {
  provider: string;
  model: string;
  contextVersion: string;
}

/**
 * Hash of what makes stored messages valid to replay besides provider/model:
 * the system prompt and the provider options (thinking config, effort).
 * Changing either costs each session one cache miss (degraded replay, 4b.4).
 */
export function contextVersion(systemPrompt: string, providerOptions: unknown): string {
  return shortHash(JSON.stringify({ systemPrompt, providerOptions: providerOptions ?? null }));
}

type ProviderOptions = Record<string, Record<string, unknown> | undefined>;
const CACHE_KEYS = ["cacheControl", "cache_control"] as const;

/**
 * `providerOptions` without Anthropic cache markers, or the same object when it
 * has none (so unmarked messages are stored untouched).
 */
function withoutCacheMarkers<T extends ProviderOptions | undefined>(options: T): T | undefined {
  const anthropic = options?.anthropic;
  if (!anthropic || !CACHE_KEYS.some((key) => key in anthropic)) return options;
  const rest = Object.fromEntries(Object.entries(anthropic).filter(([key]) => !(CACHE_KEYS as readonly string[]).includes(key)));
  const { anthropic: _marked, ...others } = options!;
  const result = Object.keys(rest).length > 0 ? { ...options!, anthropic: rest } : others;
  return (Object.keys(result).length > 0 ? result : undefined) as T | undefined;
}

/** Sets or drops `providerOptions` on an object (a message or a content part). */
function replaceOptions<T extends { providerOptions?: unknown }>(item: T, options: unknown): T {
  const { providerOptions: _old, ...rest } = item;
  return (options === undefined ? rest : { ...rest, providerOptions: options }) as T;
}

/** The message without cache markers (message- and part-level); unchanged if it has none. */
export function stripCacheMarkers(message: ModelMessage): ModelMessage {
  let result = message;
  const options = withoutCacheMarkers(message.providerOptions as ProviderOptions | undefined);
  if (options !== message.providerOptions) result = replaceOptions(result, options);

  if (Array.isArray(message.content)) {
    let changed = false;
    const content = message.content.map((part) => {
      const partOptions = (part as { providerOptions?: ProviderOptions }).providerOptions;
      const stripped = withoutCacheMarkers(partOptions);
      if (stripped === partOptions) return part;
      changed = true;
      return replaceOptions(part as { providerOptions?: unknown }, stripped) as typeof part;
    });
    if (changed) result = { ...result, content } as ModelMessage;
  }
  return result;
}

/**
 * Sorted, distinct names of the tools a message references: `tool-call` parts
 * (assistant) and `tool-reference` parts (tool-search results on Anthropic).
 * Names are as sent to the model (sanitized), matching the catalog keys.
 */
export function transcriptToolNames(message: ModelMessage): string[] {
  const names = new Set<string>();
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "tool-call") names.add(part.toolName);
      if (part.type === "tool-result" && part.output.type === "content") {
        for (const item of part.output.value) {
          const ref = (item as { providerOptions?: ProviderOptions }).providerOptions?.anthropic;
          if (ref?.type === "tool-reference" && typeof ref.toolName === "string") names.add(ref.toolName);
        }
      }
    }
  }
  return [...names].sort();
}

/** The row stored for one message (seq is assigned on insert). */
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

/**
 * Appends messages to the session's transcript, after its last row, in one
 * transaction. Throws on a DB error: a turn whose transcript can't be written
 * fails rather than leave a gap that replay would later read past.
 */
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
  /** Endpoint of the preceding successful turn's final input, before its answer. */
  previousLastIndex?: number;
  previousFinishedAt?: number;
}

/**
 * Successful transcript rows are parsed without modifying content or metadata.
 * UI user rows anchor mixed history: untracked legacy messages use text, an ok
 * tracked turn with no rows uses its UI text, and every non-ok turn is omitted.
 * The stable UI row order and transcript seq order make the merge deterministic.
 * Compatibility degradation is deliberately a separate future extension.
 */
export function loadTranscript(sessionId: string): TranscriptContext {
  const history = messageQueries.findByChatId(sessionId);
  const turns = chatTurnQueries.findBySessionId(sessionId);
  const rows = modelTranscriptQueries.findBySessionId(sessionId);
  const byUser = new Map(turns.map((turn) => [turn.user_message_id, turn]));
  const byAssistant = new Map(turns.flatMap((turn) => turn.assistant_message_id ? [[turn.assistant_message_id, turn] as const] : []));
  const byTurn = new Map<string, ModelMessage[]>();
  const okIds = new Set(turns.filter((turn) => turn.status === "ok").map((turn) => turn.id));
  for (const row of rows) {
    if (!okIds.has(row.turn_id)) continue;
    const message = JSON.parse(row.content_json) as ModelMessage;
    // Server-written tool-change system messages are not implemented yet.
    if (message.role === "system") throw new Error("Unsupported system message in model transcript");
    const messages = byTurn.get(row.turn_id) ?? [];
    messages.push(message);
    byTurn.set(row.turn_id, messages);
  }

  const context: TranscriptContext = { messages: [] };
  for (const msg of history) {
    const turn = byUser.get(msg.id) ?? byAssistant.get(msg.id);
    if (turn) {
      if (turn.status !== "ok") continue;
      const replay = byTurn.get(turn.id);
      if (replay) {
        if (msg.id !== turn.user_message_id) continue;
        const offset = context.messages.length;
        context.messages.push(...replay);
        // All trailing assistant messages belong to the final response, which
        // was not part of that call's input. The preceding message was cached.
        let endpoint = replay.length - 1;
        while (endpoint >= 0 && replay[endpoint]!.role === "assistant") endpoint--;
        context.previousLastIndex = endpoint >= 0 ? offset + endpoint : undefined;
        context.previousFinishedAt = turn.finished_at ?? undefined;
        continue;
      }
      context.previousFinishedAt = turn.finished_at ?? undefined;
      context.previousLastIndex = undefined;
    }
    if (msg.role === "user" || msg.role === "assistant") {
      context.messages.push({ role: msg.role, content: msg.content || "" });
      if (!turn) context.previousLastIndex = undefined;
    }
  }
  return context;
}

/**
 * Turn lifecycle: the chat_turns row (created `running` when a turn starts,
 * finalized when it ends), the per-session lock that keeps two turns of one
 * session from running at once, and how a failed turn is classified (error
 * code for the record, message for the user).
 */

import { AISDKError, type ProviderMetadata } from "ai";
import { v4 as uuidv4 } from "uuid";
import { db, chatTurnQueries, messageQueries, type ChatTurnOutcome } from "../db";
import { logger, type LogContext } from "../logger";

/** How a turn ended without succeeding (chat_turns.error_code, usage logs). */
export type TurnErrorCode =
  | "provider_error" // the LLM call failed (API error, retries exhausted, error finish)
  | "max_tool_iterations"
  | "refusal" // the model's safety classifier declined (stop_reason "refusal")
  | "no_tools_available"
  | "internal_error"
  | "aborted" // the client disconnected
  | "closed"; // the consumer stopped iterating before the turn finished

/** A failure with a known cause; `userMessage` is what the client is shown. */
export class TurnError extends Error {
  constructor(
    readonly code: TurnErrorCode,
    message: string,
    readonly userMessage: string = message,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "TurnError";
  }
}

export interface TurnFailure {
  code: TurnErrorCode;
  /** Stored in chat_turns.error_message and logged. */
  message: string;
  /** Sent to the client. */
  userMessage: string;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Error code and messages for an error that ended a (not aborted) turn. */
export function classifyTurnError(error: unknown): TurnFailure {
  if (error instanceof TurnError) {
    return { code: error.code, message: error.message, userMessage: error.userMessage };
  }
  const message = messageOf(error);
  // Errors the AI SDK raised while talking to the provider.
  const code = AISDKError.isInstance(error) ? "provider_error" : "internal_error";
  return { code, message, userMessage: message };
}

/** A provider error part or an error finish: the call failed. */
export function providerError(error: unknown): TurnError {
  return new TurnError("provider_error", messageOf(error), undefined, { cause: error });
}

interface StopDetails {
  type?: string;
  category?: string;
  explanation?: string;
}

/**
 * A call that finished with `content-filter`: on Anthropic `stop_reason:
 * "refusal"`, with the classifier's category in `stop_details` (Sonnet 5.5's
 * classifiers include `bio`); on Google a safety block. Recorded as
 * `error_code = refusal` instead of being saved as an empty answer.
 */
export function refusalError(rawFinishReason: string | undefined, providerMetadata: ProviderMetadata | undefined): TurnError {
  const details = providerMetadata?.anthropic?.stopDetails as StopDetails | undefined;
  const category = details?.category ?? undefined;
  const message = [
    `stop_reason=${rawFinishReason ?? "content-filter"}`,
    category && `category=${category}`,
    details?.explanation && `explanation=${details.explanation}`,
  ]
    .filter(Boolean)
    .join("; ");
  const userMessage =
    `The model declined to answer this request${category ? ` (safety category: ${category})` : ""}. ` +
    "No answer was saved for it; you can rephrase the question or ask something else.";
  return new TurnError("refusal", message, userMessage);
}

// ── Per-session lock ──────────────────────────────────────────────────────

/**
 * Sessions with a turn in progress. In-process: the app runs as one process.
 * A second turn in the same session would interleave its messages (and, with
 * the model transcript, its `seq`) with the running one.
 */
const activeSessions = new Set<string>();

export const TURN_IN_PROGRESS_MESSAGE =
  "A reply is already in progress in this chat. Wait for it to finish, then send your message again.";

/** Takes the session's lock; returns its release function, or null when it is held. */
export function acquireSessionLock(sessionId: string): (() => void) | null {
  if (activeSessions.has(sessionId)) return null;
  activeSessions.add(sessionId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeSessions.delete(sessionId);
  };
}

// ── chat_turns row ────────────────────────────────────────────────────────

/** Stores the user message and its turn (`running`) together; returns both ids. */
export function startTurn(sessionId: string, userMessage: string): { turnId: string; userMessageId: string } {
  const turnId = uuidv4();
  const userMessageId = uuidv4();
  // One transaction: a turn always has its user message, and vice versa. The
  // queries use the shared connection, so they run inside it without `tx`.
  db.transaction(() => {
    messageQueries.create(userMessageId, sessionId, "user", userMessage, null);
    chatTurnQueries.start(turnId, sessionId, userMessageId);
  });
  return { turnId, userMessageId };
}

/**
 * Finalizes a failed or aborted turn. Never throws: a failure here must not
 * mask the turn's own error. A turn already finalized is left as is.
 */
export function finishFailedTurn(turnId: string, outcome: ChatTurnOutcome, ctx: LogContext): void {
  try {
    chatTurnQueries.finish(turnId, outcome);
    logger.info("CHAT", "turn_finished", {
      ctx,
      data: { turn_id: turnId, status: outcome.status, error_code: outcome.errorCode, iterations: outcome.iterations },
    });
  } catch (error) {
    logger.error("CHAT", "turn_finish_failed", {
      ctx,
      error: error instanceof Error ? error : String(error),
      data: { turn_id: turnId, status: outcome.status, error_code: outcome.errorCode },
    });
  }
}

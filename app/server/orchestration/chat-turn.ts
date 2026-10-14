import { AISDKError, type ProviderMetadata } from "ai";
import { v4 as uuidv4 } from "uuid";
import { db, chatSessionQueries, chatTurnQueries, messageQueries, type ChatTurnOutcome } from "../db";
import { logger, type LogContext } from "../logger";
import { turnSignals, writeTurnScores } from "../observability/turn-signals";

export type TurnErrorCode =
  | "provider_error"
  | "context_budget"
  | "max_tool_iterations"
  | "refusal"
  | "no_tools_available"
  | "internal_error"
  | "budget_exceeded"
  | "aborted"
  | "closed";

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
  message: string;
  userMessage: string;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function classifyTurnError(error: unknown): TurnFailure {
  if (error instanceof TurnError) {
    return { code: error.code, message: error.message, userMessage: error.userMessage };
  }
  const message = messageOf(error);
  const code = AISDKError.isInstance(error) ? "provider_error" : "internal_error";
  return { code, message, userMessage: message };
}

export function providerError(error: unknown): TurnError {
  return new TurnError("provider_error", messageOf(error), undefined, { cause: error });
}

interface StopDetails {
  type?: string;
  category?: string;
  explanation?: string;
}

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

const activeSessions = new Set<string>();

export const TURN_IN_PROGRESS_MESSAGE =
  "A reply is already in progress in this chat. Wait for it to finish, then send your message again.";

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

const activeTurns = new Map<AbortController, Promise<void>>();

export function registerActiveTurn(abort: AbortController): () => void {
  let drained!: () => void;
  activeTurns.set(abort, new Promise<void>((resolve) => (drained = resolve)));
  return () => {
    activeTurns.delete(abort);
    drained();
  };
}

export async function abortActiveTurns(timeoutMs: number): Promise<number> {
  if (activeTurns.size === 0) return 0;
  const drains = [...activeTurns.values()];
  for (const abort of activeTurns.keys()) abort.abort(new Error("Server shutting down"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)));
  await Promise.race([Promise.all(drains), timedOut]);
  clearTimeout(timer);
  return activeTurns.size;
}

export function startTurn(
  sessionId: string,
  userMessage: string,
  newSessionUserId: string | null = null
): { turnId: string; userMessageId: string } {
  const turnId = uuidv4();
  const userMessageId = uuidv4();
  db.transaction(() => {
    if (newSessionUserId) chatSessionQueries.create(sessionId, newSessionUserId, null);
    messageQueries.create(userMessageId, sessionId, "user", userMessage, null);
    chatTurnQueries.start(turnId, sessionId, userMessageId);
  });
  return { turnId, userMessageId };
}

export function recordTraceId(turnId: string, traceId: string | null, ctx: LogContext): void {
  if (!traceId) return;
  try {
    chatTurnQueries.setTraceId(turnId, traceId);
  } catch (error) {
    logger.warn("TRACE", "trace_id_write_failed", { ctx, error: error instanceof Error ? error : String(error) });
  }
}

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

export function scoreTurn(turnId: string, ctx: LogContext, observationId: string | null = null): void {
  try {
    const row = chatTurnQueries.findById(turnId);
    if (!row?.trace_id || row.status === "running") return;
    const signals = turnSignals(row);
    if (signals) writeTurnScores({ traceId: row.trace_id, observationId }, signals, ctx);
  } catch (error) {
    logger.warn("TRACE", "turn_scores_failed", { ctx, error: error instanceof Error ? error : String(error) });
  }
}

/**
 * The experiment task for one dataset item (plan 2.1 step 3): a fresh session,
 * each turn drained through the production chat orchestrator with the turn
 * root nested under the experiment task span, then the output read back from
 * the eval DB's persisted rows.
 *
 * Imports server modules: load only after run.ts pointed DATABASE_URL at the
 * run's own DB.
 */
import { randomUUID } from "node:crypto";
import { getActiveSpanId, getActiveTraceId } from "@langfuse/tracing";
import { chatTurnQueries, messageQueries, modelTranscriptQueries, usageEventQueries } from "../../server/db";
import { desanitizeToolName, type LLMProviderName } from "../../server/llm";
import type { TraceParent } from "../../server/observability/turn-trace";
import type { SharedCostBudget } from "../../server/orchestration/cost-budget";
import { processChat } from "../../server/orchestration/chat-v2";
import type { TaskOutput } from "../evaluators/types";
import type { RunLifecycle } from "./lifecycle";
import { buildTaskOutput } from "./task-output";

export interface TaskContext {
  userId: string;
  provider: LLMProviderName;
  budget: SharedCostBudget;
  lifecycle: RunLifecycle;
  log: (line: string) => void;
}

export class RunStoppedError extends Error {
  constructor(itemId: string) {
    super(`run stopped; item ${itemId} not scored`);
    this.name = "RunStoppedError";
  }
}

/** The experiment task span, read from async context (the task callback is a plain async function). */
export function activeTraceParent(): TraceParent | undefined {
  const traceId = getActiveTraceId();
  const spanId = getActiveSpanId();
  return traceId && spanId ? { traceId, spanId } : undefined;
}

/** Reads an item session's rows from the eval DB into the task output. */
export function readTaskOutput(itemId: string, sessionId: string, durationsMs: number[], provider: LLMProviderName): TaskOutput {
  const turns = chatTurnQueries.findBySessionId(sessionId);
  const messages = new Map<string, string | null>();
  for (const id of turns.flatMap((t) => [t.user_message_id, t.assistant_message_id])) {
    if (id) messages.set(id, messageQueries.findById(id)?.content ?? null);
  }
  return buildTaskOutput({
    itemId,
    sessionId,
    turns,
    messages,
    transcript: modelTranscriptQueries.findBySessionId(sessionId),
    usage: turns.flatMap((t) => usageEventQueries.findByTurnId(t.id)),
    durationsMs,
    toolName: (name) => desanitizeToolName(name, provider),
  });
}

type ItemLike = { id?: string; input?: unknown };

export function createItemTask(ctx: TaskContext): (item: ItemLike) => Promise<TaskOutput> {
  return async (item) => {
    const itemId = item.id ?? "unknown";
    const turns = (item.input as { turns?: unknown } | undefined)?.turns;
    if (!Array.isArray(turns) || !turns.every((t) => typeof t === "string")) throw new Error(`item ${itemId}: input.turns must be strings`);
    if (ctx.lifecycle.stopping) throw new RunStoppedError(itemId);

    const sessionId = randomUUID();
    const traceParent = activeTraceParent();
    if (!traceParent) ctx.log(`warning: no active experiment span for ${itemId}; turns get their own traces (linked by trace_id in the output)`);
    const durations: number[] = [];
    let budgetStopped = false;

    for (const [i, message] of turns.entries()) {
      if (ctx.lifecycle.stopping) throw new RunStoppedError(itemId);
      // No new turn once the shared budget is spent: the item is incomplete.
      if (ctx.budget.exhausted) {
        budgetStopped = true;
        break;
      }
      const started = performance.now();
      const drain = (async () => {
        for await (const _event of processChat(sessionId, ctx.userId, message, ctx.lifecycle.abort.signal, {
          traceParent,
          costBudget: ctx.budget,
        })) {
          // Events go to the DB; the output is read from persisted rows.
        }
      })();
      await ctx.lifecycle.track(`${itemId} (turn ${i + 1})`, drain);
      durations.push(performance.now() - started);
    }
    // A turn cut off by a signal is not scored.
    if (ctx.lifecycle.stopping) throw new RunStoppedError(itemId);

    const output = readTaskOutput(itemId, sessionId, durations, ctx.provider);
    return budgetStopped ? { ...output, skipped: "budget" } : output;
  };
}

import { and, asc, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { chatTurns } from "../schema";

export type DbChatTurn = typeof chatTurns.$inferSelect;
export type ChatTurnStatus = DbChatTurn["status"];

export interface ChatTurnOutcome {
  status: Exclude<ChatTurnStatus, "running">;
  errorCode?: string | null;
  errorMessage?: string | null;
  iterations: number;
  assistantMessageId?: string | null;
  lastPromptTokens?: number | null;
  finalFinishReason?: string | null;
  toolErrorCount?: number;
}

export function createChatTurnQueries(db: DrizzleDb) {
  return {
    start(id: string, sessionId: string, userMessageId: string): void {
      db.insert(chatTurns).values({ id, session_id: sessionId, user_message_id: userMessageId }).run();
    },

    setTraceId(id: string, traceId: string): void {
      db.update(chatTurns).set({ trace_id: traceId }).where(eq(chatTurns.id, id)).run();
    },

    finish(id: string, outcome: ChatTurnOutcome): boolean {
      const updated = db
        .update(chatTurns)
        .set({
          status: outcome.status,
          error_code: outcome.errorCode ?? null,
          error_message: outcome.errorMessage ?? null,
          iterations: outcome.iterations,
          assistant_message_id: outcome.assistantMessageId ?? null,
          last_prompt_tokens: outcome.lastPromptTokens ?? null,
          final_finish_reason: outcome.finalFinishReason ?? null,
          tool_error_count: outcome.toolErrorCount ?? 0,
          finished_at: sql`(unixepoch())`,
        })
        .where(and(eq(chatTurns.id, id), eq(chatTurns.status, "running")))
        .returning({ id: chatTurns.id })
        .all();
      return updated.length > 0;
    },

    findById(id: string): DbChatTurn | null {
      return db.select().from(chatTurns).where(eq(chatTurns.id, id)).get() ?? null;
    },

    findBySessionId(sessionId: string): DbChatTurn[] {
      return db
        .select()
        .from(chatTurns)
        .where(eq(chatTurns.session_id, sessionId))
        .orderBy(asc(chatTurns.started_at), asc(sql`rowid`))
        .all();
    },
  };
}

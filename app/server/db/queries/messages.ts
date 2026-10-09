import { asc, eq } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { messages } from "../schema";
import type { DbMessageRow } from "../../types";

export function createMessageQueries(db: DrizzleDb) {
  return {
    create(
      id: string,
      chatId: string,
      role: string,
      content: string | null,
      toolCalls: string | null,
      inputTokens: number = 0,
      outputTokens: number = 0,
      reasoning: string | null = null,
      costMicrousd: number = 0
    ) {
      return db
        .insert(messages)
        .values({
          id,
          chat_id: chatId,
          // The CHECK constraint rejects anything outside the enum.
          role: role as DbMessageRow["role"],
          content,
          tool_calls: toolCalls,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          reasoning,
          cost_microusd: costMicrousd,
        })
        .run();
    },

    findByChatId(chatId: string): DbMessageRow[] {
      return db.select().from(messages).where(eq(messages.chat_id, chatId)).orderBy(asc(messages.created_at)).all();
    },

    findById(id: string): DbMessageRow | null {
      return db.select().from(messages).where(eq(messages.id, id)).get() ?? null;
    },
  };
}

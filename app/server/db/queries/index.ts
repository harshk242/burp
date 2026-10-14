import type { DrizzleDb } from "../connection";
import { createAccessRequestQueries } from "./access-requests";
import { createArtifactQueries } from "./artifacts";
import { createChatSessionQueries } from "./chat-sessions";
import { createChatTurnQueries } from "./chat-turns";
import { createDailyUsageQueries } from "./daily-usage";
import { createMessageFeedbackQueries } from "./message-feedback";
import { createMessageQueries } from "./messages";
import { createModelTranscriptQueries } from "./model-transcript";
import { createRateLimitQueries } from "./rate-limits";
import { createToolSearchQueries } from "./tool-search";
import { createUsageEventQueries } from "./usage-events";
import { createUserQueries } from "./users";

export type { DbArtifact } from "./artifacts";
export type { ChatTurnOutcome, ChatTurnStatus, DbChatTurn } from "./chat-turns";
export type { DbMessageFeedback, FeedbackKey, FeedbackValue } from "./message-feedback";
export type { DbTranscriptRow, NewTranscriptRow, TranscriptRole } from "./model-transcript";
export type { ToolSearchRow } from "./tool-search";
export type { UsageTotals } from "./usage-events";

export function createQueries(db: DrizzleDb) {
  return {
    userQueries: createUserQueries(db),
    accessRequestQueries: createAccessRequestQueries(db),
    chatSessionQueries: createChatSessionQueries(db),
    messageQueries: createMessageQueries(db),
    messageFeedbackQueries: createMessageFeedbackQueries(db),
    chatTurnQueries: createChatTurnQueries(db),
    modelTranscriptQueries: createModelTranscriptQueries(db),
    dailyUsageQueries: createDailyUsageQueries(db),
    usageEventQueries: createUsageEventQueries(db),
    rateLimitQueries: createRateLimitQueries(db),
    toolSearchQueries: createToolSearchQueries(db),
    artifactQueries: createArtifactQueries(db),
  };
}

export type Queries = ReturnType<typeof createQueries>;

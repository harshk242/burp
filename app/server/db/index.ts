/**
 * App database entry point: the shared connection (`db` = Drizzle, `sqlite` =
 * the underlying bun:sqlite handle), boot-time migrations, and every *Queries
 * object bound to the app connection. Query code lives in ./queries.
 */
import { DB_PATH, db, sqlite } from "./client";
import { createQueries } from "./queries";

export { DB_PATH, db, sqlite };
export type { DrizzleDb } from "./client";
export { runMigrations, MigrationFkError, type RunMigrationsResult } from "./migrate";
export type {
  ChatTurnOutcome,
  ChatTurnStatus,
  DbArtifact,
  DbChatTurn,
  DbMessageFeedback,
  FeedbackKey,
  FeedbackValue,
  DbTranscriptRow,
  NewTranscriptRow,
  ToolSearchRow,
  TranscriptRole,
  UsageTotals,
} from "./queries";

export const {
  userQueries,
  accessRequestQueries,
  chatSessionQueries,
  messageQueries,
  messageFeedbackQueries,
  chatTurnQueries,
  modelTranscriptQueries,
  dailyUsageQueries,
  usageEventQueries,
  rateLimitQueries,
  toolSearchQueries,
  artifactQueries,
} = createQueries(db);

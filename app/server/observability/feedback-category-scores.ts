/**
 * Feedback category scores: one BOOLEAN score per category id (both
 * polarities, 10 in total) on the turn's trace, so traces can be filtered on
 * `scores.feedback_<id>:true` (Langfuse filters by score name + value, not by
 * metadata).
 *
 * - Id `fbc-` + sha256(`message_id:user_id:<id>`), stable per category, so a
 *   write overwrites the previous one.
 * - Never deleted: deselect, polarity flip and clear all upsert 0. Only
 *   upserts ever exist for `fbc-*` ids, so they stay out of the main score's
 *   delete-ordering protocol and the last write wins.
 */

import { createHash } from "node:crypto";
import type { FeedbackKey } from "../db/queries";
import { logger } from "../logger";
import { ALL_CATEGORY_IDS, type FeedbackCategory } from "../schemas/feedback-categories";
import { scoreConfigId } from "./score-configs";
import type { ScoreUpsert, ScoreWriter } from "./score-writer";

export const FEEDBACK_CATEGORY_SCORE_PREFIX = "feedback_";

export function feedbackCategoryScoreName(category: FeedbackCategory): string {
  return `${FEEDBACK_CATEGORY_SCORE_PREFIX}${category}`;
}

/** Stable score id for one category of a user's feedback on a message. */
export function feedbackCategoryScoreId({ messageId, userId }: FeedbackKey, category: FeedbackCategory): string {
  const hash = createHash("sha256").update(`${messageId}:${userId}:${category}`).digest("hex");
  return `fbc-${hash.slice(0, 32)}`;
}

/** The full category state: every category, 1 if selected, else 0. */
export function categoryScoreUpserts(
  key: FeedbackKey,
  traceId: string,
  selected: readonly FeedbackCategory[],
  environment: string
): ScoreUpsert[] {
  return ALL_CATEGORY_IDS.map((category) => {
    const name = feedbackCategoryScoreName(category);
    return {
      id: feedbackCategoryScoreId(key, category),
      traceId,
      name,
      value: selected.includes(category) ? 1 : 0,
      dataType: "BOOLEAN",
      environment,
      configId: scoreConfigId(name),
      metadata: { message_id: key.messageId },
    };
  });
}

/**
 * Sends every upsert and waits for all of them to settle (allSettled, never
 * all: a push must not end while a sibling request is still in flight, or a
 * later push's write could land before it). True only if all succeeded.
 */
export async function writeCategoryScores(writer: ScoreWriter, scores: ScoreUpsert[]): Promise<boolean> {
  const results = await Promise.allSettled(scores.map((score) => writer.upsert(score)));
  let ok = true;
  results.forEach((result, i) => {
    if (result.status === "fulfilled") return;
    ok = false;
    const reason: unknown = result.reason;
    logger.warn("TRACE", "feedback_category_sync_failed", {
      data: { score_id: scores[i]!.id, name: scores[i]!.name },
      error: reason instanceof Error ? reason : String(reason),
    });
  });
  return ok;
}

/** Pure helpers for the 👍/👎 feedback dialog (kept DOM-free so they can be unit tested). */

export const FEEDBACK_COMMENT_MAX = 2000;
/** Show the character counter once this few characters remain. */
export const FEEDBACK_COUNTER_THRESHOLD = 200;

export function feedbackDialogTitle(value: 0 | 1): string {
  return value === 1 ? "What did you like?" : "What went wrong?";
}

/** Send needs at least one category or non-blank text, and no save in flight. */
export function canSendFeedback(comment: string, categoryCount: number, saving: boolean): boolean {
  return !saving && (categoryCount > 0 || comment.trim().length > 0);
}

/** Skip / Esc / overlay / ✕ can't close the dialog mid-Send: the thumb is disabled until the save settles, so focus couldn't return to it. */
export function canDismissFeedback(saving: boolean): boolean {
  return !saving;
}

export function showCommentCounter(comment: string): boolean {
  return comment.length >= FEEDBACK_COMMENT_MAX - FEEDBACK_COUNTER_THRESHOLD;
}

/** Cmd+Enter (macOS) or Ctrl+Enter submits. */
export function isSubmitShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

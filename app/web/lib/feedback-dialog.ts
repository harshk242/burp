/** Pure helpers for the 👍/👎 feedback dialog (kept DOM-free so they can be unit tested). */

export const FEEDBACK_COMMENT_MAX = 2000;
/** Show the character counter once this few characters remain. */
export const FEEDBACK_COUNTER_THRESHOLD = 200;

export function feedbackDialogTitle(value: 0 | 1): string {
  return value === 1 ? "What did you like?" : "What went wrong?";
}

export function canSendFeedback(comment: string, saving: boolean): boolean {
  return !saving && comment.trim().length > 0;
}

export function showCommentCounter(comment: string): boolean {
  return comment.length >= FEEDBACK_COMMENT_MAX - FEEDBACK_COUNTER_THRESHOLD;
}

/** Cmd+Enter (macOS) or Ctrl+Enter submits. */
export function isSubmitShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

export const FEEDBACK_COMMENT_MAX = 2000;
export const FEEDBACK_COUNTER_THRESHOLD = 200;

export function feedbackDialogTitle(value: 0 | 1): string {
  return value === 1 ? "What did you like?" : "What went wrong?";
}

export function canSendFeedback(comment: string, categoryCount: number, saving: boolean): boolean {
  return !saving && (categoryCount > 0 || comment.trim().length > 0);
}

export function canDismissFeedback(saving: boolean): boolean {
  return !saving;
}

export function showCommentCounter(comment: string): boolean {
  return comment.length >= FEEDBACK_COMMENT_MAX - FEEDBACK_COUNTER_THRESHOLD;
}

export function isSubmitShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

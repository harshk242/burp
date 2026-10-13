/**
 * 👍/👎 feedback categories: a mirror of the server's list
 * (server/schemas/feedback-categories.ts, the source of truth for ids) plus
 * UI labels and hints. A test on each side pins the ids, so keep them in sync.
 */

export const NEGATIVE_FEEDBACK_CATEGORIES = [
  { id: "factually_incorrect", label: "Factually incorrect", hint: "Wrong gene, variant, drug or mechanism details" },
  {
    id: "wrong_citation",
    label: "Wrong or missing citation",
    hint: "Bad PMID/DOI, source doesn't support the claim, or no source",
  },
  { id: "incomplete", label: "Incomplete", hint: "Missed key data, databases or caveats" },
  { id: "off_target", label: "Didn't answer my question", hint: "Off-topic or misread the question" },
  { id: "outdated", label: "Outdated information", hint: "Old trial status, superseded guidelines" },
] as const;

export const POSITIVE_FEEDBACK_CATEGORIES = [
  { id: "accurate", label: "Accurate", hint: null },
  { id: "well_sourced", label: "Well-sourced", hint: "Useful citations and database links" },
  { id: "comprehensive", label: "Comprehensive", hint: "Covered all the angles" },
  { id: "clear", label: "Clear and well-organized", hint: null },
  { id: "saved_time", label: "Saved me time", hint: null },
] as const;

export type FeedbackCategoryId =
  | (typeof NEGATIVE_FEEDBACK_CATEGORIES)[number]["id"]
  | (typeof POSITIVE_FEEDBACK_CATEGORIES)[number]["id"];

export interface FeedbackCategoryOption {
  id: FeedbackCategoryId;
  label: string;
  hint: string | null;
}

/** The pills for a rating: 👍 (1) → positive, 👎 (0) → negative. */
export function feedbackCategoriesFor(value: 0 | 1): readonly FeedbackCategoryOption[] {
  return value === 1 ? POSITIVE_FEEDBACK_CATEGORIES : NEGATIVE_FEEDBACK_CATEGORIES;
}

/** Adds or removes a category, keeping the list deduped and sorted (as the server stores it). */
export function toggleFeedbackCategory(selected: readonly FeedbackCategoryId[], id: FeedbackCategoryId): FeedbackCategoryId[] {
  const next = selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id];
  return [...new Set(next)].sort();
}

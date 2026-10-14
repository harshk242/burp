/**
 * Fixed 👍/👎 feedback categories. Ids are stable slugs: they are stored in
 * message_feedback.categories and later used as Langfuse score names, so never
 * rename one. Labels and hints live in the web app's mirrored copy
 * (web/lib/feedback-categories.ts); a test on each side pins the id list.
 */
export const NEGATIVE_CATEGORIES = [
  "factually_incorrect",
  "wrong_citation",
  "incomplete",
  "off_target",
  "outdated",
] as const;

export const POSITIVE_CATEGORIES = ["accurate", "well_sourced", "comprehensive", "clear", "saved_time"] as const;

export const ALL_CATEGORY_IDS = [...NEGATIVE_CATEGORIES, ...POSITIVE_CATEGORIES] as const;

export type FeedbackCategory = (typeof ALL_CATEGORY_IDS)[number];

export const MAX_FEEDBACK_CATEGORIES = 5;

/** The categories allowed for a rating: 👍 (1) → positive, 👎 (0) → negative. */
export function categoriesForValue(value: 0 | 1): readonly FeedbackCategory[] {
  return value === 1 ? POSITIVE_CATEGORIES : NEGATIVE_CATEGORIES;
}

/** Deduped and sorted, as stored. */
export function normalizeCategories(categories: readonly FeedbackCategory[]): FeedbackCategory[] {
  return [...new Set(categories)].sort();
}

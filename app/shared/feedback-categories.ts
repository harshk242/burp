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

export function categoriesForValue(value: 0 | 1): readonly FeedbackCategory[] {
  return value === 1 ? POSITIVE_CATEGORIES : NEGATIVE_CATEGORIES;
}

export function normalizeCategories(categories: readonly FeedbackCategory[]): FeedbackCategory[] {
  return [...new Set(categories)].sort();
}

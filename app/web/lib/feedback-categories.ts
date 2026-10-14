import {
  NEGATIVE_CATEGORIES, POSITIVE_CATEGORIES, normalizeCategories, type FeedbackCategory,
} from "../../shared/feedback-categories";

export type FeedbackCategoryId = FeedbackCategory;
export interface FeedbackCategoryOption {
  id: FeedbackCategoryId;
  label: string;
  hint: string | null;
}

const DISPLAY: Record<FeedbackCategoryId, Omit<FeedbackCategoryOption, "id">> = {
  factually_incorrect: { label: "Factually incorrect", hint: "Wrong gene, variant, drug or mechanism details" },
  wrong_citation: { label: "Wrong or missing citation", hint: "Bad PMID/DOI, source doesn't support the claim, or no source" },
  incomplete: { label: "Incomplete", hint: "Missed key data, databases or caveats" },
  off_target: { label: "Didn't answer my question", hint: "Off-topic or misread the question" },
  outdated: { label: "Outdated information", hint: "Old trial status, superseded guidelines" },
  accurate: { label: "Accurate", hint: null },
  well_sourced: { label: "Well-sourced", hint: "Useful citations and database links" },
  comprehensive: { label: "Comprehensive", hint: "Covered all the angles" },
  clear: { label: "Clear and well-organized", hint: null },
  saved_time: { label: "Saved me time", hint: null },
};
const option = (id: FeedbackCategoryId): FeedbackCategoryOption => ({ id, ...DISPLAY[id] });
export const NEGATIVE_FEEDBACK_CATEGORIES = NEGATIVE_CATEGORIES.map(option);
export const POSITIVE_FEEDBACK_CATEGORIES = POSITIVE_CATEGORIES.map(option);

export function feedbackCategoriesFor(value: 0 | 1): readonly FeedbackCategoryOption[] {
  return value === 1 ? POSITIVE_FEEDBACK_CATEGORIES : NEGATIVE_FEEDBACK_CATEGORIES;
}

export function toggleFeedbackCategory(selected: readonly FeedbackCategoryId[], id: FeedbackCategoryId): FeedbackCategoryId[] {
  return normalizeCategories(selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id]);
}

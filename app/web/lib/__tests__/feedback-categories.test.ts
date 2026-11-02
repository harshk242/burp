import { describe, expect, test } from "bun:test";
import {
  NEGATIVE_FEEDBACK_CATEGORIES,
  POSITIVE_FEEDBACK_CATEGORIES,
  feedbackCategoriesFor,
  toggleFeedbackCategory,
} from "../feedback-categories";

describe("feedback categories", () => {
  test("pins the category ids per polarity", () => {
    expect(NEGATIVE_FEEDBACK_CATEGORIES.map((c) => c.id)).toEqual([
      "factually_incorrect",
      "wrong_citation",
      "incomplete",
      "off_target",
      "outdated",
    ]);
    expect(POSITIVE_FEEDBACK_CATEGORIES.map((c) => c.id)).toEqual([
      "accurate",
      "well_sourced",
      "comprehensive",
      "clear",
      "saved_time",
    ]);
  });

  test("pills follow the rating's polarity", () => {
    expect(feedbackCategoriesFor(1)).toBe(POSITIVE_FEEDBACK_CATEGORIES);
    expect(feedbackCategoriesFor(0)).toBe(NEGATIVE_FEEDBACK_CATEGORIES);
  });

  test("every category has a label", () => {
    for (const c of [...NEGATIVE_FEEDBACK_CATEGORIES, ...POSITIVE_FEEDBACK_CATEGORIES]) expect(c.label.length).toBeGreaterThan(0);
  });

  test("toggling adds and removes, keeping the list sorted", () => {
    expect(toggleFeedbackCategory([], "well_sourced")).toEqual(["well_sourced"]);
    expect(toggleFeedbackCategory(["well_sourced"], "accurate")).toEqual(["accurate", "well_sourced"]);
    expect(toggleFeedbackCategory(["accurate", "well_sourced"], "accurate")).toEqual(["well_sourced"]);
  });
});

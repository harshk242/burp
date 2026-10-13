/**
 * Pins the feedback category ids. They are stored in the DB and used as
 * Langfuse score names; web/lib/feedback-categories.ts mirrors this list and
 * has the same pin, so a change here must be made there too.
 */
import { describe, expect, it } from "bun:test";
import {
  ALL_CATEGORY_IDS,
  NEGATIVE_CATEGORIES,
  POSITIVE_CATEGORIES,
  categoriesForValue,
  normalizeCategories,
} from "../schemas/feedback-categories";

describe("feedback categories", () => {
  it("pins the category ids per polarity", () => {
    expect([...NEGATIVE_CATEGORIES]).toEqual(["factually_incorrect", "wrong_citation", "incomplete", "off_target", "outdated"]);
    expect([...POSITIVE_CATEGORIES]).toEqual(["accurate", "well_sourced", "comprehensive", "clear", "saved_time"]);
    expect(new Set(ALL_CATEGORY_IDS).size).toBe(10);
  });

  it("maps 👍 to positive and 👎 to negative categories", () => {
    expect(categoriesForValue(1)).toBe(POSITIVE_CATEGORIES);
    expect(categoriesForValue(0)).toBe(NEGATIVE_CATEGORIES);
  });

  it("dedupes and sorts", () => {
    expect(normalizeCategories(["well_sourced", "accurate", "well_sourced"])).toEqual(["accurate", "well_sourced"]);
  });
});

import { describe, expect, test } from "bun:test";
import {
  FEEDBACK_COMMENT_MAX,
  canSendFeedback,
  feedbackDialogTitle,
  isSubmitShortcut,
  showCommentCounter,
} from "../feedback-dialog";

describe("feedback dialog helpers", () => {
  test("title depends on polarity", () => {
    expect(feedbackDialogTitle(1)).toBe("What did you like?");
    expect(feedbackDialogTitle(0)).toBe("What went wrong?");
  });

  test("send needs a category or non-blank text, and no save in flight", () => {
    expect(canSendFeedback("", 0, false)).toBe(false);
    expect(canSendFeedback("   \n", 0, false)).toBe(false);
    expect(canSendFeedback("wrong PMID", 0, false)).toBe(true);
    expect(canSendFeedback("", 1, false)).toBe(true);
    expect(canSendFeedback("wrong PMID", 0, true)).toBe(false);
    expect(canSendFeedback("", 2, true)).toBe(false);
  });

  test("counter appears only near the limit", () => {
    expect(showCommentCounter("short")).toBe(false);
    expect(showCommentCounter("x".repeat(FEEDBACK_COMMENT_MAX - 201))).toBe(false);
    expect(showCommentCounter("x".repeat(FEEDBACK_COMMENT_MAX - 200))).toBe(true);
    expect(showCommentCounter("x".repeat(FEEDBACK_COMMENT_MAX))).toBe(true);
  });

  test("Cmd/Ctrl+Enter is the submit shortcut, plain Enter is not", () => {
    expect(isSubmitShortcut({ key: "Enter", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSubmitShortcut({ key: "Enter", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isSubmitShortcut({ key: "Enter", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isSubmitShortcut({ key: "a", metaKey: true, ctrlKey: true })).toBe(false);
  });
});

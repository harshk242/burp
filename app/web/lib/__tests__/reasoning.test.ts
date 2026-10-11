import { describe, expect, it } from "bun:test";
import { joinReasoning } from "../reasoning";

describe("joinReasoning", () => {
  it("separates segments with exactly one blank line", () => {
    expect(joinReasoning(["A.", "B."])).toBe("A.\n\nB.");
    expect(joinReasoning(["A.\n\n", "\n\nB.\n\n", "C."])).toBe("A.\n\nB.\n\nC.");
  });

  it("skips whitespace-only segments", () => {
    expect(joinReasoning(["A.", "\n", "  ", "B."])).toBe("A.\n\nB.");
    expect(joinReasoning(["\n\n"])).toBe("");
    expect(joinReasoning([])).toBe("");
  });

  it("keeps blank lines and indentation inside a segment", () => {
    expect(joinReasoning(["\n    code\n\nmore\n\n"])).toBe("    code\n\nmore");
  });
});

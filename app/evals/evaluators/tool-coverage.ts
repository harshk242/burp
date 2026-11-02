import type { ItemEvaluator } from "./types";

export function globMatches(glob: string, name: string): boolean {
  const pattern = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${pattern}$`).test(name);
}

export const toolCoverage: ItemEvaluator = (output, item) => {
  if (output.skipped) return null;
  const globs = item.expected_output.expected_tools_any ?? [];
  if (globs.length === 0) return null;
  const called = [...new Set(output.turns.flatMap((t) => t.tool_calls.map((c) => c.name)))];
  const matched = called.filter((name) => globs.some((g) => globMatches(g, name)));
  return {
    name: "expected_tool_coverage",
    value: matched.length > 0 ? 1 : 0,
    dataType: "BOOLEAN",
    comment: matched.length
      ? `matched: ${matched.join(", ")}`
      : `no call matched ${globs.join(" | ")}; called: ${called.join(", ") || "none"}`,
  };
};

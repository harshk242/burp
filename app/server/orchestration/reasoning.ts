/**
 * Joins reasoning blocks (thinking summaries, pre-tool-call text) with exactly
 * one blank line. Summaries already end in a blank line, so each block's
 * leading blank lines and trailing whitespace are dropped first;
 * whitespace-only blocks are skipped.
 */
export function joinReasoning(blocks: readonly string[]): string {
  return blocks
    .map((block) => block.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd())
    .filter(Boolean)
    .join("\n\n");
}

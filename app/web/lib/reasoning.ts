/**
 * Joins reasoning segments for the ReasoningBlock. Mirrors `joinReasoning` in
 * app/server/orchestration/reasoning.ts, so the live block, the finalized
 * message and a reloaded message show the same text.
 *
 * Exactly one blank line between segments: thinking summaries already end in a
 * blank line, so each segment's leading blank lines and trailing whitespace are
 * dropped first; whitespace-only segments are skipped.
 */
export function joinReasoning(segments: readonly string[]): string {
  return segments
    .map((segment) => segment.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd())
    .filter(Boolean)
    .join("\n\n");
}

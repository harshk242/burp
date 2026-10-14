export function joinReasoning(segments: readonly string[]): string {
  return segments
    .map((segment) => segment.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd())
    .filter(Boolean)
    .join("\n\n");
}

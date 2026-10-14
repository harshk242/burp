export function joinReasoning(blocks: readonly string[]): string {
  return blocks
    .map((block) => block.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd())
    .filter(Boolean)
    .join("\n\n");
}

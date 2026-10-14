import { tool } from "ai";
import { z } from "zod";
import { artifactStore, MAX_TEXT_RANGE_CHARS } from "./artifact-store";

export function createInspectArtifactTool(sessionId: string) {
  return tool({
    description:
      "Inspect a stored artifact: use jq_filter for JSON or text_range for text. " +
      "Use this to extract specific fields, filter arrays, or reshape data " +
      "from large tool outputs that were too big to include inline. " +
      "The artifact_id and available structure are shown in the tool result preview. " +
      "You can call this multiple times with different filters to inspect different " +
      "parts of the data.",
    inputSchema: z.object({
      artifact_id: z
        .string()
        .describe("The artifact ID from the preview (e.g. art_a1b2c3d4)"),
      jq_filter: z
        .string().optional()
        .describe(
          "A jq filter expression to extract/reshape the data. Examples: " +
            "'.results[] | .name' — extract names; " +
            "'.results[:5]' — first 5 items; " +
            "'[.results[] | {id: .id, score: .score}]' — reshape; " +
            "'[.results[] | select(.type == \"gene\")]' — filter by field; " +
            "'.results | length' — count items",
        ),
      text_range: z.object({
        start: z.number().int().nonnegative().describe("Zero-based UTF-16 code-unit offset"),
        length: z.number().int().min(1).max(MAX_TEXT_RANGE_CHARS).describe("Maximum UTF-16 code units to read"),
      }).optional(),
    }),
    execute: async ({ artifact_id, jq_filter, text_range }, { abortSignal }) => {
      abortSignal?.throwIfAborted();
      if ((jq_filter === undefined) === (text_range === undefined)) {
        return JSON.stringify({ error: "Provide exactly one of jq_filter or text_range." });
      }
      if (text_range) {
        return JSON.stringify(artifactStore.readText(artifact_id, sessionId, text_range.start, text_range.length));
      }
      const result = await artifactStore.query(
        artifact_id,
        sessionId,
        jq_filter!,
        abortSignal,
      );
      abortSignal?.throwIfAborted();

      if (result.error) {
        return JSON.stringify({ error: result.error });
      }

      const output =
        typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result);

      if (result.truncated) {
        return `[Output truncated to the first values that fit the size limit — try a more specific jq filter]\n${output}`;
      }

      return output;
    },
  });
}

/**
 * inspect_artifact Tool
 *
 * Vercel AI SDK tool that allows the LLM to query stored artifacts
 * using jq filter expressions. Dynamically added to activeTools
 * when an artifact is created.
 *
 * The sessionId is bound at creation time (closure) so the tool
 * can only access artifacts belonging to the current session.
 */

import { tool } from "ai";
import { z } from "zod";
import { artifactStore } from "./artifact-store";

/**
 * Create a session-bound inspect_artifact tool.
 *
 * @param sessionId - The chat session this tool is scoped to
 */
export function createInspectArtifactTool(sessionId: string) {
  return tool({
    description:
      "Query a stored data artifact using a jq filter expression. " +
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
        .string()
        .describe(
          "A jq filter expression to extract/reshape the data. Examples: " +
            "'.results[] | .name' — extract names; " +
            "'.results[:5]' — first 5 items; " +
            "'[.results[] | {id: .id, score: .score}]' — reshape; " +
            "'[.results[] | select(.type == \"gene\")]' — filter by field; " +
            "'.results | length' — count items",
        ),
    }),
    execute: async ({ artifact_id, jq_filter }) => {
      const result = await artifactStore.query(
        artifact_id,
        sessionId,
        jq_filter,
      );

      if (result.error) {
        return JSON.stringify({ error: result.error });
      }

      const output = JSON.stringify(result.result);

      // TODO: When truncated, the jq output was sliced mid-JSON and may not
      // be valid structured data. The current behavior returns whatever
      // JSON.parse produced (possibly a string fragment). Evaluate whether
      // to (a) ask the LLM to write a narrower filter, (b) return a
      // structured error, or (c) attempt JSON-safe truncation. Deferred
      // pending real-world usage analysis of inspect_artifact call patterns.
      if (result.truncated) {
        return `[Output truncated to fit size limit — try a more specific jq filter]\n${output}`;
      }

      return output;
    },
  });
}

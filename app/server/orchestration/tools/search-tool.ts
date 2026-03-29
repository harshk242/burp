/**
 * search_available_tools — meta-tool that replaces Claude's built-in tool_search_tool_bm25.
 * Exposed to any LLM as a standard callable tool.
 *
 * Accepts a sanitize function so that the tool names returned to the model
 * match the keys under which they are registered in the active tool set
 * (e.g. "open_targets__..." for Google instead of "open-targets__...").
 */

import { tool } from "ai";
import { z } from "zod";
import { hybridSearch } from "../../search";

export function createSearchTool(
  sanitize: (name: string) => string = (n) => n
) {
  return tool({
    description:
      "Search for specialized bioinformatics tools by describing what you need. " +
      "Returns matching tools with names and descriptions so you can call them directly. " +
      "Use this when the always-available core tools don't cover your needs.",
    inputSchema: z.object({
      query: z.string().describe(
        "Natural language description of the capability you need"
      ),
    }),
    execute: async ({ query }) => {
      const results = await hybridSearch.search(query);
      const topResults = results.slice(0, 8);
      return {
        found: topResults.length,
        tools: topResults.map((r) => ({
          name: sanitize(r.fullName),
          description: r.description,
          relevance_score: r.score,
        })),
        instruction:
          "Call the tool by its exact name with the required parameters.",
      };
    },
  });
}

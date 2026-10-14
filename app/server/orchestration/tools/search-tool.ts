import { tool, type ToolResultPart } from "ai";
import { z } from "zod";
import type { LLMProviderName } from "../../llm";
import { toolRegistry } from "../../mcp/registry";
import { hybridSearch } from "../../search";

export function createSearchTool() {
  return tool({
    description:
      "Search for specialized bioinformatics tools by describing what you need. " +
      "Matching tools become callable right after the search. " +
      "Use this when the always-available core tools don't cover your needs.",
    inputSchema: z.object({
      query: z.string().describe(
        "Natural language description of the capability you need"
      ),
    }),
  });
}

export interface ToolSearchHit {
  /** Registry name (`server__tool`). */
  fullName: string;
  /** Name as declared to the model (provider-sanitized). */
  name: string;
  description: string;
  score: number;
}

export interface ToolSearchSummary {
  found: number;
  tools: { name: string; description: string; relevance_score: number }[];
  instruction: string;
}

export interface ToolSearchRun {
  /** The tools shown (top_k at most), in score order. */
  hits: ToolSearchHit[];
  /** What the model sees as the search tool's result. */
  modelOutput: ToolResultPart["output"];
  /** What the UI sees (SSE tool_end, stored tool call). */
  uiSummary: ToolSearchSummary;
}

export interface ToolSearchOptions {
  provider: LLMProviderName;
  sanitize: (name: string) => string;
  /**
   * Anthropic: the turn's declared tools. A reference to a tool the request
   * doesn't declare is rejected (400), and the catalog is fixed at turn start
   * while MCP recovery can register (and index) new tools mid-turn.
   */
  declared?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}

const NO_HITS = "No matching tools found; try a different query.";
const INSTRUCTION = "Call the tool by its exact name with the required parameters.";

export async function runToolSearch(query: string, opts: ToolSearchOptions): Promise<ToolSearchRun> {
  const results = await hybridSearch.search(query, opts.signal);
  const hits: ToolSearchHit[] = [];
  for (const r of results) {
    const { server, name } = toolRegistry.parseToolName(r.fullName);
    if (!toolRegistry.get(server, name)) continue;
    const declaredName = opts.sanitize(r.fullName);
    if (opts.declared && !(declaredName in opts.declared)) continue;
    hits.push({ fullName: r.fullName, name: declaredName, description: r.description, score: r.score });
  }

  return {
    hits,
    modelOutput: modelOutput(hits, opts.provider),
    uiSummary: {
      found: hits.length,
      tools: hits.map((h) => ({ name: h.name, description: h.description, relevance_score: h.score })),
      instruction: INSTRUCTION,
    },
  };
}

function modelOutput(hits: ToolSearchHit[], provider: LLMProviderName): ToolResultPart["output"] {
  if (hits.length === 0) return { type: "text", value: NO_HITS };
  if (provider === "anthropic") {
    return {
      type: "content",
      value: hits.map((h) => ({
        type: "custom" as const,
        providerOptions: { anthropic: { type: "tool-reference", toolName: h.name } },
      })),
    };
  }
  const lines = hits.map((h) => `- ${h.name} (score ${h.score.toFixed(4)})`);
  return { type: "text", value: `Found ${hits.length} tools. ${INSTRUCTION}\n${lines.join("\n")}` };
}

/**
 * The tool list sent with every LLM call of a turn.
 *
 * Anthropic: a fixed catalog. Every registered tool is declared once, sorted by
 * name; core tools and the two system tools are loaded, everything else is
 * `deferLoading` (loaded later by tool search). The registry's `available` flag
 * is ignored, so availability flicker can't change the list (and break the
 * prompt cache); a call to a tool whose server is down returns an error result.
 *
 * Gemini: no deferred-loading equivalent, so today's set (available core tools
 * + search + inspect_artifact) that tool search grows mid-turn. On Anthropic
 * search adds nothing: its result references the found tools (search-tool.ts).
 */

import type { Tool } from "ai";
import { desanitizeToolName, type LLMProviderName } from "../../llm";
import { toolRegistry } from "../../mcp/registry";
import { ALWAYS_LOADED_TOOLS } from "../../mcp/platforms.config";
import { logger } from "../../logger";
import { createSearchTool } from "../tools/search-tool";
import { createInspectArtifactTool } from "../tools/artifact-inspector";
import { createMcpToolExecutor } from "../tools/mcp-executor";
import { shortHash } from "../usage-meter";

export type ToolSet = Record<string, Tool>;

// Non-MCP tools use the "system__" prefix so they pass through parseToolName()
// and the dispatch loop can route them by server === "system".
export const SEARCH_TOOL_NAME = "system__search_available_tools";
export const INSPECT_TOOL_NAME = "system__inspect_artifact";

const DEFERRED = { anthropic: { deferLoading: true } } as const;

// Hash of the last Anthropic catalog built in this process (catalog_changed).
let lastCatalogHash: string | undefined;

/**
 * Tool set for a turn. System tools carry their `execute` (the dispatcher runs
 * them from this set); MCP tools are run by the dispatcher directly.
 * `sessionId` binds inspect_artifact to the session's artifacts.
 */
export function buildToolCatalog(
  provider: LLMProviderName,
  sanitize: (name: string) => string,
  sessionId: string,
): ToolSet {
  const systemTools: ToolSet = {
    [SEARCH_TOOL_NAME]: createSearchTool(),
    [INSPECT_TOOL_NAME]: createInspectArtifactTool(sessionId),
  };
  if (provider !== "anthropic") return { ...geminiCoreTools(sanitize, provider), ...systemTools };

  const all: ToolSet = { ...toolRegistry.toVercelTools(toolRegistry.getAll(), sanitize), ...systemTools };
  const catalog: ToolSet = {};
  const hashInput: unknown[] = [];
  for (const key of Object.keys(all).sort(byCodePoint)) {
    const loaded = key in systemTools || ALWAYS_LOADED_TOOLS.has(desanitizeToolName(key, provider));
    catalog[key] = loaded ? all[key]! : { ...all[key]!, providerOptions: DEFERRED };
    hashInput.push([key, loaded, all[key]!.description, schemaOf(key)]);
  }

  const hash = shortHash(JSON.stringify(hashInput));
  if (lastCatalogHash !== undefined && hash !== lastCatalogHash) {
    logger.warn("CHAT", "catalog_changed", {
      data: { old_hash: lastCatalogHash, new_hash: hash, tool_count: Object.keys(catalog).length },
    });
  }
  lastCatalogHash = hash;
  return catalog;
}

/** Today's Gemini starting set: available core tools, with executors. */
function geminiCoreTools(sanitize: (name: string) => string, provider: LLMProviderName): ToolSet {
  const tools: ToolSet = {};
  for (const [key, coreTool] of Object.entries(toolRegistry.toVercelCoreTools(sanitize))) {
    tools[key] = { ...coreTool, execute: createMcpToolExecutor(desanitizeToolName(key, provider)) };
  }
  return tools;
}

/** The registry's raw input schema (system tools' schemas are fixed in code). */
function schemaOf(key: string): unknown {
  if (key === SEARCH_TOOL_NAME || key === INSPECT_TOOL_NAME) return null;
  const { server, name } = toolRegistry.parseToolName(key);
  return toolRegistry.get(server, name)?.inputSchema ?? null;
}

/** Locale-independent order, so the catalog is identical on every host. */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Number of tools sent with `deferLoading` (for logging). */
export function countDeferred(tools: ToolSet): number {
  return Object.values(tools).filter((t) => t.providerOptions?.anthropic?.deferLoading === true).length;
}

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

export const SEARCH_TOOL_NAME = "system__search_available_tools";
export const INSPECT_TOOL_NAME = "system__inspect_artifact";

const DEFERRED = { anthropic: { deferLoading: true } } as const;

export function registeredToolNames(sanitize: (name: string) => string): ReadonlySet<string> {
  return new Set([
    SEARCH_TOOL_NAME,
    INSPECT_TOOL_NAME,
    ...toolRegistry.getAll().map((tool) => sanitize(`${tool.server}__${tool.name}`)),
  ]);
}

let lastCatalogHash: string | undefined;

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

function geminiCoreTools(sanitize: (name: string) => string, provider: LLMProviderName): ToolSet {
  const tools: ToolSet = {};
  for (const [key, coreTool] of Object.entries(toolRegistry.toVercelCoreTools(sanitize))) {
    tools[key] = { ...coreTool, execute: createMcpToolExecutor(desanitizeToolName(key, provider)) };
  }
  return tools;
}

function schemaOf(key: string): unknown {
  if (key === SEARCH_TOOL_NAME || key === INSPECT_TOOL_NAME) return null;
  const { server, name } = toolRegistry.parseToolName(key);
  return toolRegistry.get(server, name)?.inputSchema ?? null;
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function countDeferred(tools: ToolSet): number {
  return Object.values(tools).filter((t) => t.providerOptions?.anthropic?.deferLoading === true).length;
}

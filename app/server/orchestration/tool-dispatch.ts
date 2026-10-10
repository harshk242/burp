/**
 * Tool set construction and dispatch of model tool calls.
 *
 * Tools are declared to the model without `execute`; the chat loop runs each
 * call here so it can emit SSE events, activate searched tools, and route large
 * outputs through handleLargeOutput.
 */

import type { Tool, ToolResultPart } from "ai";
import { desanitizeToolName, type LLMProviderName } from "../llm";
import { toolRegistry } from "../mcp/registry";
import { hybridSearch } from "../search";
import { logger, type LogContext } from "../logger";
import { createSearchTool } from "./tools/search-tool";
import { createMcpToolExecutor } from "./tools/mcp-executor";
import { handleLargeOutput } from "./large-output";
import type { StreamEvent, ToolCallRecord } from "./types";

// Non-MCP tools use the "system__" prefix so they pass through parseToolName()
// and the dispatch loop can route them by server === "system".
const SEARCH_TOOL_NAME = "system__search_available_tools";

export type ToolSet = Record<string, Tool>;

export interface DispatchContext {
  sessionId: string;
  provider: LLMProviderName;
  sanitize: (name: string) => string;
  /** Mutated: search activates found tools, large outputs add inspect_artifact. */
  activeTools: ToolSet;
  ctx: LogContext;
}

export interface ToolCallInput {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface DispatchResult {
  /** Absent when a search call fails (it is not recorded in tool_calls). */
  record?: ToolCallRecord;
  part: ToolResultPart;
}

interface ParsedCall {
  tc: ToolCallInput;
  originalName: string;
  server: string;
  name: string;
  input: Record<string, unknown>;
}

export function buildInitialToolSet(
  sanitize: (name: string) => string,
  provider: LLMProviderName,
): ToolSet {
  const coreTools = toolRegistry.toVercelCoreTools(sanitize);

  const withExecutors: ToolSet = {};
  for (const [key, coreTool] of Object.entries(coreTools)) {
    const originalName = desanitizeToolName(key, provider);
    withExecutors[key] = {
      ...coreTool,
      execute: createMcpToolExecutor(originalName),
    };
  }

  withExecutors[SEARCH_TOOL_NAME] = createSearchTool(sanitize);

  return withExecutors;
}

/** Strip execute functions so the SDK never auto-executes tools (double calls). */
export function toDeclarations(activeTools: ToolSet): ToolSet {
  const declarationTools: ToolSet = {};
  for (const [name, t] of Object.entries(activeTools)) {
    const { execute, ...declaration } = t;
    declarationTools[name] = declaration;
  }
  return declarationTools;
}

function makeToolOutput(value: string, isError = false): ToolResultPart["output"] {
  if (isError) {
    return { type: "error-text" as const, value };
  }
  return { type: "text" as const, value };
}

function resultPart(call: ParsedCall, value: string, isError = false): ToolResultPart {
  return {
    type: "tool-result" as const,
    toolCallId: call.tc.toolCallId,
    toolName: call.tc.toolName,
    output: makeToolOutput(value, isError),
  };
}

function errorEnd(call: ParsedCall, errorMsg: string): StreamEvent {
  return {
    type: "tool_end",
    data: { id: call.tc.toolCallId, tool: call.originalName, error: errorMsg },
  };
}

function tryParseJson(str: string): unknown {
  if (str.startsWith("{") || str.startsWith("[")) {
    try { return JSON.parse(str); } catch { /* ignore */ }
  }
  return str;
}

/**
 * Run one tool call: yields tool_start/tool_end SSE events and returns the
 * record for the DB plus the tool-result part for the next model call.
 */
export async function* dispatchToolCall(
  tc: ToolCallInput,
  dc: DispatchContext,
): AsyncGenerator<StreamEvent, DispatchResult> {
  const originalName = desanitizeToolName(tc.toolName, dc.provider);
  const input = tc.input as Record<string, unknown>;

  // All tools use "server__name" format — MCP tools use platform
  // prefix (e.g. "uniprot__"), system tools use "system__" prefix
  const parsed = toolRegistry.parseToolName(originalName);
  const call: ParsedCall = { tc, originalName, server: parsed.server, name: parsed.name, input };

  yield {
    type: "tool_start",
    data: {
      id: tc.toolCallId,
      tool: originalName,
      server: parsed.server,
      toolName: parsed.name,
      input,
    },
  };

  if (parsed.server !== "system") return yield* runMcpTool(call, dc);
  if (originalName === SEARCH_TOOL_NAME) return yield* runSearchTool(call, dc);
  return yield* runSystemTool(call, dc);
}

/** search_available_tools — side effect: activates discovered tools in activeTools. */
async function* runSearchTool(
  call: ParsedCall,
  dc: DispatchContext,
): AsyncGenerator<StreamEvent, DispatchResult> {
  const { activeTools, sanitize } = dc;
  const query = (call.input as { query: string }).query;
  try {
    const searchResults = await hybridSearch.search(query);

    for (const found of searchResults) {
      const sanitized = sanitize(found.fullName);
      if (!activeTools[sanitized]) {
        const vTool = toolRegistry.getVercelTool(found.fullName, sanitize);
        if (vTool) {
          activeTools[vTool.key] = {
            ...vTool.tool,
            execute: createMcpToolExecutor(found.fullName),
          };
        }
      }
    }

    const searchOutput = {
      found: Math.min(searchResults.length, 8),
      tools: searchResults.slice(0, 8).map((r) => ({
        name: sanitize(r.fullName),
        description: r.description,
        relevance_score: r.score,
      })),
      instruction: "Call the tool by its exact name with the required parameters.",
    };

    yield {
      type: "tool_end",
      data: { id: call.tc.toolCallId, tool: call.originalName, output: searchOutput },
    };

    logger.info("TOOL", "search_tool_executed", {
      ctx: dc.ctx,
      data: {
        query,
        results: searchResults.length,
        tools_activated: Object.keys(activeTools).length,
      },
    });

    return {
      record: {
        id: call.tc.toolCallId,
        name: call.originalName,
        server: "system",
        toolName: call.name,
        input: call.input,
        output: searchOutput,
      },
      part: resultPart(call, JSON.stringify(searchOutput)),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    yield errorEnd(call, errorMsg);
    return { part: resultPart(call, errorMsg, true) };
  }
}

/** Generic system tool (e.g. inspect_artifact) — runs the tool's own execute. */
async function* runSystemTool(
  call: ParsedCall,
  dc: DispatchContext,
): AsyncGenerator<StreamEvent, DispatchResult> {
  const record: ToolCallRecord = {
    id: call.tc.toolCallId,
    name: call.originalName,
    server: "system",
    toolName: call.name,
    input: call.input,
  };
  try {
    const localTool = dc.activeTools[call.tc.toolName];
    if (!localTool?.execute) {
      throw new Error(`System tool "${call.originalName}" not found in active tools`);
    }

    const rawResult = await localTool.execute(call.input, {
      toolCallId: call.tc.toolCallId,
      messages: [],
      context: undefined,
    });
    const output = typeof rawResult === "string"
      ? rawResult
      : JSON.stringify(rawResult);

    yield {
      type: "tool_end",
      data: {
        id: call.tc.toolCallId,
        tool: call.originalName,
        output: tryParseJson(output),
        isError: false,
      },
    };

    logger.info("TOOL", "system_tool_executed", {
      ctx: dc.ctx,
      data: { tool: call.originalName, output_chars: output.length },
    });

    return {
      record: { ...record, output: output.length > 2000 ? output.slice(0, 2000) + "..." : output },
      part: resultPart(call, output),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    yield errorEnd(call, errorMsg);
    return { record: { ...record, error: errorMsg }, part: resultPart(call, errorMsg, true) };
  }
}

async function* runMcpTool(
  call: ParsedCall,
  dc: DispatchContext,
): AsyncGenerator<StreamEvent, DispatchResult> {
  const record: ToolCallRecord = {
    id: call.tc.toolCallId,
    name: call.originalName,
    server: call.server,
    toolName: call.name,
    input: call.input,
  };
  try {
    const rawOutput = await createMcpToolExecutor(call.originalName)(call.input);
    const output = await handleLargeOutput(call.originalName, rawOutput, dc.sessionId, dc.activeTools, dc.ctx);

    yield {
      type: "tool_end",
      data: {
        id: call.tc.toolCallId,
        tool: call.originalName,
        output: tryParseJson(rawOutput),
        isError: false,
      },
    };

    return {
      record: { ...record, output: rawOutput.length > 2000 ? output.slice(0, 2000) + "..." : rawOutput },
      part: resultPart(call, output),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    yield errorEnd(call, errorMsg);
    return { record: { ...record, error: errorMsg }, part: resultPart(call, errorMsg, true) };
  }
}

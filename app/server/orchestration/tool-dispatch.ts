/**
 * Dispatch of model tool calls.
 *
 * Tools are declared to the model without `execute` (the set comes from
 * context/tool-catalog.ts); the chat loop runs each call here so it can emit
 * SSE events, run tool search (references on Anthropic, activation on Gemini)
 * and route large outputs through handleLargeOutput.
 */

import type { ToolResultPart } from "ai";
import { desanitizeToolName, type LLMProviderName } from "../llm";
import { toolRegistry } from "../mcp/registry";
import { logger, type LogContext } from "../logger";
import { createMcpToolExecutor } from "./tools/mcp-executor";
import { handleLargeOutput } from "./large-output";
import { runToolSearch } from "./tools/search-tool";
import { SEARCH_TOOL_NAME, type ToolSet } from "./context/tool-catalog";
import type { StreamEvent, ToolCallRecord } from "./types";

export type { ToolSet } from "./context/tool-catalog";

export interface DispatchContext {
  sessionId: string;
  provider: LLMProviderName;
  sanitize: (name: string) => string;
  /** Mutated on Gemini: search activates found tools. On Anthropic every tool is already declared. */
  activeTools: ToolSet;
  ctx: LogContext;
  /** Aborted when the client disconnects; cancels in-flight tool calls. */
  signal?: AbortSignal;
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
  // The client may have gone while tool_start was being written.
  dc.signal?.throwIfAborted();

  if (parsed.server !== "system") return yield* runMcpTool(call, dc);
  if (originalName === SEARCH_TOOL_NAME) return yield* runSearchTool(call, dc);
  return yield* runSystemTool(call, dc);
}

/**
 * search_available_tools. On Anthropic every tool is already declared and the
 * result's tool-reference parts load the found ones; on Gemini the found tools
 * are activated here (exactly the ones shown).
 */
async function* runSearchTool(
  call: ParsedCall,
  dc: DispatchContext,
): AsyncGenerator<StreamEvent, DispatchResult> {
  const { activeTools, sanitize, provider } = dc;
  try {
    // Inside the try: a malformed call can arrive with input === null.
    const query = (call.input as { query: string }).query;
    const declared = provider === "anthropic" ? activeTools : undefined;
    const search = await runToolSearch(query, { provider, sanitize, declared, signal: dc.signal });
    // A result that lands after an abort is dropped (no tools activated).
    dc.signal?.throwIfAborted();

    if (provider !== "anthropic") {
      for (const hit of search.hits) {
        if (activeTools[hit.name]) continue;
        const vTool = toolRegistry.getVercelTool(hit.fullName, sanitize);
        if (vTool) {
          activeTools[vTool.key] = { ...vTool.tool, execute: createMcpToolExecutor(hit.fullName) };
        }
      }
    }

    yield {
      type: "tool_end",
      data: { id: call.tc.toolCallId, tool: call.originalName, output: search.uiSummary },
    };

    logger.info("TOOL", "search_tool_executed", {
      ctx: dc.ctx,
      data: {
        query,
        results: search.hits.length,
        tools: search.hits.map((h) => h.name),
        active_tools: Object.keys(activeTools).length,
      },
    });

    return {
      record: {
        id: call.tc.toolCallId,
        name: call.originalName,
        server: "system",
        toolName: call.name,
        input: call.input,
        output: search.uiSummary,
      },
      part: {
        type: "tool-result" as const,
        toolCallId: call.tc.toolCallId,
        toolName: call.tc.toolName,
        output: search.modelOutput,
      },
    };
  } catch (err) {
    // An aborted turn ends here; don't turn the abort into a tool result.
    if (dc.signal?.aborted) throw err;
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
      abortSignal: dc.signal,
    });
    dc.signal?.throwIfAborted();
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
    // An aborted turn ends here; don't turn the abort into a tool result.
    if (dc.signal?.aborted) throw err;
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
    const rawOutput = await createMcpToolExecutor(call.originalName, dc.signal)(call.input);
    const output = await handleLargeOutput(call.originalName, call.input, rawOutput, dc.sessionId, dc.ctx);

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
    // An aborted turn ends here; don't turn the abort into a tool result.
    if (dc.signal?.aborted) throw err;
    const errorMsg = err instanceof Error ? err.message : String(err);
    yield errorEnd(call, errorMsg);
    return { record: { ...record, error: errorMsg }, part: resultPart(call, errorMsg, true) };
  }
}

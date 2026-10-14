import type { ToolResultPart } from "ai";
import { desanitizeToolName, type LLMProviderName } from "../llm";
import { toolRegistry } from "../mcp/registry";
import { logger, type LogContext } from "../logger";
import { createMcpToolExecutor, executeMcpTool, upstreamTraceMetadata, type McpExecution } from "./tools/mcp-executor";
import { handleLargeOutput } from "./large-output";
import { runToolSearch } from "./tools/search-tool";
import { SEARCH_TOOL_NAME, type ToolSet } from "./context/tool-catalog";
import type { StreamEvent, ToolCallRecord } from "./types";
import type { TurnTrace } from "../observability/turn-trace";

export type { ToolSet } from "./context/tool-catalog";

export interface DispatchContext {
  sessionId: string;
  provider: LLMProviderName;
  sanitize: (name: string) => string;
  activeTools: ToolSet;
  ctx: LogContext;
  signal?: AbortSignal;
  trace?: TurnTrace;
}

export interface ToolCallInput {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface DispatchResult {
  record?: ToolCallRecord;
  part: ToolResultPart;
  traceMetadata?: Record<string, unknown>;
  traceOutput?: unknown;
}

interface ParsedCall {
  tc: ToolCallInput;
  originalName: string;
  server: string;
  name: string;
  input: Record<string, unknown>;
}

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
    try { return JSON.parse(str); } catch { }
  }
  return str;
}

export async function* dispatchToolCall(
  tc: ToolCallInput,
  dc: DispatchContext,
): AsyncGenerator<StreamEvent, DispatchResult> {
  const originalName = desanitizeToolName(tc.toolName, dc.provider);
  const input = tc.input as Record<string, unknown>;

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
  const isSearch = parsed.server === "system" && originalName === SEARCH_TOOL_NAME;
  const span = dc.trace?.tool({
    name: originalName,
    input,
    asType: isSearch ? "retriever" : "tool",
    metadata: { server: parsed.server, tool_call_id: tc.toolCallId },
  });
  dc.signal?.throwIfAborted();

  let result: DispatchResult;
  if (parsed.server !== "system") result = yield* runMcpTool(call, dc);
  else if (isSearch) result = yield* runSearchTool(call, dc);
  else result = yield* runSystemTool(call, dc);
  const part = withFetchedAt(result.part);
  if (span) {
    const { output } = part;
    const seen = output.type === "text" || output.type === "error-text" ? output.value : output;
    const traced = { output: result.traceOutput ?? seen, metadata: { server: parsed.server, ...result.traceMetadata } };
    const raw = result.part.output;
    if (raw.type === "error-text") span.fail(traced, raw.value);
    else span.finish(traced);
  }
  return { record: result.record, part };
}

export function fetchedAtLine(at: Date): string {
  return `[fetched_at: ${at.toISOString().replace(/\.\d{3}Z$/, "Z")}]`;
}

export function withFetchedAt(part: ToolResultPart, at: Date = new Date()): ToolResultPart {
  const { output } = part;
  if (output.type !== "text" && output.type !== "error-text") return part;
  return { ...part, output: { ...output, value: `${fetchedAtLine(at)}\n${output.value}` } };
}

async function* runSearchTool(
  call: ParsedCall,
  dc: DispatchContext,
): AsyncGenerator<StreamEvent, DispatchResult> {
  const { activeTools, sanitize, provider } = dc;
  try {
    const query = (call.input as { query: string }).query;
    const declared = provider === "anthropic" ? activeTools : undefined;
    const search = await runToolSearch(query, { provider, sanitize, declared, signal: dc.signal });
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
      traceOutput: search.hits.map((h) => h.name),
    };
  } catch (err) {
    if (dc.signal?.aborted) throw err;
    const errorMsg = err instanceof Error ? err.message : String(err);
    yield errorEnd(call, errorMsg);
    return { part: resultPart(call, errorMsg, true) };
  }
}

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
      traceMetadata: { raw_chars: output.length },
    };
  } catch (err) {
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
  let execution: McpExecution | undefined;
  try {
    execution = await executeMcpTool(call.originalName, call.input, dc.signal);
    const upstream = upstreamTraceMetadata(execution.meta);
    if (execution.isError) {
      const errorMsg = execution.text;
      yield errorEnd(call, errorMsg);
      return { record: { ...record, error: errorMsg }, part: resultPart(call, errorMsg, true), traceMetadata: upstream };
    }
    const rawOutput = execution.text;
    const large = await handleLargeOutput(call.originalName, call.input, rawOutput, dc.sessionId, dc.ctx);
    const output = large.output;

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
      traceMetadata: {
        raw_chars: large.rawChars,
        output_handling: large.handling,
        stored_as_artifact: large.handling === "artifact",
        artifact_id: large.artifactId,
        ...upstream,
      },
    };
  } catch (err) {
    if (dc.signal?.aborted) throw err;
    const errorMsg = err instanceof Error ? err.message : String(err);
    yield errorEnd(call, errorMsg);
    return {
      record: { ...record, error: errorMsg },
      part: resultPart(call, errorMsg, true),
      traceMetadata: upstreamTraceMetadata(execution?.meta),
    };
  }
}

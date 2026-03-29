/**
 * Chat Orchestration v2 — Model-Agnostic via Vercel AI SDK
 *
 * Replaces the Anthropic-coupled chat.ts with a provider-agnostic
 * implementation using streamText/generateText. Supports Anthropic
 * and Google as providers. Uses hybrid search instead of
 * Claude's built-in tool_search_tool_bm25.
 */

import {
  streamText,
  generateText,
  type ModelMessage,
  type Tool,
  type ToolResultPart,
} from "ai";
import { v4 as uuidv4 } from "uuid";
import {
  getChatModel,
  getTitleModel,
  getSummarizerModel,
  loadLLMConfig,
  sanitizeToolName,
  desanitizeToolName,
} from "../llm";
import { toolRegistry } from "../mcp/registry";
import { hybridSearch } from "../search";
import { createSearchTool } from "./tools/search-tool";
import { createMcpToolExecutor } from "./tools/mcp-executor";
import { messageQueries, chatSessionQueries, userQueries } from "../db";
import { logger, startTimer, estimateTokens, type LogContext } from "../logger";

const llmConfig = loadLLMConfig();

const SEARCH_TOOL_NAME = "search_available_tools";

const SYSTEM_PROMPT = `You are a biomedical research assistant with access to 10 specialized databases:

1. **UniProt** - Protein sequences, structures, and annotations
2. **ChEMBL** - Drug compounds, bioactivity, and pharmacology data
3. **PubChem** - Chemical structures, properties, and bioassays
4. **Ensembl** - Genomic sequences, gene annotations, and variants
5. **ClinVar** - Clinical significance of genetic variants
6. **Open Targets** - Drug-target associations and disease evidence
7. **Reactome** - Biological pathways and reactions
8. **ClinicalTrials** - Clinical trial registrations and results
9. **PubMed** - Biomedical literature and abstracts
10. **ClinPGx (PharmGKB)** - Pharmacogenomics data

## Available Tools

You have 210+ specialized tools available, organized in two tiers:

### Always-Available Core Tools (use directly without searching):
- **ensembl__search_genes** - Convert gene symbols (TP53, BRCA1) → Ensembl IDs (ENSG...)
- **open-targets__search_entities** - Find genes/diseases → ENSG/EFO IDs (main hub)
- **uniprot__search_by_gene** - Gene symbol → UniProt accession (protein ID)
- **uniprot__get_external_references** - UniProt → Ensembl/PDB cross-references
- **ensembl__get_xrefs** - Ensembl → UniProt/HGNC cross-references
- **chembl__search_compounds** - Drug/compound name → ChEMBL ID
- **pubchem__search_by_smiles** - SMILES structure → PubChem CID
- **clinvar__lookup_by_rsid** - rsID → clinical significance and gene
- **pubmed__search_pubmed** - Quick literature search → PMIDs
- **clinicaltrials__search_by_intervention** - Drug → clinical trials (NCT IDs)
- **clinicaltrials__search_by_condition** - Condition → clinical trials (NCT IDs)

### Additional Specialized Tools (use search_available_tools to discover):
For specialized queries (protein structure, pathway analysis, bioactivity data, etc.),
use the search_available_tools tool to find relevant tools by describing what you need.

## Workflow Guidelines

1. **Start with core tools** for ID resolution and initial discovery
2. **Use search_available_tools** when you need specialized analysis not covered by core tools
3. **Cross-reference multiple databases** - use IDs from one database to query others
4. **Cite specific identifiers** (UniProt IDs, ChEMBL IDs, PMIDs, ENSG IDs, etc.)
5. **Explain your findings** in clear, scientific language

## Common ID Resolution Patterns

- Gene symbol → ENSG: Use ensembl__search_genes("TP53")
- Gene → Protein: Use uniprot__search_by_gene("TP53")
- Drug name → ChEMBL: Use chembl__search_compounds("imatinib")
- rsID → Gene: Use clinvar__lookup_by_rsid("rs1042522")

Always prefer using tools over your training knowledge for biomedical facts.`;

// ── Types ──────────────────────────────────────────────────────────────────

export interface StreamEvent {
  type: "start" | "text" | "tool_start" | "tool_end" | "done" | "error";
  data: unknown;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  server: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
}

interface DBMessage {
  id: string;
  chat_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null;
  created_at: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function maybeCompressOutput(
  toolName: string,
  rawOutput: string,
  userQuery: string,
  ctx: LogContext
): Promise<string> {
  if (rawOutput.length <= llmConfig.toolOutputSummaryThreshold) return rawOutput;

  const elapsed = startTimer();
  logger.info("TOOL", "summarize_start", {
    ctx,
    data: {
      tool: toolName,
      raw_chars: rawOutput.length,
      raw_tokens_est: estimateTokens(rawOutput),
    },
  });

  try {
    const { text, usage } = await generateText({
      model: getSummarizerModel(),
      maxOutputTokens: 4096,
      system: `You are a biomedical data extraction assistant. Your job is to compress large tool outputs into concise summaries that preserve all essential information.

Rules:
- PRESERVE ALL identifiers exactly: ChEMBL IDs, UniProt accessions, ENSG IDs, PMIDs, CIDs, NCT IDs, rsIDs, SMILES strings, InChI keys, gene symbols, drug names
- PRESERVE all numerical data: IC50 values, Ki values, p-values, scores, molecular weights, coordinates
- REMOVE redundant or repetitive entries — if 50 compounds are returned, summarize the top/most relevant ones (up to 10) and note how many total were returned
- REMOVE verbose metadata, boilerplate fields, and empty/null fields
- Output valid JSON when the input is JSON, otherwise use concise structured text
- Be thorough — the main assistant will rely ONLY on your summary to answer the user's question`,
      prompt: `The user's research question: "${userQuery}"

The tool "${toolName}" returned ${rawOutput.length.toLocaleString()} characters of data. Extract the relevant information:

${rawOutput}`,
    });

    const prefix = `[Summarized from ${(rawOutput.length / 1024).toFixed(0)} KB tool output — ${usage?.inputTokens ?? "?"} tokens compressed to ${usage?.outputTokens ?? "?"} tokens. Query specific tool with exact IDs for full details.]\n`;

    logger.info("TOOL", "summarize_complete", {
      ctx,
      duration_ms: elapsed(),
      data: {
        tool: toolName,
        raw_chars: rawOutput.length,
        summary_chars: text.length,
        compression_ratio: (rawOutput.length / text.length).toFixed(1),
      },
    });

    return prefix + text;
  } catch (error) {
    logger.error("TOOL", "summarize_failed", {
      ctx,
      duration_ms: elapsed(),
      data: { tool: toolName },
      error: error instanceof Error ? error : String(error),
    });
    const truncated = rawOutput.slice(0, llmConfig.toolOutputSummaryThreshold);
    return `[Summarization failed — output truncated from ${(rawOutput.length / 1024).toFixed(0)} KB to ${(llmConfig.toolOutputSummaryThreshold / 1024).toFixed(0)} KB]\n${truncated}`;
  }
}

function buildMessages(history: DBMessage[], newMessage: string): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const msg of history) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content || "" });
    } else if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.content || "" });
    }
  }
  messages.push({ role: "user", content: newMessage });
  return messages;
}

type ToolSet = Record<string, Tool>;

function buildInitialToolSet(
  sanitize: (name: string) => string
): ToolSet {
  const coreTools = toolRegistry.toVercelCoreTools(sanitize);

  const withExecutors: ToolSet = {};
  for (const [key, coreTool] of Object.entries(coreTools)) {
    const originalName = desanitizeToolName(key, llmConfig.provider);
    withExecutors[key] = {
      ...coreTool,
      execute: createMcpToolExecutor(originalName),
    };
  }

  withExecutors[SEARCH_TOOL_NAME] = createSearchTool(sanitize);

  return withExecutors;
}

function makeToolOutput(value: string, isError = false): ToolResultPart["output"] {
  if (isError) {
    return { type: "error-text" as const, value };
  }
  return { type: "text" as const, value };
}

function tryParseJson(str: string): unknown {
  if (str.startsWith("{") || str.startsWith("[")) {
    try { return JSON.parse(str); } catch { /* ignore */ }
  }
  return str;
}

// ── Main Chat Loop ─────────────────────────────────────────────────────────

export async function* processChat(
  sessionId: string,
  userId: string,
  userMessage: string
): AsyncGenerator<StreamEvent> {
  const chatElapsed = startTimer();
  const ctx: LogContext = { session_id: sessionId, user_id: userId };
  const sanitize = (name: string) => sanitizeToolName(name, llmConfig.provider);

  logger.info("CHAT", "process_start", {
    ctx,
    data: {
      provider: llmConfig.provider,
      model: llmConfig.chatModel,
      message_length: userMessage.length,
      message_preview: userMessage.slice(0, 150),
    },
  });

  try {
    // Session check
    let session = chatSessionQueries.findById(sessionId) as { id: string; user_id: string } | null;
    if (session) {
      if (session.user_id !== userId) {
        logger.warn("CHAT", "session_unauthorized", { ctx, data: { session_owner: session.user_id } });
        yield { type: "error", data: { error: "Unauthorized: session belongs to another user" } };
        return;
      }
    } else {
      chatSessionQueries.create(sessionId, userId, null);
      session = { id: sessionId, user_id: userId };
      logger.info("CHAT", "session_created", { ctx });
    }

    yield { type: "start", data: { sessionId } };

    // History + messages
    const history = messageQueries.findByChatId(sessionId) as DBMessage[];
    const messages = buildMessages(history, userMessage);

    // Store user message
    const userMsgId = uuidv4();
    messageQueries.create(userMsgId, sessionId, "user", userMessage, null);

    // Build tool set
    let activeTools = buildInitialToolSet(sanitize);
    const coreToolCount = Object.keys(activeTools).length - 1; // exclude search_available_tools

    if (coreToolCount === 0) {
      logger.error("CHAT", "no_tools_available", { ctx });
      yield { type: "error", data: { error: "No MCP tools available. All database servers may be down." } };
      return;
    }

    logger.info("CHAT", "tools_loaded", {
      ctx,
      data: {
        core_tools: coreToolCount,
        total_tools: Object.keys(activeTools).length,
        provider: llmConfig.provider,
      },
    });

    let continueLoop = true;
    let fullAssistantContent = "";
    const allToolCalls: ToolCallRecord[] = [];
    let loopIteration = 0;

    while (continueLoop) {
      loopIteration++;
      const iterElapsed = startTimer();

      logger.info("CHAT", "llm_request_start", {
        ctx,
        data: {
          iteration: loopIteration,
          model: llmConfig.chatModel,
          message_count: messages.length,
          active_tools: Object.keys(activeTools).length,
        },
      });

      // Strip execute functions — we handle execution manually for
      // SSE events, search activation, and output compression.
      // Also prevents the SDK from auto-executing tools (double calls).
      const declarationTools: Record<string, Tool> = {};
      for (const [name, t] of Object.entries(activeTools)) {
        const { execute, ...declaration } = t;
        declarationTools[name] = declaration;
      }

      const result = streamText({
        model: getChatModel(),
        system: SYSTEM_PROMPT,
        messages,
        tools: declarationTools,
        maxRetries: llmConfig.maxRetries,
      });

      // Stream text chunks
      for await (const chunk of result.textStream) {
        fullAssistantContent += chunk;
        yield { type: "text", data: chunk };
      }

      // Await the promise-based properties
      const finishReason = await result.finishReason;
      const toolCalls = await result.toolCalls;
      const usage = await result.usage;
      const iterDuration = iterElapsed();

      logger.info("CHAT", "llm_response_received", {
        ctx,
        duration_ms: iterDuration,
        data: {
          iteration: loopIteration,
          finish_reason: finishReason,
          input_tokens: usage?.inputTokens,
          output_tokens: usage?.outputTokens,
          tool_calls: toolCalls?.length ?? 0,
        },
      });

      if (finishReason === "tool-calls" && toolCalls && toolCalls.length > 0) {
        // Reset text for next iteration (already streamed via SSE)
        fullAssistantContent = "";

        const toolResultParts: ToolResultPart[] = [];

        for (const tc of toolCalls) {
          const originalName = desanitizeToolName(tc.toolName, llmConfig.provider);

          const tcInput = tc.input as Record<string, unknown>;

          const parsed = originalName.includes("__")
            ? toolRegistry.parseToolName(originalName)
            : { server: "", name: originalName };

          yield {
            type: "tool_start",
            data: {
              id: tc.toolCallId,
              tool: originalName,
              server: parsed.server,
              toolName: parsed.name,
              input: tcInput,
            },
          };

          if (tc.toolName === SEARCH_TOOL_NAME) {
            try {
              const searchResults = await hybridSearch.search((tcInput as { query: string }).query);

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

              allToolCalls.push({
                id: tc.toolCallId,
                name: originalName,
                server: "",
                toolName: SEARCH_TOOL_NAME,
                input: tcInput,
                output: searchOutput,
              });

              toolResultParts.push({
                type: "tool-result" as const,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: makeToolOutput(JSON.stringify(searchOutput)),
              });

              yield {
                type: "tool_end",
                data: { id: tc.toolCallId, tool: SEARCH_TOOL_NAME, output: searchOutput },
              };

              logger.info("TOOL", "search_tool_executed", {
                ctx,
                data: {
                  query: (tcInput as { query: string }).query,
                  results: searchResults.length,
                  tools_activated: Object.keys(activeTools).length,
                },
              });
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              toolResultParts.push({
                type: "tool-result" as const,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: makeToolOutput(errorMsg, true),
              });
              yield {
                type: "tool_end",
                data: { id: tc.toolCallId, tool: SEARCH_TOOL_NAME, error: errorMsg },
              };
            }
          } else {
            // Regular MCP tool execution
            try {
              let output = await createMcpToolExecutor(originalName)(tcInput);
              const rawOutput = output;
              output = await maybeCompressOutput(originalName, output, userMessage, ctx);

              allToolCalls.push({
                id: tc.toolCallId,
                name: originalName,
                server: parsed.server,
                toolName: parsed.name,
                input: tcInput,
                output: rawOutput.length > 2000 ? output.slice(0, 2000) + "..." : rawOutput,
              });

              toolResultParts.push({
                type: "tool-result" as const,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: makeToolOutput(output),
              });

              yield {
                type: "tool_end",
                data: {
                  id: tc.toolCallId,
                  tool: originalName,
                  output: tryParseJson(rawOutput),
                  isError: false,
                },
              };
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              allToolCalls.push({
                id: tc.toolCallId,
                name: originalName,
                server: parsed.server,
                toolName: parsed.name,
                input: tcInput,
                error: errorMsg,
              });

              toolResultParts.push({
                type: "tool-result" as const,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: makeToolOutput(errorMsg, true),
              });

              yield {
                type: "tool_end",
                data: { id: tc.toolCallId, tool: originalName, error: errorMsg },
              };
            }
          }
        }

        // Use SDK response messages for assistant turn — preserves
        // provider metadata (Gemini 3 thought signatures) that the model
        // requires on subsequent turns.
        const { messages: responseMessages } = await result.response;
        messages.push(...responseMessages);

        // Append our manually constructed tool results
        messages.push({ role: "tool", content: toolResultParts });
      } else {
        continueLoop = false;
      }
    }

    // Store assistant message
    const assistantMsgId = uuidv4();
    messageQueries.create(
      assistantMsgId,
      sessionId,
      "assistant",
      fullAssistantContent,
      allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : null
    );

    chatSessionQueries.touch(sessionId);
    userQueries.incrementQueries(userId);

    logger.info("CHAT", "process_complete", {
      ctx,
      duration_ms: chatElapsed(),
      data: {
        provider: llmConfig.provider,
        model: llmConfig.chatModel,
        iterations: loopIteration,
        tool_calls_total: allToolCalls.length,
        tool_calls_failed: allToolCalls.filter((t) => t.error).length,
        response_length: fullAssistantContent.length,
        message_id: assistantMsgId,
      },
    });

    yield { type: "done", data: { messageId: assistantMsgId } };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("CHAT", "process_failed", {
      ctx,
      duration_ms: chatElapsed(),
      error: error instanceof Error ? error : errorMsg,
    });
    yield { type: "error", data: { error: errorMsg } };
  }
}

// ── Title Generation ───────────────────────────────────────────────────────

export async function generateSessionTitle(
  sessionId: string,
  firstMessage: string
): Promise<string> {
  const fallbackTitle = buildFallbackTitle(firstMessage);
  const elapsed = startTimer();
  const ctx: LogContext = { session_id: sessionId };

  logger.info("TITLE", "generation_start", {
    ctx,
    data: { model: llmConfig.titleModel, provider: llmConfig.provider },
  });

  try {
    const { text } = await generateText({
      model: getTitleModel(),
      maxOutputTokens: 50,
      prompt: `Generate a short chat title (3-6 words) from this user question:
"${firstMessage.substring(0, 300)}"

Return only the title text.`,
      abortSignal: AbortSignal.timeout(5000),
    });

    const title = normalizeTitle(text, fallbackTitle);
    chatSessionQueries.updateTitle(sessionId, title);

    logger.info("TITLE", "generation_complete", {
      ctx,
      duration_ms: elapsed(),
      data: { title },
    });

    return title;
  } catch (error) {
    logger.error("TITLE", "generation_failed", {
      ctx,
      duration_ms: elapsed(),
      error: error instanceof Error ? error : String(error),
      data: { fallback_title: fallbackTitle },
    });
    chatSessionQueries.updateTitle(sessionId, fallbackTitle);
    return fallbackTitle;
  }
}

function normalizeTitle(rawTitle: string, fallback: string): string {
  const normalized = rawTitle
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!normalized) return fallback;
  return normalized.length > 80 ? normalized.slice(0, 80).trimEnd() : normalized;
}

function buildFallbackTitle(firstMessage: string): string {
  const cleaned = firstMessage
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!cleaned) return "New Chat";
  const words = cleaned.split(" ").slice(0, 6);
  const title = words.join(" ");
  return title.length > 80 ? title.slice(0, 80).trimEnd() : title;
}

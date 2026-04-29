/**
 * Chat Orchestration v2 — Model-Agnostic via Vercel AI SDK
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
  loadLLMConfig,
  sanitizeToolName,
  desanitizeToolName,
} from "../llm";
import { toolRegistry } from "../mcp/registry";
import { hybridSearch } from "../search";
import { createSearchTool } from "./tools/search-tool";
import { createMcpToolExecutor } from "./tools/mcp-executor";
import { db, messageQueries, chatSessionQueries, userQueries, dailyUsageQueries, usageEventQueries } from "../db";
import { logger, startTimer, estimateTokens, type LogContext } from "../logger";
import { appConfig } from "../config";
import { artifactStore } from "./tools/artifact-store";
import { applyNoiseReduction } from "./tools/noise-reduction";
import { generatePreview } from "./tools/schema-preview";
import { createInspectArtifactTool } from "./tools/artifact-inspector";
import { validatePolicies } from "./tools/policy-resolver";
import { calculateChatCost, getUtcDate, getUtcMonth } from "../usage";

const llmConfig = loadLLMConfig();

// Non-MCP tools use the "system__" prefix so they pass through parseToolName()
// and the dispatch loop can route them by server === "system".
const SEARCH_TOOL_NAME = "system__search_available_tools";

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

### Additional Specialized Tools (use system__search_available_tools to discover):
For specialized queries (protein structure, pathway analysis, bioactivity data, etc.),
use the system__search_available_tools tool to find relevant tools by describing what you need.

## Workflow Guidelines

1. **Start with core tools** for ID resolution and initial discovery
2. **Use system__search_available_tools** when you need specialized analysis not covered by core tools
3. **Cross-reference multiple databases** - use IDs from one database to query others
4. **Cite specific identifiers** (UniProt IDs, ChEMBL IDs, PMIDs, ENSG IDs, etc.)
5. **Explain your findings** in clear, scientific language

## Response Formatting

- **Before calling tools**: You may include brief reasoning about your strategy (this is shown to the user as collapsible "Reasoning" text).
- **In your final answer (after all tool calls are done)**: Start directly with the substantive response — the actual data, analysis, or table the user asked for. Do NOT begin with transitional or meta-commentary such as "Excellent! Now let me compile…", "Based on the results, here is…", "I have gathered the data. Let me present…", etc. Jump straight into the answer content itself (e.g. a heading, a table, or the first finding).
- **Markdown only**: Always format your final response in well-structured markdown. Use headings, tables, bullet lists, and bold/italic for readability.
- **Audience**: Your users are biomedical researchers. Keep responses structured, scannable, and easy to read. Prefer tables for comparative data and bullet lists for summaries.
- **Evidence only**: Do NOT provide recommendations, rankings, or clinical interpretation. Present evidence and data summaries objectively; leave decisions to the researcher.
- **Hyperlinks**: Include hyperlinks to source records for PubMed articles and clinical trials. Examples:
  - PubMed articles: \`[PMID:12345678](https://pubmed.ncbi.nlm.nih.gov/12345678/)\`
  - ClinicalTrials: \`[NCT01234567](https://clinicaltrials.gov/study/NCT01234567)\`
- **PubMed citations**: When citing PubMed articles, include the publication year and number of citations (e.g. "Smith et al. (2019) — 342 citations").
- **Follow-up questions**: Ask only when essential for clarification; keep them to a minimum.

## Common ID Resolution Patterns

- Gene symbol → ENSG: Use ensembl__search_genes("TP53")
- Gene → Protein: Use uniprot__search_by_gene("TP53")
- Drug name → ChEMBL: Use chembl__search_compounds("imatinib")
- rsID → Gene: Use clinvar__lookup_by_rsid("rs1042522")

Always use tools over your training knowledge for biomedical facts.`;

// ── Types ──────────────────────────────────────────────────────────────────

export interface StreamEvent {
  type: "start" | "text" | "tool_start" | "tool_end" | "text_block_end" | "done" | "usage" | "error";
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

const INSPECT_TOOL_KEY = "system__inspect_artifact";

/**
 * ── Layer 3 of 3: Noise reduce, then artifact if still big (15K) ──
 *
 *   MCP server  (5MB)  → prevent process death / stdio pressure
 *   App manager (1MB)  → prevent LLM context blow-up
 *   handleLargeOutput (15K) → noise reduce, then artifact if still big  ← YOU ARE HERE
 *
 * Two-tier jq pipeline:
 *   Tier 1 — deterministic noise reduction (jq filters per platform/tool)
 *   Tier 2 — artifact storage + schema preview + inspect_artifact tool
 *
 * No silent truncation of JSON at any point. Data is either:
 *   - passed through (small enough)
 *   - noise-reduced and passed through (reduced below threshold)
 *   - stored as artifact with a schema preview (LLM writes jq to inspect)
 *
 * Replaces the old LLM-based maybeCompressOutput summarizer.
 */
async function handleLargeOutput(
  toolName: string,
  rawOutput: string,
  sessionId: string,
  activeTools: Record<string, Tool>,
  ctx: LogContext,
): Promise<string> {
  const cfg = appConfig.artifact;

  // Small output: pass through unchanged
  if (rawOutput.length <= cfg.inline_max_chars) return rawOutput;

  // Try to parse as JSON — non-JSON gets simple truncation
  // TODO: This truncation breaks structure for non-JSON text. Acceptable for
  // now since virtually all MCP tool outputs are JSON. Revisit if we add
  // tools that return large non-JSON payloads (FASTA, plain text, etc.).
  let data: unknown;
  try {
    data = JSON.parse(rawOutput);
  } catch {
    return (
      `[Output truncated from ${(rawOutput.length / 1024).toFixed(0)}KB — not valid JSON]\n` +
      rawOutput.slice(0, cfg.inline_max_chars)
    );
  }

  // Tier 1: Noise reduction (deterministic, no LLM)
  const elapsed = startTimer();
  const { data: reduced, filtersApplied, filtersSkipped } = await applyNoiseReduction(toolName, data);
  const reducedStr = JSON.stringify(reduced);

  logger.info("TOOL", "noise_reduction_applied", {
    ctx,
    duration_ms: elapsed(),
    data: {
      tool: toolName,
      raw_chars: rawOutput.length,
      reduced_chars: reducedStr.length,
      filters_applied: filtersApplied,
      filters_skipped: filtersSkipped,
      reduction_pct: ((1 - reducedStr.length / rawOutput.length) * 100).toFixed(1),
    },
  });

  // Under threshold after noise reduction: return directly
  if (reducedStr.length <= cfg.inline_max_chars) return reducedStr;

  // Tier 2: Store as artifact, return schema preview
  const artifactId = artifactStore.store(
    sessionId,
    toolName,
    reduced,
    rawOutput.length,
  );
  const preview = generatePreview(
    artifactId,
    toolName,
    reduced,
    rawOutput.length / 1024,
    reducedStr.length / 1024,
  );

  // Dynamically add inspect_artifact tool (session-bound)
  if (!activeTools[INSPECT_TOOL_KEY]) {
    activeTools[INSPECT_TOOL_KEY] = createInspectArtifactTool(sessionId);
  }

  logger.info("TOOL", "artifact_stored", {
    ctx,
    data: {
      artifact_id: artifactId,
      tool: toolName,
      raw_kb: (rawOutput.length / 1024).toFixed(1),
      stored_kb: (reducedStr.length / 1024).toFixed(1),
      session_artifact_count: artifactStore.getSessionCount(sessionId),
    },
  });

  return JSON.stringify(preview);
}

// Validate artifact policies on module load (non-blocking)
validatePolicies().then(({ valid, errors }) => {
  if (!valid) {
    logger.warn("STARTUP", "artifact_policy_validation_warnings", {
      data: { error_count: errors.length, errors },
    });
  }
});

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
    let persistedAssistantText = ""; // final response text only (last iteration)
    let reasoningText = "";           // pre-tool-call reasoning text (all non-final iterations)
    const allToolCalls: ToolCallRecord[] = [];
    let loopIteration = 0;
    // Token accumulators — summed across all tool-call iterations
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (continueLoop) {
      loopIteration++;
      if (loopIteration > llmConfig.maxToolIterations) {
        throw new Error(`Maximum tool iterations exceeded (${llmConfig.maxToolIterations})`);
      }
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
        maxOutputTokens: llmConfig.maxOutputTokens,
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

      // Accumulate token counts across all tool-call iterations
      totalInputTokens += usage?.inputTokens ?? 0;
      totalOutputTokens += usage?.outputTokens ?? 0;

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
        // This iteration's text is reasoning (pre-tool-call).
        // Signal the client to reclassify it, then accumulate into reasoningText.
        if (fullAssistantContent) {
          yield { type: "text_block_end", data: { isReasoning: true } };
          reasoningText += (reasoningText ? "\n\n" : "") + fullAssistantContent;
        }
        // Reset text for next iteration (already streamed via SSE)
        fullAssistantContent = "";

        const toolResultParts: ToolResultPart[] = [];

        for (const tc of toolCalls) {
          const originalName = desanitizeToolName(tc.toolName, llmConfig.provider);

          const tcInput = tc.input as Record<string, unknown>;

          // All tools use "server__name" format — MCP tools use platform
          // prefix (e.g. "uniprot__"), system tools use "system__" prefix
          const parsed = toolRegistry.parseToolName(originalName);

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

          if (parsed.server === "system") {
            // ── System tools (non-MCP, local execution) ─────────────────
            if (originalName === SEARCH_TOOL_NAME) {
              // search_available_tools — special handling: side-effects
              // (activates discovered tools in activeTools)
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
                  server: "system",
                  toolName: parsed.name,
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
                  data: { id: tc.toolCallId, tool: originalName, output: searchOutput },
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
                  data: { id: tc.toolCallId, tool: originalName, error: errorMsg },
                };
              }
            } else {
              // Generic system tool (e.g. inspect_artifact) — execute via
              // the tool's own execute function from activeTools
              try {
                const localTool = activeTools[tc.toolName];
                if (!localTool?.execute) {
                  throw new Error(`System tool "${originalName}" not found in active tools`);
                }

                const rawResult = await localTool.execute(tcInput, {
                  toolCallId: tc.toolCallId,
                  messages: [],
                  abortSignal: undefined as unknown as AbortSignal,
                });
                const output = typeof rawResult === "string"
                  ? rawResult
                  : JSON.stringify(rawResult);

                allToolCalls.push({
                  id: tc.toolCallId,
                  name: originalName,
                  server: "system",
                  toolName: parsed.name,
                  input: tcInput,
                  output: output.length > 2000 ? output.slice(0, 2000) + "..." : output,
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
                    output: tryParseJson(output),
                    isError: false,
                  },
                };

                logger.info("TOOL", "system_tool_executed", {
                  ctx,
                  data: { tool: originalName, output_chars: output.length },
                });
              } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                allToolCalls.push({
                  id: tc.toolCallId,
                  name: originalName,
                  server: "system",
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
          } else {
            // ── MCP tool execution ──────────────────────────────────────
            try {
              let output = await createMcpToolExecutor(originalName)(tcInput);
              const rawOutput = output;
              output = await handleLargeOutput(originalName, output, sessionId, activeTools, ctx);

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
        // SDK response messages may include tool-result messages. We execute
        // tools manually for SSE/control, so only keep assistant metadata here.
        messages.push(...responseMessages.filter((msg) => msg.role !== "tool"));

        // Append our manually constructed tool results
        messages.push({ role: "tool", content: toolResultParts });
      } else {
        // Final iteration — this text is the actual response.
        if (fullAssistantContent) {
          persistedAssistantText = fullAssistantContent;
        }
        continueLoop = false;
      }
    }

    const chatCost = calculateChatCost({
      provider: llmConfig.provider,
      model: llmConfig.chatModel,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    });

    const assistantMsgId = uuidv4();
    const usageEventId = uuidv4();
    const usageDate = getUtcDate();
    const usageMonth = getUtcMonth();

    db.transaction(() => {
      // Store assistant message with accumulated token counts, cost, and reasoning.
      messageQueries.create(
        assistantMsgId,
        sessionId,
        "assistant",
        persistedAssistantText,
        allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : null,
        totalInputTokens,
        totalOutputTokens,
        reasoningText || null,
        chatCost.costMicrousd
      );

      usageEventQueries.create({
        id: usageEventId,
        user_id: userId,
        date: usageDate,
        month: usageMonth,
        operation: "chat",
        provider: chatCost.provider,
        model: chatCost.model,
        input_tokens: chatCost.inputTokens,
        output_tokens: chatCost.outputTokens,
        input_cost_per_mtok_microusd: chatCost.inputCostPerMtokMicrousd,
        output_cost_per_mtok_microusd: chatCost.outputCostPerMtokMicrousd,
        cost_microusd: chatCost.costMicrousd,
        session_id: sessionId,
        message_id: assistantMsgId,
      });

      chatSessionQueries.touch(sessionId);
      userQueries.incrementQueries(userId);
      // Increment daily token totals (best-effort: done post-response; next request checks these)
      dailyUsageQueries.incrementTokens(userId, totalInputTokens, totalOutputTokens);
    })();

    logger.info("CHAT", "process_complete", {
      ctx,
      duration_ms: chatElapsed(),
      data: {
        provider: llmConfig.provider,
        model: llmConfig.chatModel,
        iterations: loopIteration,
        tool_calls_total: allToolCalls.length,
        tool_calls_failed: allToolCalls.filter((t) => t.error).length,
        response_length: persistedAssistantText.length,
        message_id: assistantMsgId,
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        cost_microusd: chatCost.costMicrousd,
      },
    });

    // done arrives first so finalizeAssistantMessage() commits the message to
    // state.messages before the frontend's setLastMessageTokens runs.
    yield { type: "done", data: { messageId: assistantMsgId } };
    // usage arrives after done — safe to patch tokenUsage onto the last message
    yield { type: "usage", data: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } };
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

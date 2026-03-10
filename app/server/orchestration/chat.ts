/**
 * Chat Orchestration
 * Handles the LLM tool-calling loop for chat interactions
 */

import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { mcpManager } from "../mcp/manager";
import { toolRegistry } from "../mcp/registry";
import { messageQueries, chatSessionQueries, userQueries } from "../db";
import { logger, startTimer, estimateTokens, type LogContext } from "../logger";

// Initialize Anthropic client
const anthropic = new Anthropic();

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const TITLE_MODEL = process.env.CLAUDE_TITLE_MODEL || "claude-haiku-4-5";

// Tool search tool definition (built-in, BM25 variant for natural language)
const TOOL_SEARCH_TOOL = {
  type: "tool_search_tool_bm25_20251119" as const,
  // Anthropic currently requires this exact tool name literal for BM25 search.
  name: "tool_search_tool_bm25",
};

// System prompt for biomedical research assistant
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

### Additional Specialized Tools (use tool_search_tool_bm25 to discover):
For specialized queries (protein structure, pathway analysis, bioactivity data, etc.),
use the tool_search_tool_bm25 tool to find relevant tools by describing what you need.

## Workflow Guidelines

1. **Start with core tools** for ID resolution and initial discovery
2. **Use tool_search_tool_bm25** when you need specialized analysis not covered by core tools
3. **Cross-reference multiple databases** - use IDs from one database to query others
4. **Cite specific identifiers** (UniProt IDs, ChEMBL IDs, PMIDs, ENSG IDs, etc.)
5. **Explain your findings** in clear, scientific language

## Common ID Resolution Patterns

- Gene symbol → ENSG: Use ensembl__search_genes("TP53")
- Gene → Protein: Use uniprot__search_by_gene("TP53")
- Drug name → ChEMBL: Use chembl__search_compounds("imatinib")
- rsID → Gene: Use clinvar__lookup_by_rsid("rs1042522")

Always prefer using tools over your training knowledge for biomedical facts.`;

// Types
export interface StreamEvent {
  type: "start" | "text" | "tool_start" | "tool_end" | "done" | "error";
  data: unknown;
}

export interface ToolCall {
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

/**
 * Process a chat message through Claude with tool calling
 * Yields SSE events for streaming
 */
export async function* processChat(
  sessionId: string,
  userId: string,
  userMessage: string
): AsyncGenerator<StreamEvent> {
  const chatElapsed = startTimer();
  const ctx: LogContext = { session_id: sessionId, user_id: userId };

  logger.info("CHAT", "process_start", {
    ctx,
    data: { message_length: userMessage.length, message_preview: userMessage.slice(0, 150) },
  });

  try {
    // Check if session exists and belongs to the current user
    let session = chatSessionQueries.findById(sessionId) as { id: string; user_id: string } | null;
    if (session) {
      if (session.user_id !== userId) {
        logger.warn("CHAT", "session_unauthorized", { ctx, data: { session_owner: session.user_id } });
        yield { type: "error", data: { error: "Unauthorized: session belongs to another user" } };
        return;
      }
      logger.debug("CHAT", "session_found", { ctx });
    } else {
      chatSessionQueries.create(sessionId, userId, null);
      session = { id: sessionId, user_id: userId };
      logger.info("CHAT", "session_created", { ctx });
    }

    yield { type: "start", data: { sessionId } };

    // Load conversation history
    const history = messageQueries.findByChatId(sessionId) as DBMessage[];
    logger.debug("CHAT", "history_loaded", { ctx, data: { message_count: history.length } });

    // Build messages array for Claude
    const messages = buildClaudeMessages(history, userMessage);

    // Get MCP tools in Claude format
    const mcpTools = toolRegistry.toClaudeFormat(true);

    if (mcpTools.length === 0) {
      logger.error("CHAT", "no_tools_available", { ctx });
      throw new Error("No MCP tools available. All database servers may be down.");
    }

    const coreToolCount = mcpTools.filter((t) => !t.defer_loading).length;
    const deferredToolCount = mcpTools.length - coreToolCount;

    if (coreToolCount === 0) {
      logger.warn("CHAT", "no_core_tools", { ctx, data: { total_tools: mcpTools.length } });
    }

    const tools = [TOOL_SEARCH_TOOL, ...mcpTools];

    logger.info("CHAT", "tools_loaded", {
      ctx,
      data: { total: mcpTools.length, core: coreToolCount, deferred: deferredToolCount },
    });

    // Store user message
    const userMsgId = uuidv4();
    messageQueries.create(userMsgId, sessionId, "user", userMessage, null);

    // Tool calling loop
    let continueLoop = true;
    let fullAssistantContent = "";
    const allToolCalls: ToolCall[] = [];
    let loopIteration = 0;

    while (continueLoop) {
      loopIteration++;
      const iterElapsed = startTimer();

      logger.info("CHAT", "llm_request_start", {
        ctx,
        data: { iteration: loopIteration, model: CLAUDE_MODEL, message_count: messages.length },
      });

      // Create streaming request to Claude
      const stream = anthropic.beta.messages.stream({
        model: CLAUDE_MODEL,
        betas: ["advanced-tool-use-2025-11-20"],
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: tools.length > 0 ? (tools as Anthropic.Tool[]) : undefined,
        messages,
      });

      let currentToolUseBlock: {
        id: string;
        name: string;
        input: string;
      } | null = null;
      let pendingToolCalls: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];
      let assistantContentBlocks: Anthropic.ContentBlock[] = [];
      let textChunkCount = 0;

      // Process stream events
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "text") {
            // Text block starting
          } else if (event.content_block.type === "tool_use") {
            currentToolUseBlock = {
              id: event.content_block.id,
              name: event.content_block.name,
              input: "",
            };
            logger.debug("STREAM", "tool_use_block_start", {
              ctx,
              data: { tool: event.content_block.name, block_id: event.content_block.id },
            });
          } else if ((event.content_block as { type: string }).type === "server_tool_use") {
            const serverTool = event.content_block as { type: string; name?: string };
            logger.info("CHAT", "server_tool_invoked", {
              ctx,
              data: { tool: serverTool.name || "unknown" },
            });
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            fullAssistantContent += event.delta.text;
            textChunkCount++;
            yield { type: "text", data: event.delta.text };
          } else if (event.delta.type === "input_json_delta" && currentToolUseBlock) {
            currentToolUseBlock.input += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          if (currentToolUseBlock) {
            try {
              const input = currentToolUseBlock.input
                ? JSON.parse(currentToolUseBlock.input)
                : {};
              pendingToolCalls.push({
                id: currentToolUseBlock.id,
                name: currentToolUseBlock.name,
                input,
              });
              logger.debug("STREAM", "tool_use_block_parsed", {
                ctx,
                data: { tool: currentToolUseBlock.name, input },
              });
            } catch (e) {
              logger.warn("STREAM", "tool_input_parse_failed", {
                ctx,
                data: { tool: currentToolUseBlock.name, raw_input: currentToolUseBlock.input.slice(0, 200) },
                error: e instanceof Error ? e : String(e),
              });
              pendingToolCalls.push({
                id: currentToolUseBlock.id,
                name: currentToolUseBlock.name,
                input: {},
              });
            }
            currentToolUseBlock = null;
          }
        } else if (event.type === "message_stop") {
          // Message complete
        }
      }

      // Get final message to check stop reason and content blocks
      const finalMessage = await stream.finalMessage();
      assistantContentBlocks = finalMessage.content;

      const iterDuration = iterElapsed();
      logger.info("CHAT", "llm_response_received", {
        ctx,
        duration_ms: iterDuration,
        data: {
          iteration: loopIteration,
          stop_reason: finalMessage.stop_reason,
          input_tokens: finalMessage.usage?.input_tokens,
          output_tokens: finalMessage.usage?.output_tokens,
          text_chunks: textChunkCount,
          pending_tool_calls: pendingToolCalls.length,
        },
      });

      // Check if we need to execute tools
      if (finalMessage.stop_reason === "tool_use" && pendingToolCalls.length > 0) {
        logger.info("TOOL", "batch_execution_start", {
          ctx,
          data: {
            iteration: loopIteration,
            tool_count: pendingToolCalls.length,
            tools: pendingToolCalls.map((t) => t.name).join(","),
          },
        });

        const toolResults: Array<{
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        }> = [];

        for (const toolCall of pendingToolCalls) {
          const { server, name: toolName } = toolRegistry.parseToolName(toolCall.name);
          const toolElapsed = startTimer();

          logger.info("TOOL", "call_start", {
            ctx,
            data: { tool: toolCall.name, server, tool_name: toolName, input: toolCall.input },
          });

          yield {
            type: "tool_start",
            data: {
              id: toolCall.id,
              tool: toolCall.name,
              server,
              toolName,
              input: toolCall.input,
            },
          };

          try {
            const result = await mcpManager.callTool(server, toolName, toolCall.input);

            const resultStr = typeof result.content === "string"
              ? result.content
              : JSON.stringify(result.content);
            const outputTokens = estimateTokens(resultStr);

            const toolCallRecord: ToolCall = {
              id: toolCall.id,
              name: toolCall.name,
              server,
              toolName,
              input: toolCall.input,
              output: result.content,
            };
            allToolCalls.push(toolCallRecord);

            logger.info("TOOL", "call_success", {
              ctx,
              duration_ms: toolElapsed(),
              data: {
                tool: toolCall.name,
                is_error: result.isError,
                output_tokens: outputTokens,
                output_chars: resultStr.length,
              },
            });

            yield {
              type: "tool_end",
              data: {
                id: toolCall.id,
                tool: toolCall.name,
                output: result.content,
                isError: result.isError,
              },
            };

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: resultStr,
              is_error: result.isError,
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            const toolCallRecord: ToolCall = {
              id: toolCall.id,
              name: toolCall.name,
              server,
              toolName,
              input: toolCall.input,
              error: errorMsg,
            };
            allToolCalls.push(toolCallRecord);

            logger.error("TOOL", "call_failed", {
              ctx,
              duration_ms: toolElapsed(),
              data: { tool: toolCall.name, server, tool_name: toolName },
              error: error instanceof Error ? error : errorMsg,
            });

            yield {
              type: "tool_end",
              data: {
                id: toolCall.id,
                tool: toolCall.name,
                error: errorMsg,
              },
            };

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: `Error: ${errorMsg}`,
              is_error: true,
            });
          }
        }

        logger.info("TOOL", "batch_execution_complete", {
          ctx,
          data: {
            iteration: loopIteration,
            total: pendingToolCalls.length,
            succeeded: toolResults.filter((r) => !r.is_error).length,
            failed: toolResults.filter((r) => r.is_error).length,
          },
        });

        // Filter out server-side artifacts
        const clientContentBlocks = assistantContentBlocks.filter(
          (block) =>
            (block as { type: string }).type !== "server_tool_use" &&
            (block as { type: string }).type !== "tool_search_tool_result"
        );
        messages.push({
          role: "assistant",
          content: clientContentBlocks,
        });

        messages.push({
          role: "user",
          content: toolResults,
        });
      } else {
        continueLoop = false;
      }
    }

    // Store assistant message with tool calls
    const assistantMsgId = uuidv4();
    messageQueries.create(
      assistantMsgId,
      sessionId,
      "assistant",
      fullAssistantContent,
      allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : null
    );

    // Update session timestamp and user query count
    chatSessionQueries.touch(sessionId);
    userQueries.incrementQueries(userId);

    logger.info("CHAT", "process_complete", {
      ctx,
      duration_ms: chatElapsed(),
      data: {
        iterations: loopIteration,
        tool_calls_total: allToolCalls.length,
        tool_calls_failed: allToolCalls.filter((t) => t.error).length,
        response_length: fullAssistantContent.length,
        response_tokens: estimateTokens(fullAssistantContent),
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

/**
 * Build Claude messages array from conversation history
 */
function buildClaudeMessages(
  history: DBMessage[],
  newUserMessage: string
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const msg of history) {
    if (msg.role === "user") {
      messages.push({
        role: "user",
        content: msg.content || "",
      });
    } else if (msg.role === "assistant") {
      messages.push({
        role: "assistant",
        content: msg.content || "",
      });
    }
  }

  // Add new user message
  messages.push({
    role: "user",
    content: newUserMessage,
  });

  return messages;
}

/**
 * Generate a title for a chat session based on the first message
 */
export async function generateSessionTitle(
  sessionId: string,
  firstMessage: string
): Promise<string> {
  const fallbackTitle = buildFallbackTitle(firstMessage);
  const elapsed = startTimer();
  const ctx: LogContext = { session_id: sessionId };

  logger.info("TITLE", "generation_start", { ctx, data: { model: TITLE_MODEL } });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await anthropic.messages.create(
      {
        model: TITLE_MODEL,
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: `Generate a short chat title (3-6 words) from this user question:
"${firstMessage.substring(0, 300)}"

Return only the title text.`,
          },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const generatedText =
      response.content.find((block) => block.type === "text")?.text || "";
    const title = normalizeTitle(generatedText, fallbackTitle);

    chatSessionQueries.updateTitle(sessionId, title);

    logger.info("TITLE", "generation_complete", {
      ctx,
      duration_ms: elapsed(),
      data: { title, input_tokens: response.usage?.input_tokens, output_tokens: response.usage?.output_tokens },
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

  if (!normalized) {
    return fallback;
  }

  return normalized.length > 80 ? normalized.slice(0, 80).trimEnd() : normalized;
}

function buildFallbackTitle(firstMessage: string): string {
  const cleaned = firstMessage
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!cleaned) {
    return "New Chat";
  }

  const words = cleaned.split(" ").slice(0, 6);
  const title = words.join(" ");
  return title.length > 80 ? title.slice(0, 80).trimEnd() : title;
}

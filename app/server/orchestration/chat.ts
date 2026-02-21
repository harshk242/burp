/**
 * Chat Orchestration
 * Handles the LLM tool-calling loop for chat interactions
 */

import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { mcpManager } from "../mcp/manager";
import { toolRegistry } from "../mcp/registry";
import { messageQueries, chatSessionQueries, userQueries } from "../db";

// Initialize Anthropic client
const anthropic = new Anthropic();

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

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
  try {
    // Check if session exists and belongs to the current user
    let session = chatSessionQueries.findById(sessionId) as { id: string; user_id: string } | null;
    if (session) {
      // Session exists - verify ownership
      if (session.user_id !== userId) {
        yield { type: "error", data: { error: "Unauthorized: session belongs to another user" } };
        return;
      }
    } else {
      // Session doesn't exist - create it for the current user
      chatSessionQueries.create(sessionId, userId, null);
      session = { id: sessionId, user_id: userId };
    }

    yield { type: "start", data: { sessionId } };

    // Load conversation history
    const history = messageQueries.findByChatId(sessionId) as DBMessage[];

    // Build messages array for Claude
    const messages = buildClaudeMessages(history, userMessage);

    // Get MCP tools in Claude format (core tools non-deferred, rest deferred)
    const mcpTools = toolRegistry.toClaudeFormat(true);

    // Guard: Must have at least some MCP tools available
    if (mcpTools.length === 0) {
      throw new Error(
        "No MCP tools available. All database servers may be down."
      );
    }

    // Guard: At least one MCP tool must be non-deferred (API requirement)
    // tool_search_tool_bm25 alone is useless if there are no tools to discover
    const coreToolCount = mcpTools.filter((t) => !t.defer_loading).length;
    if (coreToolCount === 0) {
      console.warn(
        "[Chat] Warning: No core tools available. All tools are deferred. " +
          "Claude will need to use tool_search_tool_bm25 for every query."
      );
    }

    // Combine: tool search (built-in) + MCP tools (mix of deferred/non-deferred)
    const tools = [TOOL_SEARCH_TOOL, ...mcpTools];

    // Log for debugging
    console.log(
      `[Chat] Tools loaded: ${mcpTools.length} MCP tools (${coreToolCount} core) + 1 tool_search_tool_bm25`
    );

    // Store user message
    const userMsgId = uuidv4();
    messageQueries.create(userMsgId, sessionId, "user", userMessage, null);

    // Tool calling loop
    let continueLoop = true;
    let fullAssistantContent = "";
    const allToolCalls: ToolCall[] = [];

    while (continueLoop) {
      // Create streaming request to Claude with beta header for tool search
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

      // Process stream events
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "text") {
            // Text block starting
          } else if (event.content_block.type === "tool_use") {
            // Regular MCP tool use block starting
            currentToolUseBlock = {
              id: event.content_block.id,
              name: event.content_block.name,
              input: "",
            };
          } else if ((event.content_block as { type: string }).type === "server_tool_use") {
            // Built-in tool (like tool_search_tool_bm25) being called
            // The API handles this automatically - no action needed
            const serverTool = event.content_block as { type: string; name?: string };
            console.log(
              `[Chat] Server tool being called: ${serverTool.name || "unknown"}`
            );
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            // Stream text to client
            fullAssistantContent += event.delta.text;
            yield { type: "text", data: event.delta.text };
          } else if (event.delta.type === "input_json_delta" && currentToolUseBlock) {
            // Accumulate tool input JSON
            currentToolUseBlock.input += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          if (currentToolUseBlock) {
            // Parse accumulated input and queue for execution
            try {
              const input = currentToolUseBlock.input
                ? JSON.parse(currentToolUseBlock.input)
                : {};
              pendingToolCalls.push({
                id: currentToolUseBlock.id,
                name: currentToolUseBlock.name,
                input,
              });
            } catch (e) {
              // If JSON parse fails, use empty object
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

      // Check if we need to execute tools
      if (finalMessage.stop_reason === "tool_use" && pendingToolCalls.length > 0) {
        // Execute all pending tool calls
        const toolResults: Array<{
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        }> = [];

        for (const toolCall of pendingToolCalls) {
          const { server, name: toolName } = toolRegistry.parseToolName(toolCall.name);

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

            const toolCallRecord: ToolCall = {
              id: toolCall.id,
              name: toolCall.name,
              server,
              toolName,
              input: toolCall.input,
              output: result.content,
            };
            allToolCalls.push(toolCallRecord);

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
              content: typeof result.content === "string"
                ? result.content
                : JSON.stringify(result.content),
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

        // Add assistant message with tool use blocks to messages
        messages.push({
          role: "assistant",
          content: assistantContentBlocks,
        });

        // Add tool results as user message
        messages.push({
          role: "user",
          content: toolResults,
        });

        // Continue the loop to get Claude's response to tool results
      } else {
        // No more tool calls, we're done
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

    yield { type: "done", data: { messageId: assistantMsgId } };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Chat] Error processing chat:", errorMsg);
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
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: `Generate a very short title (3-6 words) for a chat that starts with this message: "${firstMessage.substring(0, 200)}"

Just respond with the title, nothing else.`,
        },
      ],
    });

    const title =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : "New Chat";

    chatSessionQueries.updateTitle(sessionId, title);
    return title;
  } catch (error) {
    console.error("[Chat] Failed to generate title:", error);
    return "New Chat";
  }
}

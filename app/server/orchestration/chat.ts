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

When answering questions:
- Use the appropriate database tools to find accurate, up-to-date information
- Cross-reference multiple databases when relevant
- Cite specific identifiers (UniProt IDs, ChEMBL IDs, PMIDs, etc.)
- Explain your findings in clear, scientific language
- If information is not found, suggest alternative searches or databases

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

    // Get available tools in Claude format
    const tools = toolRegistry.toClaudeFormat(true);

    // Store user message
    const userMsgId = uuidv4();
    messageQueries.create(userMsgId, sessionId, "user", userMessage, null);

    // Tool calling loop
    let continueLoop = true;
    let fullAssistantContent = "";
    const allToolCalls: ToolCall[] = [];

    while (continueLoop) {
      // Create streaming request to Claude
      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: tools.length > 0 ? tools : undefined,
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
            // Tool use block starting
            currentToolUseBlock = {
              id: event.content_block.id,
              name: event.content_block.name,
              input: "",
            };
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
      model: "claude-sonnet-4-20250514",
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

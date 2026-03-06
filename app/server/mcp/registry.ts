/**
 * MCP Tool Registry
 * Manages tool discovery and search across MCP servers
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { mcpManager as MCPManagerType } from "./manager";
import { ALWAYS_LOADED_TOOLS } from "./platforms.config";

export interface MCPTool {
  name: string;
  description: string;
  server: string;
  inputSchema: Record<string, unknown>;
  available: boolean;
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  defer_loading?: boolean;
}

class ToolRegistry {
  private tools: Map<string, MCPTool> = new Map();

  /**
   * Register a tool from an MCP server
   */
  register(server: string, tool: Omit<MCPTool, "server" | "available">, available = true): void {
    const key = `${server}:${tool.name}`;
    this.tools.set(key, { ...tool, server, available });
  }

  /**
   * Discover tools from all running MCP servers
   */
  async discoverTools(mcpManager: typeof MCPManagerType): Promise<void> {
    this.clear();

    const runningServers = mcpManager.getRunningServers();
    console.log(`[Registry] Discovering tools from ${runningServers.length} servers...`);

    const results = await Promise.allSettled(
      runningServers.map(async (serverName) => {
        try {
          const tools = await mcpManager.listTools(serverName);
          for (const tool of tools) {
            this.register(serverName, {
              name: tool.name,
              description: tool.description || "",
              inputSchema: tool.inputSchema,
            });
          }
          return { server: serverName, count: tools.length };
        } catch (error) {
          console.error(`[Registry] Failed to discover tools from ${serverName}:`, error);
          throw error;
        }
      })
    );

    // Log results
    for (const result of results) {
      if (result.status === "fulfilled") {
        console.log(`[Registry] Discovered ${result.value.count} tools from ${result.value.server}`);
      }
    }

    console.log(`[Registry] Total tools registered: ${this.count}`);
  }

  /**
   * Update availability for all tools from a specific server
   */
  setServerAvailability(server: string, available: boolean): void {
    for (const [key, tool] of this.tools) {
      if (tool.server === server) {
        this.tools.set(key, { ...tool, available });
      }
    }
    console.log(`[Registry] Set ${server} tools availability to ${available}`);
  }

  /**
   * Convert tools to Claude API format with selective deferred loading.
   * Core ID-bridge tools are always loaded; others are deferred.
   * Uses server__toolname format for unique naming.
   */
  toClaudeFormat(onlyAvailable = true): Anthropic.Tool[] {
    const tools = onlyAvailable
      ? Array.from(this.tools.values()).filter((t) => t.available)
      : Array.from(this.tools.values());

    return tools.map((tool) => {
      const fullName = `${tool.server}__${tool.name}`;
      const isCore = ALWAYS_LOADED_TOOLS.has(fullName);

      return {
        name: fullName,
        description: `[${tool.server}] ${tool.description}`,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        // Core tools are NOT deferred; all others are
        ...(isCore ? {} : { defer_loading: true }),
      };
    });
  }

  /**
   * Get the list of always-loaded tool names for verification.
   */
  getAlwaysLoadedTools(): string[] {
    return Array.from(ALWAYS_LOADED_TOOLS);
  }

  /**
   * Parse a Claude tool name back to server and tool name
   */
  parseToolName(claudeToolName: string): { server: string; name: string } {
    const separatorIndex = claudeToolName.indexOf("__");
    if (separatorIndex === -1) {
      throw new Error(`Invalid Claude tool name format: ${claudeToolName}`);
    }
    return {
      server: claudeToolName.substring(0, separatorIndex),
      name: claudeToolName.substring(separatorIndex + 2),
    };
  }

  /**
   * Get all registered tools
   */
  getAll(includeUnavailable = true): MCPTool[] {
    const tools = Array.from(this.tools.values());
    return includeUnavailable ? tools : tools.filter((t) => t.available);
  }

  /**
   * Get tools by server name
   */
  getByServer(server: string): MCPTool[] {
    return Array.from(this.tools.values()).filter((t) => t.server === server);
  }

  /**
   * Search tools by name or description
   */
  search(query: string, includeUnavailable = true): MCPTool[] {
    const q = query.toLowerCase();
    const tools = Array.from(this.tools.values()).filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.server.toLowerCase().includes(q)
    );
    return includeUnavailable ? tools : tools.filter((t) => t.available);
  }

  /**
   * Get a specific tool
   */
  get(server: string, name: string): MCPTool | undefined {
    return this.tools.get(`${server}:${name}`);
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get tool count
   */
  get count(): number {
    return this.tools.size;
  }

  /**
   * Get count of available tools
   */
  get availableCount(): number {
    return Array.from(this.tools.values()).filter((t) => t.available).length;
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();

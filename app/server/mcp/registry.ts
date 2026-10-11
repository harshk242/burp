/**
 * MCP Tool Registry
 * Manages tool discovery and search across MCP servers.
 * Provides tools in Vercel AI SDK format for the chat orchestration layer.
 */

import { jsonSchema, type Tool } from "ai";
import type { mcpManager as MCPManagerType, ToolDefinition } from "./manager";
import { ALWAYS_LOADED_TOOLS } from "./platforms.config";
import { logger, startTimer } from "../logger";

export interface MCPTool {
  name: string;
  description: string;
  server: string;
  inputSchema: Record<string, unknown>;
  available: boolean;
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
   * Register the tools one MCP server listed. The unified server returns
   * prefixed names (e.g. "ensembl__search_genes"); they're parsed back into
   * platform + bare name for registry keying.
   */
  registerServerTools(serverName: string, tools: ToolDefinition[]): void {
    for (const tool of tools) {
      const sep = tool.name.indexOf("__");
      const server = sep !== -1 ? tool.name.substring(0, sep) : serverName;
      const name = sep !== -1 ? tool.name.substring(sep + 2) : tool.name;
      this.register(server, { name, description: tool.description || "", inputSchema: tool.inputSchema });
    }
  }

  /**
   * Discover tools from all running MCP servers
   */
  async discoverTools(mcpManager: typeof MCPManagerType): Promise<void> {
    this.clear();

    const runningServers = mcpManager.getRunningServers();
    const elapsed = startTimer();
    logger.info("REGISTRY", "discovery_start", { data: { server_count: runningServers.length, servers: runningServers.join(",") } });

    const results = await Promise.allSettled(
      runningServers.map(async (serverName) => {
        const serverElapsed = startTimer();
        try {
          const tools = await mcpManager.listTools(serverName);
          this.registerServerTools(serverName, tools);
          logger.info("REGISTRY", "server_tools_discovered", {
            duration_ms: serverElapsed(),
            data: { server: serverName, tool_count: tools.length },
          });
          return { server: serverName, count: tools.length };
        } catch (error) {
          logger.error("REGISTRY", "server_discovery_failed", {
            duration_ms: serverElapsed(),
            data: { server: serverName },
            error: error instanceof Error ? error : String(error),
          });
          throw error;
        }
      })
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    logger.info("REGISTRY", "discovery_complete", {
      duration_ms: elapsed(),
      data: { total_tools: this.count, servers_succeeded: succeeded, servers_failed: failed },
    });
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
    logger.info("REGISTRY", "server_availability_changed", { data: { server, available } });
  }

  /**
   * Update availability for ALL tools (used when the unified server goes down/up).
   * Returns whether any tool's availability actually changed.
   */
  setAllAvailability(available: boolean): boolean {
    let changed = false;
    for (const [key, tool] of this.tools) {
      if (tool.available === available) continue;
      this.tools.set(key, { ...tool, available });
      changed = true;
    }
    if (changed) logger.info("REGISTRY", "all_availability_changed", { data: { available } });
    return changed;
  }

  /**
   * The one place a registry tool becomes a model declaration: the
   * `[server] description` format. Does NOT include execute — callers attach
   * their own executors.
   */
  toVercelTools(
    tools: Iterable<MCPTool>,
    sanitize?: (name: string) => string
  ): Record<string, Tool> {
    const result: Record<string, Tool> = {};
    for (const tool of tools) {
      const fullName = `${tool.server}__${tool.name}`;
      const key = sanitize ? sanitize(fullName) : fullName;
      result[key] = {
        description: `[${tool.server}] ${tool.description}`,
        inputSchema: jsonSchema(tool.inputSchema as Parameters<typeof jsonSchema>[0]),
      };
    }
    return result;
  }

  /**
   * Get available core (always-loaded) tools in Vercel AI SDK format.
   */
  toVercelCoreTools(
    sanitize?: (name: string) => string
  ): Record<string, Tool> {
    const core = this.getAll(false).filter((t) => ALWAYS_LOADED_TOOLS.has(`${t.server}__${t.name}`));
    return this.toVercelTools(core, sanitize);
  }

  /**
   * Get a single tool by full name in Vercel AI SDK format.
   * Used for dynamically activating discovered tools.
   */
  getVercelTool(
    fullName: string,
    sanitize?: (name: string) => string
  ): { key: string; tool: Tool } | null {
    const sep = fullName.indexOf("__");
    if (sep === -1) return null;

    const mcpTool = this.tools.get(`${fullName.substring(0, sep)}:${fullName.substring(sep + 2)}`);
    if (!mcpTool) return null;

    const [entry] = Object.entries(this.toVercelTools([mcpTool], sanitize));
    return { key: entry![0], tool: entry![1] };
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

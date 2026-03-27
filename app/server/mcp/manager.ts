/**
 * MCP Server Manager
 * Manages lifecycle of MCP server child processes using MCP SDK Client
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { toolRegistry } from "./registry";
import { enabledPlatforms } from "./platforms.config";
import { logger, startTimer, estimateTokens } from "../logger";

// Environment-aware base path for MCP servers
// Default: "../mcp-servers" because app runs from app/ directory, servers are at project root in mcp-servers/
// In container: "/app/servers" where Dockerfile copies them
const MCP_SERVERS_BASE = process.env.MCP_SERVERS_BASE || "../mcp-servers";

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

// Collect env vars from all enabled platforms for the unified server
const unifiedEnv: Record<string, string | undefined> = {};
for (const p of enabledPlatforms) {
  if (p.env) Object.assign(unifiedEnv, p.env);
}

// Single unified MCP server replaces the 10 individual servers
export const MCP_SERVERS: MCPServerConfig[] = [
  {
    name: "unified",
    command: "node",
    args: [`${MCP_SERVERS_BASE}/unified/dist/index.js`],
    env: unifiedEnv,
  },
];

export type ServerStatus = "stopped" | "starting" | "running" | "error";

export interface MCPServer {
  config: MCPServerConfig;
  client: Client | null;
  transport: StdioClientTransport | null;
  status: ServerStatus;
  error?: string;
  retryCount: number;
  nextRetryAt?: Date;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: unknown;
  isError: boolean;
}

// Retry configuration
const INITIAL_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 60000;
const RETRY_BACKOFF_MULTIPLIER = 2;

class MCPManager {
  private servers: Map<string, MCPServer> = new Map();
  private retryIntervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * Register an MCP server configuration
   */
  register(config: MCPServerConfig): void {
    this.servers.set(config.name, {
      config,
      client: null,
      transport: null,
      status: "stopped",
      retryCount: 0,
    });
  }

  /**
   * Register all predefined MCP servers
   */
  registerAll(): void {
    for (const config of MCP_SERVERS) {
      this.register(config);
    }
  }

  /**
   * Start an MCP server and establish client connection
   */
  async start(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`MCP server '${name}' not registered`);
    }

    if (server.status === "running") {
      return;
    }

    server.status = "starting";
    server.error = undefined;
    const elapsed = startTimer();

    logger.info("MCP", "server_starting", { data: { server: name, command: server.config.command, args: server.config.args.join(" ") } });

    try {
      const transport = new StdioClientTransport({
        command: server.config.command,
        args: server.config.args,
        env: { ...process.env, ...server.config.env } as Record<string, string>,
        cwd: server.config.cwd,
      });

      server.transport = transport;

      const client = new Client(
        { name: "super-bio-agent", version: "1.0.0" },
        { capabilities: {} }
      );

      await client.connect(transport);

      server.client = client;
      server.status = "running";
      server.retryCount = 0;
      server.nextRetryAt = undefined;

      logger.info("MCP", "server_started", { duration_ms: elapsed(), data: { server: name } });

      transport.onclose = () => {
        if (server.status === "running") {
          server.status = "error";
          server.error = "Connection closed unexpectedly";
          server.client = null;
          server.transport = null;
          logger.error("MCP", "server_connection_closed", { data: { server: name } });
          this.scheduleRetry(name);
        }
      };

      transport.onerror = (error) => {
        if (server.status === "running") {
          server.status = "error";
          server.error = error instanceof Error ? error.message : String(error);
          server.client = null;
          server.transport = null;
          logger.error("MCP", "server_error", { data: { server: name }, error: error instanceof Error ? error : String(error) });
          this.scheduleRetry(name);
        }
      };
    } catch (error) {
      server.status = "error";
      server.error = error instanceof Error ? error.message : String(error);
      server.client = null;
      server.transport = null;
      logger.error("MCP", "server_start_failed", { duration_ms: elapsed(), data: { server: name }, error: error instanceof Error ? error : String(error) });
      this.scheduleRetry(name);
    }
  }

  /**
   * Schedule a retry for a failed server
   */
  private scheduleRetry(name: string): void {
    const server = this.servers.get(name);
    if (!server) return;

    // Unified server: mark all platforms unavailable
    toolRegistry.setAllAvailability(false);

    const delay = Math.min(
      INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, server.retryCount),
      MAX_RETRY_DELAY_MS
    );

    server.retryCount++;
    server.nextRetryAt = new Date(Date.now() + delay);

    logger.warn("MCP", "server_retry_scheduled", {
      data: { server: name, retry_count: server.retryCount, delay_s: delay / 1000 },
    });
  }

  /**
   * Stop an MCP server
   */
  async stop(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    // Prevent onclose from triggering retry
    const wasRunning = server.status === "running";
    server.status = "stopped";

    try {
      if (server.transport) {
        await server.transport.close();
      }
    } catch (error) {
      // Ignore close errors
    }

    try {
      if (server.client) {
        await server.client.close();
      }
    } catch (error) {
      // Ignore close errors
    }

    server.client = null;
    server.transport = null;
    server.nextRetryAt = undefined;

    if (wasRunning) {
      logger.info("MCP", "server_stopped", { data: { server: name } });
    }
  }

  /**
   * Start all registered servers (best-effort, continues on failures)
   */
  async startAll(): Promise<{ succeeded: number; failed: number }> {
    const totalServers = this.servers.size;
    logger.info("MCP", "starting_all_servers", { data: { total: totalServers } });

    await Promise.allSettled(
      Array.from(this.servers.keys()).map((name) => this.start(name))
    );

    let succeeded = 0;
    let failed = 0;
    const failedNames: string[] = [];
    for (const [name, server] of this.servers) {
      if (server.status === "running") {
        succeeded++;
      } else {
        failed++;
        failedNames.push(name);
      }
    }

    logger.info("MCP", "all_servers_started", {
      data: { succeeded, failed, total: totalServers, failed_servers: failedNames.length > 0 ? failedNames.join(",") : undefined },
    });

    this.startRetryLoop();
    return { succeeded, failed };
  }

  /**
   * Stop all running servers
   */
  async stopAll(): Promise<void> {
    this.stopRetryLoop();

    await Promise.allSettled(
      Array.from(this.servers.keys()).map((name) => this.stop(name))
    );

    logger.info("MCP", "all_servers_stopped");
  }

  /**
   * Start background retry loop for failed servers
   */
  private startRetryLoop(): void {
    if (this.retryIntervalId) return;

    this.retryIntervalId = setInterval(async () => {
      const now = new Date();

      for (const [name, server] of this.servers) {
        if (
          server.status === "error" &&
          server.nextRetryAt &&
          server.nextRetryAt <= now
        ) {
          logger.info("MCP", "server_retrying", { data: { server: name, retry_count: server.retryCount } });
          await this.start(name);

          if ((server.status as ServerStatus) === "running") {
            try {
              const tools = await this.listTools(name);
              for (const tool of tools) {
                // Parse prefixed tool names from unified server (e.g. "ensembl__search_genes")
                const sep = tool.name.indexOf("__");
                if (sep !== -1) {
                  const platformName = tool.name.substring(0, sep);
                  const bareName = tool.name.substring(sep + 2);
                  toolRegistry.register(platformName, {
                    name: bareName,
                    description: tool.description || "",
                    inputSchema: tool.inputSchema,
                  }, true);
                }
              }
              logger.info("MCP", "server_recovered_tools", { data: { server: name, tool_count: tools.length } });
            } catch (error) {
              server.status = "error";
              server.error = `Tool discovery failed: ${error instanceof Error ? error.message : String(error)}`;
              logger.error("MCP", "server_recovery_tool_discovery_failed", { data: { server: name }, error: error instanceof Error ? error : String(error) });
              this.scheduleRetry(name);
            }
          }
        }
      }
    }, 5000);
  }

  /**
   * Stop the background retry loop
   */
  private stopRetryLoop(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
    }
  }

  /**
   * List tools from an MCP server
   */
  async listTools(name: string): Promise<ToolDefinition[]> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`MCP server '${name}' not registered`);
    }

    if (server.status !== "running" || !server.client) {
      throw new Error(`MCP server '${name}' is not running`);
    }

    const result = await server.client.listTools();

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  /**
   * Call a tool on an MCP server
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs = 30000
  ): Promise<ToolResult> {
    // Route all calls through the unified server with prefixed tool name
    const server = this.servers.get("unified");
    if (!server) {
      logger.error("MCP", "tool_call_server_not_registered", { data: { server: serverName, tool: toolName } });
      throw new Error(`Unified MCP server not registered`);
    }

    if (server.status !== "running" || !server.client) {
      logger.error("MCP", "tool_call_server_unavailable", { data: { server: serverName, tool: toolName, status: server.status } });
      throw new Error(`Unified MCP server is not available (status: ${server.status})`);
    }

    const prefixedToolName = `${serverName}__${toolName}`;
    const elapsed = startTimer();

    logger.debug("MCP", "tool_call_start", {
      data: { server: serverName, tool: toolName, input: args, timeout_ms: timeoutMs },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Tool call timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const callPromise = server.client.callTool({
      name: prefixedToolName,
      arguments: args,
    });

    const result = await Promise.race([callPromise, timeoutPromise]);

    // Extract text content from result
    let content: unknown = result.content;
    let rawText = "";
    if (Array.isArray(result.content)) {
      const textContent = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      rawText = textContent;

      if (textContent.startsWith("{") || textContent.startsWith("[")) {
        try {
          content = JSON.parse(textContent);
        } catch {
          content = textContent;
        }
      } else {
        content = textContent;
      }
    } else if (typeof result.content === "string") {
      rawText = result.content;
    } else {
      rawText = JSON.stringify(result.content);
    }

    const duration = elapsed();
    const outputTokens = estimateTokens(rawText);
    const outputBytes = Buffer.byteLength(rawText, "utf8");

    logger.info("MCP", "tool_call_complete", {
      duration_ms: duration,
      data: {
        server: serverName,
        tool: toolName,
        is_error: result.isError || false,
        output_tokens: outputTokens,
        output_bytes: outputBytes,
        output_chars: rawText.length,
      },
    });

    return {
      content,
      isError: (result.isError ?? false) as boolean,
    };
  }

  /**
   * Get server status
   */
  getStatus(name: string): MCPServer | undefined {
    return this.servers.get(name);
  }

  /**
   * Get all server statuses
   */
  getAllStatuses(): Record<string, { status: ServerStatus; error?: string }> {
    const statuses: Record<string, { status: ServerStatus; error?: string }> = {};
    for (const [name, server] of this.servers) {
      statuses[name] = { status: server.status, error: server.error };
    }
    return statuses;
  }

  /**
   * Get list of running servers
   */
  getRunningServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([_, server]) => server.status === "running")
      .map(([name]) => name);
  }

  /**
   * Check if a server is available
   */
  isServerAvailable(_name: string): boolean {
    const server = this.servers.get("unified");
    return server?.status === "running" && server.client !== null;
  }
}

// Singleton instance
export const mcpManager = new MCPManager();

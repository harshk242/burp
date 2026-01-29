/**
 * MCP Server Manager
 * Manages lifecycle of MCP server child processes using MCP SDK Client
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { toolRegistry } from "./registry";

// Environment-aware base path for MCP servers
// Default: "../mcp-servers" because app runs from app/ directory, servers are at project root in mcp-servers/
// In container: "/app/servers" where Dockerfile copies them
const MCP_SERVERS_BASE = process.env.MCP_SERVERS_BASE || "../mcp-servers";

// Server configurations
interface MCPServerDef {
  name: string;
  dir: string;
  env?: Record<string, string | undefined>;
}

const MCP_SERVER_DEFS: MCPServerDef[] = [
  { name: "uniprot", dir: "uniprot" },
  { name: "chembl", dir: "chembl" },
  { name: "pubchem", dir: "pubchem" },
  { name: "ensembl", dir: "ensembl" },
  { name: "clinvar", dir: "clinvar", env: { NCBI_API_KEY: process.env.NCBI_API_KEY } },
  { name: "open-targets", dir: "open-targets" },
  { name: "reactome", dir: "reactome" },
  { name: "clinicaltrials", dir: "clinical-trials" },
  { name: "pubmed", dir: "pubmed", env: { NCBI_API_KEY: process.env.NCBI_API_KEY } },
  { name: "clinpgx", dir: "clinpgx" },
];

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export const MCP_SERVERS: MCPServerConfig[] = MCP_SERVER_DEFS.map((s) => ({
  name: s.name,
  command: "node",
  args: [`${MCP_SERVERS_BASE}/${s.dir}/dist/index.js`],
  env: s.env,
}));

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

    try {
      // Create transport - it handles spawning the process internally
      const transport = new StdioClientTransport({
        command: server.config.command,
        args: server.config.args,
        env: { ...process.env, ...server.config.env } as Record<string, string>,
        cwd: server.config.cwd,
      });

      server.transport = transport;

      // Create MCP client
      const client = new Client(
        { name: "super-bio-agent", version: "1.0.0" },
        { capabilities: {} }
      );

      // Connect client to transport (this starts the process)
      await client.connect(transport);

      server.client = client;
      server.status = "running";
      server.retryCount = 0;
      server.nextRetryAt = undefined;

      console.log(`[MCP] Server '${name}' started successfully`);

      // Handle transport close for crash detection
      transport.onclose = () => {
        if (server.status === "running") {
          console.error(`[MCP] Server '${name}' connection closed unexpectedly`);
          server.status = "error";
          server.error = "Connection closed unexpectedly";
          server.client = null;
          server.transport = null;
          this.scheduleRetry(name);
        }
      };

      transport.onerror = (error) => {
        if (server.status === "running") {
          console.error(`[MCP] Server '${name}' error:`, error);
          server.status = "error";
          server.error = error instanceof Error ? error.message : String(error);
          server.client = null;
          server.transport = null;
          this.scheduleRetry(name);
        }
      };
    } catch (error) {
      server.status = "error";
      server.error = error instanceof Error ? error.message : String(error);
      server.client = null;
      server.transport = null;
      console.error(`[MCP] Failed to start server '${name}':`, server.error);
      this.scheduleRetry(name);
    }
  }

  /**
   * Schedule a retry for a failed server
   */
  private scheduleRetry(name: string): void {
    const server = this.servers.get(name);
    if (!server) return;

    // Mark tools from this server as unavailable
    toolRegistry.setServerAvailability(name, false);

    const delay = Math.min(
      INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, server.retryCount),
      MAX_RETRY_DELAY_MS
    );

    server.retryCount++;
    server.nextRetryAt = new Date(Date.now() + delay);

    console.log(
      `[MCP] Server '${name}' scheduled for retry #${server.retryCount} in ${delay / 1000}s`
    );
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
      console.log(`[MCP] Server '${name}' stopped`);
    }
  }

  /**
   * Start all registered servers (best-effort, continues on failures)
   */
  async startAll(): Promise<{ succeeded: number; failed: number }> {
    console.log(`[MCP] Starting ${this.servers.size} servers...`);

    // Start all servers in parallel
    await Promise.allSettled(
      Array.from(this.servers.keys()).map((name) => this.start(name))
    );

    // Count actual successes/failures by checking server status (not Promise results)
    let succeeded = 0;
    let failed = 0;
    for (const server of this.servers.values()) {
      if (server.status === "running") {
        succeeded++;
      } else {
        failed++;
      }
    }

    console.log(`[MCP] Started ${succeeded}/${this.servers.size} servers (${failed} failed)`);

    // Start background retry loop
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

    console.log("[MCP] All servers stopped");
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
          console.log(`[MCP] Retrying server '${name}'...`);
          await this.start(name);

          // If server recovered, re-discover its tools
          if (server.status === "running") {
            try {
              const tools = await this.listTools(name);
              for (const tool of tools) {
                toolRegistry.register(name, {
                  name: tool.name,
                  description: tool.description || "",
                  inputSchema: tool.inputSchema,
                }, true); // available = true
              }
              console.log(`[MCP] Re-discovered ${tools.length} tools from recovered server '${name}'`);
            } catch (error) {
              // Tool discovery failed - mark server as error to trigger another retry
              // Otherwise tools remain permanently unavailable
              console.error(`[MCP] Failed to re-discover tools from '${name}', marking as error:`, error);
              server.status = "error";
              server.error = `Tool discovery failed: ${error instanceof Error ? error.message : String(error)}`;
              this.scheduleRetry(name);
            }
          }
        }
      }
    }, 5000); // Check every 5 seconds
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
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server '${serverName}' not registered`);
    }

    if (server.status !== "running" || !server.client) {
      throw new Error(`MCP server '${serverName}' is not available (status: ${server.status})`);
    }

    // Execute with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Tool call timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const callPromise = server.client.callTool({
      name: toolName,
      arguments: args,
    });

    const result = await Promise.race([callPromise, timeoutPromise]);

    // Extract text content from result
    let content: unknown = result.content;
    if (Array.isArray(result.content)) {
      // MCP returns array of content blocks, extract text
      const textContent = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      // Try to parse as JSON if it looks like JSON
      if (textContent.startsWith("{") || textContent.startsWith("[")) {
        try {
          content = JSON.parse(textContent);
        } catch {
          content = textContent;
        }
      } else {
        content = textContent;
      }
    }

    return {
      content,
      isError: result.isError || false,
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
  isServerAvailable(name: string): boolean {
    const server = this.servers.get(name);
    return server?.status === "running" && server.client !== null;
  }
}

// Singleton instance
export const mcpManager = new MCPManager();

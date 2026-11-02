import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { toolRegistry } from "./registry";
import { enabledPlatforms } from "./platforms.config";
import { logger, startTimer, estimateTokens } from "../logger";
import { appConfig } from "../config";

const MCP_SERVERS_BASE = appConfig.server.mcp_servers_base;

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

const unifiedEnv: Record<string, string | undefined> = {};
for (const p of enabledPlatforms) {
  if (p.env) Object.assign(unifiedEnv, p.env);
}

unifiedEnv.ENABLED_PLATFORMS = enabledPlatforms.map((p) => p.name).join(",");

export const MCP_SERVERS: MCPServerConfig[] = [
  {
    name: "unified",
    command: "node",
    args: [`${MCP_SERVERS_BASE}/dist/index.js`],
    env: unifiedEnv,
  },
];

function isRequestTimeout(error: unknown, timeoutMs: number): boolean {
  return (
    error instanceof McpError &&
    error.code === ErrorCode.RequestTimeout &&
    (error.data as { timeout?: unknown } | undefined)?.timeout === timeoutMs
  );
}

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
  meta?: Record<string, unknown>;
}

const INITIAL_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 60000;
const RETRY_BACKOFF_MULTIPLIER = 2;

export class MCPManager {
  private servers: Map<string, MCPServer> = new Map();
  private retryIntervalId: ReturnType<typeof setInterval> | null = null;

  onToolsChanged: (() => void) | null = null;

  register(config: MCPServerConfig): void {
    this.servers.set(config.name, {
      config,
      client: null,
      transport: null,
      status: "stopped",
      retryCount: 0,
    });
  }

  registerAll(): void {
    for (const config of MCP_SERVERS) {
      this.register(config);
    }
  }

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
        { name: "burp", version: "1.0.0" },
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

  private scheduleRetry(name: string): void {
    const server = this.servers.get(name);
    if (!server) return;

    if (toolRegistry.setAllAvailability(false)) this.notifyToolsChanged(name);

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

  async stop(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    const wasRunning = server.status === "running";
    server.status = "stopped";

    try {
      if (server.transport) {
        await server.transport.close();
      }
    } catch (error) {
    }

    try {
      if (server.client) {
        await server.client.close();
      }
    } catch (error) {
    }

    server.client = null;
    server.transport = null;
    server.nextRetryAt = undefined;

    if (wasRunning) {
      logger.info("MCP", "server_stopped", { data: { server: name } });
    }
  }

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

  async stopAll(): Promise<void> {
    this.stopRetryLoop();

    await Promise.allSettled(
      Array.from(this.servers.keys()).map((name) => this.stop(name))
    );

    logger.info("MCP", "all_servers_stopped");
  }

  private startRetryLoop(): void {
    if (this.retryIntervalId) return;

    this.retryIntervalId = setInterval(() => this.retryDueServers(), 5000);
  }

  async retryDueServers(now = new Date()): Promise<void> {
    for (const [name, server] of this.servers) {
      if (server.status !== "error" || !server.nextRetryAt || server.nextRetryAt > now) continue;

      logger.info("MCP", "server_retrying", { data: { server: name, retry_count: server.retryCount } });
      await this.start(name);
      if ((server.status as ServerStatus) !== "running") continue;

      try {
        const tools = await this.listTools(name);
        toolRegistry.registerServerTools(name, tools);
        logger.info("MCP", "server_recovered_tools", { data: { server: name, tool_count: tools.length } });
      } catch (error) {
        server.status = "error";
        server.error = `Tool discovery failed: ${error instanceof Error ? error.message : String(error)}`;
        logger.error("MCP", "server_recovery_tool_discovery_failed", { data: { server: name }, error: error instanceof Error ? error : String(error) });
        this.scheduleRetry(name);
        continue;
      }

      this.notifyToolsChanged(name);
    }
  }

  private notifyToolsChanged(server: string): void {
    try {
      this.onToolsChanged?.();
    } catch (error) {
      logger.error("MCP", "tools_changed_callback_failed", { data: { server }, error: error instanceof Error ? error : String(error) });
    }
  }

  private stopRetryLoop(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
    }
  }

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

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs = appConfig.server.mcp_tool_timeout_ms,
    signal?: AbortSignal
  ): Promise<ToolResult> {
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

    // The MCP client owns the deadline: on timeout or abort it sends
    // notifications/cancelled, drops the request and rejects; on a response it
    // clears its timer.
    let result: Awaited<ReturnType<Client["callTool"]>>;
    try {
      result = await server.client.callTool(
        { name: prefixedToolName, arguments: args, _meta: { deadline_ms: timeoutMs } },
        undefined,
        { signal, timeout: timeoutMs }
      );
    } catch (error) {
      // The client reports an abort as a timeout too.
      if (!signal?.aborted && isRequestTimeout(error, timeoutMs)) {
        throw new Error(`Tool call timed out after ${timeoutMs}ms`);
      }
      throw error;
    }

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

    const meta = result._meta as Record<string, unknown> | undefined;
    const duration = elapsed();
    const outputTokens = estimateTokens(rawText);
    const outputBytes = Buffer.byteLength(rawText, "utf8");

    const hardCapBytes = appConfig.artifact?.hard_cap_bytes ?? 1_048_576;
    if (outputBytes > hardCapBytes) {
      const actualMB = (outputBytes / 1024 / 1024).toFixed(2);
      const capMB = (hardCapBytes / 1024 / 1024).toFixed(1);
      logger.warn("MCP", "tool_output_hard_cap", {
        duration_ms: duration,
        data: {
          tool: prefixedToolName,
          output_bytes: outputBytes,
          output_chars: rawText.length,
          cap_bytes: hardCapBytes,
          reason: "output exceeds app-side hard cap for LLM context budget",
        },
      });
      return {
        content: `Error: Tool "${prefixedToolName}" returned ${actualMB}MB which exceeds the ${capMB}MB limit. The data was NOT truncated — nothing was lost. To fix: use more specific query parameters (e.g., smaller 'size', narrower filters) to reduce the result set.`,
        isError: true,
        ...(meta && { meta }),
      };
    }

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
      ...(meta && { meta }),
    };
  }

  getStatus(name: string): MCPServer | undefined {
    return this.servers.get(name);
  }

  getAllStatuses(): Record<string, { status: ServerStatus; error?: string }> {
    const statuses: Record<string, { status: ServerStatus; error?: string }> = {};
    for (const [name, server] of this.servers) {
      statuses[name] = { status: server.status, error: server.error };
    }
    return statuses;
  }

  getRunningServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([_, server]) => server.status === "running")
      .map(([name]) => name);
  }

  isServerAvailable(_name: string): boolean {
    const server = this.servers.get("unified");
    return server?.status === "running" && server.client !== null;
  }
}

export const mcpManager = new MCPManager();

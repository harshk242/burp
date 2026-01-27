/**
 * MCP Server Manager
 * Manages lifecycle of MCP server child processes
 *
 * Will be fully implemented in Phase 3 (Gateway)
 */

import { spawn, type Subprocess } from "bun";

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface MCPServer {
  config: MCPServerConfig;
  process: Subprocess | null;
  status: "stopped" | "starting" | "running" | "error";
  error?: string;
}

class MCPManager {
  private servers: Map<string, MCPServer> = new Map();

  /**
   * Register an MCP server configuration
   */
  register(config: MCPServerConfig): void {
    this.servers.set(config.name, {
      config,
      process: null,
      status: "stopped",
    });
  }

  /**
   * Start an MCP server
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

    try {
      server.process = spawn({
        cmd: [server.config.command, ...server.config.args],
        cwd: server.config.cwd,
        env: { ...process.env, ...server.config.env },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      });

      server.status = "running";
      console.log(`MCP server '${name}' started`);
    } catch (error) {
      server.status = "error";
      server.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Stop an MCP server
   */
  async stop(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server || !server.process) {
      return;
    }

    server.process.kill();
    server.process = null;
    server.status = "stopped";
    console.log(`MCP server '${name}' stopped`);
  }

  /**
   * Start all registered servers
   */
  async startAll(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.start(name);
    }
  }

  /**
   * Stop all running servers
   */
  async stopAll(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.stop(name);
    }
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
  getAllStatuses(): Record<string, { status: string; error?: string }> {
    const statuses: Record<string, { status: string; error?: string }> = {};
    for (const [name, server] of this.servers) {
      statuses[name] = { status: server.status, error: server.error };
    }
    return statuses;
  }
}

// Singleton instance
export const mcpManager = new MCPManager();

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Handler function for a single MCP tool.
 * Receives the raw arguments from the MCP call and returns a result object
 * that will be JSON-serialized into the tool response.
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Standard contract every platform module must implement.
 *
 * The unified server imports all platform modules, calls init() on startup,
 * aggregates tools (prefixed with `name__`), and dispatches CallTool requests
 * to the correct handler.
 */
export interface PlatformModule {
  /** Platform identifier used as the tool-name prefix (e.g. "ensembl") */
  name: string;

  /** MCP Tool definitions (name, description, inputSchema) */
  tools: Tool[];

  /** Map of bare tool name → handler function */
  handlers: Record<string, ToolHandler>;

  /** Called once at server startup to initialise API clients, rate limiters, etc. */
  init(env: Record<string, string | undefined>): void;

  /** Called at shutdown for graceful cleanup */
  cleanup(): void;
}

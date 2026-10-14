import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface PlatformModule {
  name: string;

  tools: Tool[];

  handlers: Record<string, ToolHandler>;

  init(env: Record<string, string | undefined>): void;

  cleanup(): void;
}

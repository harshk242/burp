// Open Targets platform module for the unified MCP server

import type { PlatformModule } from '../../types.js';
import { initializeClient, closeClient } from './client.js';
import { toolDefinitions, toolHandlers } from './tools.js';

export const platform: PlatformModule = {
  name: 'open-targets',
  tools: toolDefinitions,
  handlers: toolHandlers,

  init(env: Record<string, string | undefined>) {
    initializeClient({
      baseUrl: env.OPEN_TARGETS_API_URL,
    });
  },

  cleanup() {
    closeClient();
  },
};

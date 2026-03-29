/**
 * ClinicalTrials.gov platform module for the unified MCP server.
 */

import type { PlatformModule } from '../../types.js';
import { initClient, cleanupClient } from './client.js';
import { tools, handlers } from './tools/index.js';

export const platform: PlatformModule = {
  name: 'clinicaltrials',
  tools,
  handlers,

  init(env: Record<string, string | undefined>): void {
    initClient(env);
  },

  cleanup(): void {
    cleanupClient();
  },
};

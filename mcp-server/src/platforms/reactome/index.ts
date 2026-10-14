import type { PlatformModule } from '../../types.js';
import { initClient, resetClient } from './client.js';
import { tools } from './tools.js';
import { handlers } from './handlers.js';

export const platform: PlatformModule = {
  name: 'reactome',
  tools,
  handlers,

  init(env: Record<string, string | undefined>): void {
    initClient(env);
  },

  cleanup(): void {
    resetClient();
  },
};

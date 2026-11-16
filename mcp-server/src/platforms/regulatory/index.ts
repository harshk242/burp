import type { PlatformModule } from '../../types.js';
import { initClient, resetClient } from './client.js';
import { handlers } from './handlers.js';
import { tools } from './tools.js';

export const platform: PlatformModule = {
  name: 'regulatory',
  tools,
  handlers,

  init(env: Record<string, string | undefined>): void {
    initClient(env);
  },

  cleanup(): void {
    resetClient();
  },
};

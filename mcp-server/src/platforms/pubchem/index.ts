import type { PlatformModule } from '../../types.js';
import { initClient, cleanupClient } from './client.js';
import { tools, handlers } from './tools/index.js';

export const platform: PlatformModule = {
  name: 'pubchem',
  tools,
  handlers,
  init: (env) => initClient(env),
  cleanup: () => cleanupClient(),
};

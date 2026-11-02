import type { PlatformModule } from '../../types.js';
import { init, resetClient } from './client.js';
import { tools, handlers } from './tools/index.js';

export const platform: PlatformModule = {
  name: 'ensembl',
  tools,
  handlers,
  init,
  cleanup: resetClient,
};

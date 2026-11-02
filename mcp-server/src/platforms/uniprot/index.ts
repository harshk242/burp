import type { PlatformModule } from '../../types.js';
import { initClient, resetClient } from './client.js';
import { tools, searchHandlers, proteinHandlers } from './tools/index.js';

const uniprot: PlatformModule = {
  name: 'uniprot',
  tools,
  handlers: {
    ...searchHandlers,
    ...proteinHandlers,
  },
  init(env) {
    initClient(env);
  },
  cleanup() {
    resetClient();
  },
};

export { uniprot as platform };

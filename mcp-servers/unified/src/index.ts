#!/usr/bin/env node
import { runServer } from './server.js';

runServer().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});

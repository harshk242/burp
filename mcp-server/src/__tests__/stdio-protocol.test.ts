import { describe, expect, it } from 'vitest';
import { runStdioProbe } from './stdio-probe-runner.js';

// Offline: a stub Open Targets API steers search_entities("KLK3") into the canonical-resolve
// branch that once wrote "Resolving ..." to stdout and took every tool offline in the app.
describe('stdio protocol', () => {
  it('keeps stdout pure JSON-RPC through a real tool call', async () => {
    const { ok, report } = await runStdioProbe([], 60_000);
    expect(ok, report).toBe(true);
  }, 70_000);
});

import { describe, expect, it } from 'vitest';
import { runStdioProbe } from './stdio-probe-runner.js';

// Live APIs, one call per platform, all platforms enabled. Upstream flakiness is tolerated by the
// probe; this fails only if stdout carries non-JSON-RPC output, a tool is missing, or the server
// stops answering.
describe('stdio protocol (live)', () => {
  it('keeps stdout pure JSON-RPC across every platform', async () => {
    const { ok, report } = await runStdioProbe(['--live'], 240_000);
    expect(ok, report).toBe(true);
  }, 250_000);
});

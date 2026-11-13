import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Runs scripts/stdio-probe.ts against the server source as a real child process; the probe
// fails on any non-JSON-RPC stdout line. Returns the probe's report for assertion messages.
export async function runStdioProbe(flags: string[], timeoutMs: number): Promise<{ ok: boolean; report: string }> {
  try {
    const { stderr } = await promisify(execFile)(
      'bun',
      ['scripts/stdio-probe.ts', ...flags, '--', 'bun', 'src/index.ts'],
      { cwd: ROOT, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
    );
    return { ok: true, report: stderr };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    return { ok: false, report: `${e.message}\n${e.stderr ?? ''}${e.stdout ?? ''}` };
  }
}

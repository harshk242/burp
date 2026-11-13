import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// stdout is the JSON-RPC channel to the app. Server code must log via console.error/warn.
// server.ts also reroutes console.log/info/debug at runtime; this check keeps the source honest
// and catches process.stdout.write, which the runtime guard cannot.
const SRC = fileURLToPath(new URL('..', import.meta.url));
const FORBIDDEN = /\bconsole\.(log|info|debug)\s*\(|\bprocess\.stdout\.write\s*\(/;
const SKIP_DIRS = new Set(['__tests__', '__test-utils__']);

function serverSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : serverSources(path);
    const isSource = entry.name.endsWith('.ts') && !/\.(test|contract)\.ts$/.test(entry.name);
    return isSource ? [path] : [];
  });
}

describe('stdout hygiene', () => {
  it('server code never writes to stdout', () => {
    const offenders = serverSources(SRC).flatMap((file) =>
      readFileSync(file, 'utf8').split('\n').flatMap((line, i) =>
        FORBIDDEN.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim()}`] : [],
      ),
    );
    expect(offenders, 'use console.error (stdout carries JSON-RPC)').toEqual([]);
  });
});

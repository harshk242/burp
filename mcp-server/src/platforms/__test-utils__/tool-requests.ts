import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import axios, { type AxiosAdapter } from 'axios';
import { expect } from 'vitest';
import { argVariants, fullArgs, type Samples, type ToolArgs } from './tool-args.js';

export interface RecordedRequest {
  method: string; url: string; params: unknown; body: unknown;
}

/** Inject adapter into the platform client; reset the client between captures to bypass caches. */
export function requestRecorder(response: unknown = { data: {} }) {
  const requests: RecordedRequest[] = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push({
      method: config.method ?? 'get', url: axios.getUri({ baseURL: config.baseURL, url: config.url }),
      params: config.params ?? {},
      body: typeof config.data === 'string' ? String(config.headers?.['Content-Type'] ?? '').includes('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(config.data)) : JSON.parse(config.data) : config.data ?? {},
    });
    return { data: response, status: 200, statusText: 'OK', headers: {}, config };
  };
  return { adapter, requests };
}

export function assertHandlerCoverage(tools: Tool[], handlers: Record<string, unknown>) {
  expect(Object.keys(handlers).sort()).toEqual(tools.map((t) => t.name).sort());
}

/** Inspect structured values recursively without mistaking valid objects for bad string coercion. */
export function assertRequestValues(value: unknown, path = 'request'): void {
  expect(value, path).not.toBeUndefined();
  expect(value, path).not.toBeNull();
  if (typeof value === 'string') expect(value, path).not.toMatch(/\bundefined\b|\bnull\b|\[object Object\]/);
  else if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value!)) assertRequestValues(child, `${path}.${key}`);
  }
}

export function assertMakesRequest(requests: RecordedRequest[], localOnlyReason?: string) {
  if (localOnlyReason !== undefined) expect(localOnlyReason.trim().length).toBeGreaterThan(0);
  else expect(requests.length).toBeGreaterThan(0);
  requests.forEach((request) => assertRequestValues(request));
}

/** Reasons are per tool/argument; exceptions remain visible beside platform tests. */
export async function assertArgsAffectRequests(
  tool: Tool, samples: Samples,
  capture: (args: ToolArgs) => Promise<RecordedRequest[]>,
  clientSide: Record<string, string> = {},
) {
  const full = fullArgs(tool, samples);
  const baseline = JSON.stringify(await capture(full));
  for (const name of Object.keys(tool.inputSchema.properties ?? {})) {
    if (clientSide[name]) { expect(clientSide[name].trim().length).toBeGreaterThan(0); continue; }
    const prop = (tool.inputSchema.properties ?? {})[name] as { enum?: unknown[] };
    if (prop.enum?.length === 1) continue; // No alternative allowed by the schema.
    const value = full[name];
    const alternative = prop.enum?.length ? prop.enum.find(item => JSON.stringify(item) !== JSON.stringify(value)) : typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1
      : Array.isArray(value) ? [...value, ...value] : typeof value === 'object' ? {} : `${value}-alternate`;
    expect(JSON.stringify(await capture({ ...full, [name]: alternative })), name).not.toBe(baseline);
  }
  for (const variant of argVariants(tool, samples).filter((v) => v.label !== 'all args' && v.label !== 'required only')) {
    const name = variant.label.split(/[.\[=]/)[0];
    if (!clientSide[name]) expect(JSON.stringify(await capture(variant.args)), variant.label).not.toBe(baseline);
  }
}

/** Sequential tests can await this before each real handler invocation. */
export const pace = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

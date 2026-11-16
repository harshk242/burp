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
    const header: unknown = config.headers?.['Content-Type'];
    const contentType = typeof header === 'string' ? header : '';
    requests.push({
      method: config.method ?? 'get', url: axios.getUri({ ...(config.baseURL !== undefined && { baseURL: config.baseURL }), ...(config.url !== undefined && { url: config.url }) }),
      params: config.params ?? {},
      body: typeof config.data === 'string' ? contentType.includes('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(config.data)) : contentType.includes('text/plain') ? config.data : JSON.parse(config.data) : config.data ?? {},
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

/**
 * Reasons are per tool/argument; exceptions remain visible beside platform tests.
 * Keys are argument names (whole argument is local) or a single variant label such
 * as `format="xml"` (only that enum value is rendered locally). `alternatives`
 * overrides the generated alternate value for an argument whose generic
 * alternative is a no-op by design (e.g. a duplicated array that is de-duplicated).
 */
export async function assertArgsAffectRequests(
  tool: Tool, samples: Samples,
  capture: (args: ToolArgs) => Promise<RecordedRequest[]>,
  clientSide: Record<string, string> = {},
  alternatives: ToolArgs = {},
) {
  const full = fullArgs(tool, samples);
  const baseline = JSON.stringify(await capture(full));
  for (const name of Object.keys(tool.inputSchema.properties ?? {})) {
    if (clientSide[name]) { expect(clientSide[name].trim().length).toBeGreaterThan(0); continue; }
    const prop = (tool.inputSchema.properties ?? {})[name] as { enum?: unknown[] };
    if (prop.enum?.length === 1) continue; // No alternative allowed by the schema.
    const value = full[name];
    const alternative = Object.hasOwn(alternatives, name) ? alternatives[name] : prop.enum?.length ? prop.enum.find(item => JSON.stringify(item) !== JSON.stringify(value)) : typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1
      : Array.isArray(value) ? [...value, ...value] : typeof value === 'object' ? {} : typeof value === 'string' ? `${value}-alternate` : 'alternate';
    expect(JSON.stringify(await capture({ ...full, [name]: alternative })), name).not.toBe(baseline);
  }
  for (const variant of argVariants(tool, samples).filter((v) => v.label !== 'all args' && v.label !== 'required only')) {
    const name = variant.label.split(/[.[=]/)[0]!;
    const reason = clientSide[name] ?? clientSide[variant.label];
    if (reason) expect(reason.trim().length).toBeGreaterThan(0);
    else expect(JSON.stringify(await capture(variant.args)), variant.label).not.toBe(baseline);
  }
}

/** Sequential tests can await this before each real handler invocation. */
export const pace = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { expect, it } from 'vitest';
import { argVariants } from './tool-args.js';
import { assertArgsAffectRequests, assertHandlerCoverage, assertMakesRequest, assertRequestValues } from './tool-requests.js';

const tool: Tool = { name: 'fixture', inputSchema: { type: 'object', required: ['id'], properties: {
  id: { type: 'string' }, modes: { type: 'array', items: { type: 'string', enum: ['a', 'b', 'c'] } }, flag: { type: 'boolean' },
} } };
it('covers array enum values and required-only args', () => {
  expect(argVariants(tool, { id: 'real' }).map((v) => v.args)).toEqual([
    { id: 'real', modes: ['a'], flag: true }, { id: 'real', modes: ['b'], flag: true },
    { id: 'real', modes: ['c'], flag: true }, { id: 'real' },
  ]);
});
it('rejects silently ignored args and enums', async () => {
  await expect(assertArgsAffectRequests(tool, {}, async () => [])).rejects.toThrow();
});
it('rejects missing handlers and missing requests unless declared local', () => {
  expect(() => assertHandlerCoverage([tool], {})).toThrow();
  expect(() => assertMakesRequest([])).toThrow();
  assertMakesRequest([], 'Computes a local summary.');
});
it.each([undefined, null, '[object Object]', { nested: [undefined] }, { nested: 'undefined' }])('rejects malformed values: %j', (value) => {
  expect(() => assertRequestValues(value)).toThrow();
});
it('covers enums nested in object and array arguments', () => {
  const nested: Tool = { name: 'nested', inputSchema: { type: 'object', properties: {
    filter: { type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'] } } },
  } } };
  expect(argVariants(nested).map((v) => v.args)).toEqual([
    { filter: { mode: 'a' } }, { filter: { mode: 'b' } }, {},
  ]);
});

it('records form bodies and resolves absolute URLs without duplicating the base', async () => {
  const { requestRecorder } = await import('./tool-requests.js');
  const recorder = requestRecorder();
  const axios = (await import('axios')).default;
  const http = axios.create({ baseURL: 'https://example.org/api', adapter: recorder.adapter });
  await http.post('https://example.org/api/search', new URLSearchParams({ smiles: 'C/C=C\\C' }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  expect(recorder.requests[0]).toMatchObject({ url: 'https://example.org/api/search', body: { smiles: 'C/C=C\\C' } });
});
it('preserves axios base path joining for relative resource URLs', async () => {
  const { requestRecorder } = await import('./tool-requests.js');
  const recorder = requestRecorder();
  const axios = (await import('axios')).default;
  await axios.create({ baseURL: 'https://example.org/api/data', adapter: recorder.adapter }).get('/molecule.json');
  expect(recorder.requests[0]!.url).toBe('https://example.org/api/data/molecule.json');
});

it('uses valid enum alternatives and accepts singleton enums', async () => {
  const enumTool: Tool = { name: 'enum', inputSchema: { type: 'object', properties: {
    format: { type: 'string', enum: ['json', 'fasta'] }, only: { type: 'string', enum: ['json'] },
  } } };
  await assertArgsAffectRequests(enumTool, {}, async args => {
    expect(['json', 'fasta']).toContain(args.format);
    expect(args.only).toBe('json');
    return [{ method: 'get', url: 'https://example.org', params: args, body: {} }];
  });
});

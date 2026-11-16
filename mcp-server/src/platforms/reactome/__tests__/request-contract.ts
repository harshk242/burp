import { expect } from 'vitest';
import parameters from '../../__test-utils__/fixtures/reactome/parameters.json' with { type: 'json' };
import { assertRequestValues, type RecordedRequest } from '../../__test-utils__/tool-requests.js';

// Parameter-only projection fetched from /ContentService/v3/api-docs on 2026-11-13.
// Search facet values are published dynamically by /search/facet_query instead.
export { parameters };
export function assertReactomeRequest(request: RecordedRequest) {
  assertRequestValues(request);
  expect(new URL(request.url).origin).toBe('https://reactome.org');
  if (request.method === 'post') {
    expect(new URL(request.url).pathname).toBe('/ContentService/interactors/static/molecules/details');
    expect(request.params).toEqual({});
    expect(parameters['/interactors/static/molecules/details'].post.requestBody.required).toBe(true);
    expect(typeof request.body).toBe('string');
    const ids = (request.body as string).split(',');
    expect(ids.length).toBeLessThanOrEqual(100);
    ids.forEach(id => expect(id).toMatch(/^[A-Z0-9]+(?:-[0-9]+)?$/));
    return;
  }
  expect(request.method).toBe('get');
  const url = new URL(request.url);
  expect(url.origin).toBe('https://reactome.org');
  const path = url.pathname.replace(/^\/ContentService/, '');
  const route = Object.keys(parameters).find(route =>
    new RegExp('^' + route.replace(/\{[^}]+\}/g, '[^/]+') + '$').test(path));
  expect(route, path).toBeDefined();
  const allowed = (parameters[route as keyof typeof parameters] as { get: { parameters: any[] } }).get.parameters;
  const params = { ...Object.fromEntries(url.searchParams), ...request.params as object };
  for (const [name, value] of Object.entries(params)) {
    const param = allowed.find(p => p.in === 'query' && p.name === name);
    expect(param, name).toBeDefined();
    const schema = param!.schema as { type: string; enum?: unknown[] };
    if (schema.enum) expect(schema.enum).toContain(value);
    if (schema.type === 'integer') expect(Number.isInteger(Number(value))).toBe(true);
  }
  for (const param of allowed.filter(p => p.in === 'query' && p.required)) expect(params).toHaveProperty(param.name);
  if (params.types !== undefined) expect(['Pathway', 'Reaction', 'Protein', 'Complex']).toContain(params.types);
  if (route?.includes('{id}')) {
    const match = new RegExp('^' + route.replace('{id}', '([^/]+)') + '$').exec(path)!;
    expect(decodeURIComponent(match[1]!)).toMatch(/^R-[A-Z]{3}-\d+$/);
  }
  if (route?.includes('{acc}')) expect(decodeURIComponent(path.split('/').at(-2)!)).toMatch(/^[A-Z0-9]+(?:-\d+)?$/);
}

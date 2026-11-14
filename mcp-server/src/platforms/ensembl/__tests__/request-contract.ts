import { expect } from 'vitest';
import parameters from '../../__test-utils__/fixtures/ensembl/parameters.json' with { type: 'json' };
import { assertRequestValues, type RecordedRequest } from '../../__test-utils__/tool-requests.js';
export { parameters };
export function assertEnsemblRequest(request: RecordedRequest) {
  assertRequestValues(request);
  const url = new URL(request.url);
  expect(url.origin).toBe('https://rest.ensembl.org');
  const route = parameters.find(p => p.method === request.method &&
    new RegExp('^' + p.path.replace(/:\w+/g, '[^/]+') + '$').test(url.pathname));
  expect(route, url.pathname).toBeDefined();
  for (const key of Object.keys(request.params as object)) expect(route!.query, key).toContain(key);
  for (const key of Object.keys(request.body as object)) expect(route!.body, key).toContain(key);
  for (const [key, rule] of Object.entries(route!.constraints)) {
    const value = (request.params as any)[key];
    if (value !== undefined) expect((rule as { enum: unknown[] }).enum, key).toContain(value);
  }
  for (const key of route!.requiredBody) {
    const value = (request.body as any)[key];
    expect(Array.isArray(value), key).toBe(true);
    expect(value.length, key).toBeGreaterThan(0);
    value.forEach((item: unknown) => { expect(typeof item).toBe('string'); expect(String(item).trim()).not.toBe(''); });
  }
  if (route!.path.startsWith("/map/")) expect(url.pathname.split("/")[4]).toMatch(/^\w+:/);
  for (const segment of url.pathname.split('/').filter(Boolean)) expect(decodeURIComponent(segment)).toMatch(/^[\w.:-]+$/);
  if ((request.params as any)['content-type']) expect(['application/json', 'text/x-fasta', 'text/xml', 'text/x-nh', 'text/x-phyloxml+xml']).toContain((request.params as any)['content-type']);
}

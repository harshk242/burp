import { expect } from 'vitest';
import parameters from '../../__test-utils__/fixtures/clinpgx/parameters.json' with { type: 'json' };
import type { RecordedRequest } from '../../__test-utils__/tool-requests.js';

export { parameters };
// openapi.json omits several working routes and relationship filters. These
// extensions are separately exercised against the live API, including no-match
// probes, because the published spec alone cannot describe existing handlers.
const extensions: Record<string, string[]> = {
  '/data/gene': ['cpicGene'],
  '/data/pathway': ['genes.symbol'],
  '/data/haplotype': ['gene.symbol'],
  '/data/clinicalAnnotation': ['location.genes.symbol', 'relatedChemicals.name', 'location.fingerprint'],
  '/data/labelAnnotation': ['relatedGenes.symbol', 'relatedChemicals.name'],
  '/data/guidelineAnnotation': ['relatedGenes.symbol', 'relatedChemicals.name'],
};
export function assertClinPGxRequest(request: RecordedRequest) {
  expect(request.method).toBe('get');
  const url = new URL(request.url);
  expect(url.origin).toBe('https://api.clinpgx.org');
  expect(url.search).toBe('');
  let path = url.pathname.replace(/^\/v1/, '');
  path = path.replace(/\/PA\d+$/, '/{id}');
  if (path === '/data/variant') path += '/';
  const documented = parameters[path as keyof typeof parameters];
  expect(Boolean(documented || extensions[path]), path).toBe(true);
  const allowed = [...(documented ?? []).filter(p => p.in === 'query').map(p => p.name), ...(extensions[path] ?? [])];
  for (const [key, value] of Object.entries(request.params as Record<string, unknown>)) {
    expect(allowed, `${path}: ${key}`).toContain(key);
    expect(['string', 'boolean', 'number']).toContain(typeof value);
    const parameter = (documented ?? []).find(p => p.name === key);
    if (parameter && 'enum' in parameter.schema) expect(parameter.schema.enum).toContain(value);
  }
  expect(request.body).toEqual({});
}

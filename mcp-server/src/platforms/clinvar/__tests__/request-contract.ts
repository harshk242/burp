import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { RecordedRequest } from '../../__test-utils__/tool-requests.js';

export const fields: Array<{ name: string; fullname: string }> = JSON.parse(
  readFileSync(new URL('../../__test-utils__/fixtures/clinvar/fields.json', import.meta.url), 'utf8'),
);
const names = new Set(fields.flatMap(f => [f.name, f.fullname].map(s => s.toLowerCase())));
export const tags = (term: string) => [...term.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].toLowerCase());
// NCBI expands CPOS ranges using the CHRPOS alias in QueryTranslation.
export const canonicalField = (tag: string) => tag.toLowerCase() === 'chrpos' ? 'cpos' : fields.find(f =>
  [f.name.toLowerCase(), f.fullname.toLowerCase()].includes(tag.toLowerCase()))?.name.toLowerCase();

export function assertNcbiRequest(request: RecordedRequest) {
  const params = request.params as Record<string, unknown>;
  const endpoint = new URL(request.url).pathname.split('/').at(-1)!;
  const allowed: Record<string, string[]> = {
    'esearch.fcgi': ['term', 'retmax', 'retstart', 'retmode', 'db', 'api_key'],
    'esummary.fcgi': ['id', 'retmode', 'db', 'api_key'],
    'efetch.fcgi': ['id', 'rettype', 'is_variationid', 'retmode', 'db', 'api_key'],
  };
  expect(allowed[endpoint], endpoint).toBeDefined();
  for (const key of Object.keys(params)) expect(allowed[endpoint]).toContain(key);
  expect(request.method).toBe('get');
  expect(params.db).toBe('clinvar');
  expect(['xml', 'json']).toContain(params.retmode);
  if (endpoint === 'esearch.fcgi') {
    expect(params.retmode).toBe('xml');
    expect(Number.isInteger(params.retmax)).toBe(true);
    expect(Number(params.retmax)).toBeGreaterThan(0);
    expect(params.retstart).toBe(0);
    for (const tag of tags(String(params.term))) expect(names.has(tag), tag).toBe(true);
    // A valid field can still contain an invalid property token.
    for (const token of String(params.term).matchAll(/(\S+)\[prop\]/g)) {
      expect(['clinsig_pathogenic', 'clinsig_likely_pathogenic', 'clinsig_vus',
        'clinsig_likely_benign', 'clinsig_benign']).toContain(token[1]);
    }
  } else {
    expect(String(params.id)).toMatch(/^\d+(,\d+)*$/);
    if (endpoint === 'efetch.fcgi') {
      expect(params.rettype).toBe('vcv');
      expect(params.is_variationid).toBe('true');
      expect(params.retmode).toBe('xml');
    }
  }
}

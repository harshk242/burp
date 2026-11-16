import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { ncbiFields, type NcbiField } from '../../__test-utils__/ncbi.js';
import type { RecordedRequest } from '../../__test-utils__/tool-requests.js';

export const fields: NcbiField[] = JSON.parse(readFileSync(
  new URL('../../__test-utils__/fixtures/pubmed/fields.json', import.meta.url), 'utf8',
));
// sb is PubMed's documented subset alias for the EInfo Filter field.
export const { assertSearchAccepted, assertFieldTags } = ncbiFields(fields, { sb: 'filt' });
export function assertPubmedRequest(request: RecordedRequest) {
  const p = request.params as Record<string, unknown>;
  const endpoint = new URL(request.url).pathname.split('/').at(-1)!;
  const allowed: Record<string, string[]> = {
    'esearch.fcgi': ['db', 'term', 'retmax', 'retstart', 'sort', 'datetype', 'mindate', 'maxdate', 'retmode', 'api_key'],
    'efetch.fcgi': ['db', 'id', 'rettype', 'retmode', 'api_key'],
    'esummary.fcgi': ['db', 'id', 'retmode', 'api_key'],
    'elink.fcgi': ['db', 'dbfrom', 'id', 'linkname', 'cmd', 'retmode', 'api_key'],
  };
  expect(request.method).toBe('get');
  expect(allowed[endpoint], endpoint).toBeDefined();
  for (const key of Object.keys(p)) expect(allowed[endpoint]).toContain(key);
  expect(p.db).toBe('pubmed');
  expect(p.retmode).toBe('xml');
  if (endpoint === 'esearch.fcgi') {
    assertFieldTags(String(p.term));
    if (p.sort) expect(['relevance', 'pub_date', 'Author', 'JournalName']).toContain(p.sort);
    if (p.datetype) expect(['pdat', 'edat', 'mdat']).toContain(p.datetype);
    if (p.mindate || p.maxdate) expect(p.datetype).toBe('pdat');
    for (const key of ['mindate', 'maxdate']) if (p[key]) expect(p[key]).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    for (const key of ['retmax', 'retstart']) {
      expect(Number.isInteger(p[key])).toBe(true);
      expect(Number(p[key])).toBeGreaterThanOrEqual(0);
      expect(Number(p[key])).toBeLessThanOrEqual(10000);
    }
  } else {
    expect(String(p.id)).toMatch(/^\d+(,\d+)*$/);
    if (endpoint === 'efetch.fcgi') expect(p.rettype).toBe('xml');
    if (endpoint === 'elink.fcgi') {
      expect(p.dbfrom).toBe('pubmed');
      expect(p.cmd).toBe('neighbor');
      expect(['pubmed_pubmed', 'pubmed_pubmed_citedin', 'pubmed_pubmed_refs']).toContain(p.linkname);
    }
  }
}

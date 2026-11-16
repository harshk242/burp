import { expect } from 'vitest';
import queryFields from '../../__test-utils__/fixtures/uniprot/query-fields.json' with { type: "json" };
import returnFields from '../../__test-utils__/fixtures/uniprot/return-fields.json' with { type: "json" };
import { assertRequestValues, type RecordedRequest } from '../../__test-utils__/tool-requests.js';

// https://www.uniprot.org/help/accession_numbers, plus an optional isoform suffix.
const UNIPROT_ACCESSION = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/;

/** Keep only API field identifiers, independent of labels and configure ordering. */
export function configureFields(value: unknown, kind: 'query' | 'return'): string[] {
  const names = new Set<string>();
  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const row = node as Record<string, unknown>;
    for (const key of kind === 'query' ? ['term', 'autoCompleteQueryTerm'] : ['name']) {
      if (typeof row[key] === 'string') names.add(row[key]);
    }
    Object.values(row).forEach(visit);
  }
  visit(value);
  return [...names].sort();
}

export function assertUniProtRequest(request: RecordedRequest): void {
  assertRequestValues(request);
  const url = new URL(request.url);
  expect(url.origin).toBe('https://rest.uniprot.org');
  expect(request.method).toBe('get');
  expect(url.search).toBe('');
  expect(request.body).toEqual({});
  const search = url.pathname === '/uniprotkb/search';
  const batch = url.pathname === '/uniprotkb/accessions';
  if (!search) expect(url.pathname).toMatch(/^\/uniprotkb\/[^/]+$/);
  const params = request.params as Record<string, unknown>;
  // Endpoint parameter names from UniProt's REST API; configure describes fields, not params.
  const allowed = search ? ['query', 'format', 'size', 'fields', 'sort', 'cursor', 'includeIsoform']
    : batch ? ['accessions', 'format', 'fields'] : ['format', 'fields'];
  for (const name of Object.keys(params)) expect(allowed, name).toContain(name);
  expect(search ? ['json', 'tsv', 'fasta', 'xml'] : batch ? ['json', 'tsv', 'fasta']
    : ['json', 'tsv', 'fasta', 'xml', 'gff', 'txt']).toContain(params.format);
  if (batch) {
    // A single malformed accession makes UniProt reject the whole batch request.
    expect(typeof params.accessions).toBe('string');
    const accessions = String(params.accessions).split(',');
    expect(accessions.length).toBeGreaterThanOrEqual(1);
    expect(accessions.length).toBeLessThanOrEqual(1000);
    for (const accession of accessions) expect(accession).toMatch(UNIPROT_ACCESSION);
  }
  if (search) {
    expect(typeof params.query).toBe('string');
    expect(String(params.query).length).toBeGreaterThan(0);
    expect(Number(params.size)).toBeGreaterThanOrEqual(1);
    expect(Number(params.size)).toBeLessThanOrEqual(500);
    // Ignore quoted values, which may contain colons (e.g. a protein name).
    const query = String(params.query).replace(/"(?:\\.|[^"\\])*"/g, '""');
    for (const match of query.matchAll(/([A-Za-z_][\w.-]*):/g)) {
      // Supported legacy aggregate alias, absent from configure. Its equivalence
      // to these configured fields is checked live, rather than editing upstream data.
      const canonical = match[1] === 'cc_subcellular_location' ? ['cc_scl_term', 'cc_scl_note'] : [match[1]];
      canonical.forEach(field => expect(queryFields, field).toContain(field));
    }
  }
  if (params.fields !== undefined) {
    expect(typeof params.fields).toBe('string');
    for (const field of String(params.fields).split(',')) expect(returnFields, field).toContain(field);
  }
}

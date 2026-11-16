import { expect } from 'vitest';
import type { RecordedRequest } from '../../__test-utils__/tool-requests.js';
import { assertRequestValues } from '../../__test-utils__/tool-requests.js';
import { PROPERTY_NAMES } from '../properties.js';

// PUG-REST has no OpenAPI document. Operation grammar and options transcribed from:
// https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest#section=URL-based-API
// #section=Fast-Identity-Similarity-Substructure-Superstructure and #section=Compound-Property-Tables
export function assertPubChemRequest(request: RecordedRequest) {
  assertRequestValues(request);
  const url = new URL(request.url);
  expect(url.origin).toBe('https://pubchem.ncbi.nlm.nih.gov');
  expect(url.search).toBe('');
  const path = url.pathname.replace('/rest/pug/', '').split('/').filter(Boolean);
  const params = request.params as Record<string, unknown>;
  const body = request.body as Record<string, unknown>;
  let allowedParams: string[] = [], allowedBody: string[] = [];
  if (request.method === 'post') {
    if (path[1] === 'fastsimilarity_2d') {
      expect(path).toEqual(['compound', 'fastsimilarity_2d', 'smiles', 'cids', 'JSON']);
      allowedParams = ['Threshold', 'MaxRecords']; allowedBody = ['smiles'];
      expect(Number(params.Threshold)).toBeGreaterThanOrEqual(0);
      expect(Number(params.Threshold)).toBeLessThanOrEqual(100);
      expect(Number(params.MaxRecords)).toBeGreaterThan(0);
    } else {
      expect(['smiles', 'inchi', 'sdf']).toContain(path[1]);
      expect(path).toEqual(['compound', path[1], 'cids', 'JSON']);
      allowedBody = [path[1]!];
    }
    expect(Object.keys(body)).toEqual(allowedBody);
  } else {
    expect(request.method).toBe('get');
    if (path[0] === 'assay') expect(path).toEqual(['assay', 'aid', path[2], 'description', 'JSON']);
    else {
      expect(path[0]).toBe('compound');
      expect(['cid', 'name', 'smiles', 'fastformula']).toContain(path[1]);
      expect(path[2]).toBeTruthy();
      if (path[3] === 'property') {
        for (const property of path[4]!.split(',')) expect(PROPERTY_NAMES).toContain(property);
        expect(path.slice(5)).toEqual(['JSON']);
      } else if (['cids', 'synonyms', 'classification', 'description'].includes(path[3]!)) {
        expect(path.length).toBe(path[3] === 'description' && path.length === 4 ? 4 : 5);
        if (path.length === 5) expect(path[4]).toBe('JSON');
      } else {
        expect(path.length).toBe(4);
        expect(['JSON', 'sdf', 'xml', 'asnt', 'asnb']).toContain(path[3]);
      }
    }
    expect(body).toEqual({});
  }
  expect(Object.keys(params).every(key => allowedParams.includes(key))).toBe(true);
}

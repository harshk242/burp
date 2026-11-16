import { expect } from 'vitest';
import fixture from '../../__test-utils__/fixtures/chembl/resource-filters.json' with { type: 'json' };
import { assertMakesRequest, type RecordedRequest } from '../../__test-utils__/tool-requests.js';

export interface ResourceSchema {
  filtering?: Record<string, string[] | number>;
  fields: Record<string, { filtering?: ResourceSchema['filtering']; fields?: ResourceSchema['fields'] }>;
}
export const schemas = fixture as Record<string, ResourceSchema>;
// A deliberately narrow per-route allowlist. Field filters are independently
// validated against the upstream schema below. q is only valid on /search.
export const routeParams: Record<string, string[]> = {
  'molecule/search': ['q', 'limit', 'offset', 'max_phase', 'max_phase__gte'],
  'target/search': ['q', 'limit', 'target_type', 'organism'],
  molecule: ['limit', 'molecule_properties__mw_freebase__gte', 'molecule_properties__mw_freebase__lte',
    'molecule_properties__alogp__gte', 'molecule_properties__alogp__lte',
    'molecule_properties__hbd__lte', 'molecule_properties__hba__lte'],
  activity: ['limit', 'target_chembl_id', 'assay_chembl_id', 'molecule_chembl_id', 'standard_type',
    'standard_value__gte', 'standard_value__lte', 'standard_units'],
  drug_indication: ['limit', 'molecule_chembl_id', 'mesh_heading__icontains'],
  mechanism: ['limit', 'molecule_chembl_id'], similarity: ['limit'], substructure: ['limit'],
};
export function assertFilter(schema: ResourceSchema, param: string): void {
  const [field, ...rest] = param.split('__');
  const allowed = schema.filtering?.[field];
  expect(allowed, param).toBeDefined();
  if (!rest.length) return;
  if (rest.length === 1 && Array.isArray(allowed)) expect(allowed, param).toContain(rest[0]);
  else {
    expect(allowed, param).toBe(2); // Tastypie ALL_WITH_RELATIONS
    const child = schema.fields[field];
    expect(child.fields, param).toBeDefined();
    assertFilter(child as ResourceSchema, rest.join('__'));
  }
}
export function assertChemblRequest(request: RecordedRequest) {
  assertMakesRequest([request]);
  const url = new URL(request.url);
  const parts = url.pathname.replace('/chembl/api/data/', '').replace(/\.(json|sdf)$/, '').split('/');
  const resource = parts[0];
  expect(schemas[resource], request.url).toBeDefined();
  const route = parts[1] === 'search' ? `${resource}/search`
    : ['similarity', 'substructure'].includes(resource) || parts.length === 1 ? resource : 'detail';
  const params = { ...Object.fromEntries(url.searchParams), ...request.params as object };
  for (const key of Object.keys(params)) {
    expect(routeParams[route] ?? [], request.url).toContain(key);
    if (!['q', 'limit', 'offset'].includes(key)) assertFilter(schemas[resource], key);
  }
  if (route.endsWith('/search')) expect(params).toHaveProperty('q');
}

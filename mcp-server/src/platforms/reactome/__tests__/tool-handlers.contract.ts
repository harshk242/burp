import axios from 'axios';
import { afterAll, describe, expect, it } from 'vitest';
import { createReactomeClient, initClient, resetClient } from '../client.js';
import { handlers, SEARCH_TYPES } from '../handlers.js';
import { tools } from '../tools.js';
import { pace, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants } from './tool-args.js';
import { assertReactomeRequest, parameters } from './request-contract.js';

const transport = axios.getAdapter(axios.defaults.adapter);
afterAll(resetClient);
async function invoke(name: string, args: Record<string, unknown>): Promise<any> {
  let calls = 0;
  initClient({}, { adapter: async config => {
    await pace(350);
    const recorder = requestRecorder();
    await recorder.adapter(config);
    assertReactomeRequest(recorder.requests[0]);
    calls++;
    const response = await transport(config);
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    expect(response.status).toBe(200);
    if (config.url === '/search/query') {
      for (const group of data.results ?? []) {
        expect(group.typeName).toBe(config.params.types);
        for (const row of group.entries) {
          if (config.params.species) expect(row.species).toContain(config.params.species);
        }
      }
    }
    return response;
  } });
  try {
    const result: any = await handlers[name](args);
    expect(calls).toBeGreaterThan(0);
    if (name === 'search_pathways') {
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.length).toBeLessThanOrEqual(Number(args.size ?? 20));
      result.results.forEach((row: any) => expect(row.type).toBe(args.type ?? 'Pathway'));
    }
    if (name === 'find_pathways_by_gene') {
      expect(result.pathways.length).toBeGreaterThan(0);
      expect(result.protein.species).toBe(args.species ?? 'Homo sapiens');
    }
    if (name === 'find_pathways_by_disease') {
      expect(result.pathways.length).toBeGreaterThan(0);
      expect(result.pathways.length).toBeLessThanOrEqual(Number(args.size ?? 25));
      result.pathways.forEach((row: any) => expect(row.type).toBe('Pathway'));
    }
    if (name === 'get_pathway_participants' || name === 'get_pathway_details') {
      expect(result.participants.length).toBeGreaterThan(0);
      result.participants.forEach((row: any) => {
        expect(['Pathway', 'Reaction']).not.toContain(row.type ?? row.schemaClass);
        expect(row.type ?? row.schemaClass).toBeTruthy();
      });
    }
    if (name === 'get_pathway_reactions') {
      expect(result.reactions.length).toBeGreaterThan(0);
      result.reactions.forEach((row: any) => expect(['Reaction', 'BlackBoxEvent', 'Polymerisation', 'Depolymerisation']).toContain(row.type));
    }
    if (name === 'get_pathway_hierarchy') {
      expect(result.ancestors.length).toBeGreaterThan(0);
      expect(result.children.length).toBeGreaterThan(0);
    }
    if (name === 'get_protein_interactions') {
      expect(result.proteins.length).toBeGreaterThan(0);
      expect(result.interactionCount).toBeGreaterThan(0);
      expect(result.basicInfo.species).toBe('Homo sapiens');
      const ids = result.proteins.map((p: any) => p.identifier);
      result.interactions.forEach((pair: any) => {
        expect(ids).toContain(pair.source);
        expect(ids).toContain(pair.target);
        expect(pair.name).not.toMatch(/<[^>]*>/);
      });
    }
    return result;
  } finally { resetClient(); }
}
it('compares the allowlist with the live spec and exact facets', async () => {
  const http = createReactomeClient();
  await pace(350);
  const spec = (await http.get('/v3/api-docs')).data;
  for (const [route, saved] of Object.entries(parameters)) {
    const live = spec.paths[route].get.parameters.map(({ name, schema, required, ...p }: any) => ({ name, in: p.in, required, schema }));
    expect(live, route).toEqual(saved.get.parameters);
  }
  await pace(350);
  const facets = (await http.get('/search/facet_query', { params: { query: 'TP53' } })).data;
  const names = facets.typeFacet.available.map((f: any) => f.name);
  SEARCH_TYPES.forEach(type => expect(names).toContain(type));
});
describe.each(tools)('$name live handler', tool => {
  it.each(argVariants(tool))('$label returns the expected entity kind', async ({ args }) => { await invoke(tool.name, args); }, 120_000);
});
it('type filters change results rather than being silently ignored', async () => {
  const results = [];
  for (const type of SEARCH_TYPES) results.push(await invoke('search_pathways', { query: 'TP53', type, size: 3 }));
  expect(new Set(results.map(r => r.totalResults)).size).toBe(SEARCH_TYPES.length);
  expect(new Set(results.map(r => r.results[0].id)).size).toBe(SEARCH_TYPES.length);
});
it('species changes the selected protein and pathways', async () => {
  const human = await invoke('find_pathways_by_gene', { gene: 'TP53', species: 'Homo sapiens' });
  const mouse = await invoke('find_pathways_by_gene', { gene: 'TP53', species: 'Mus musculus' });
  expect(human.protein.id).not.toBe(mouse.protein.id);
  expect(human.pathways.map((p: any) => p.id)).not.toEqual(mouse.pathways.map((p: any) => p.id));
});
it('resolves a pathway name through the real handler', async () => {
  const result = await invoke('get_pathway_participants', { id: 'Depolymerization of the Nuclear Lamina' });
  expect(result.pathwayId).toBe('R-HSA-4419969');
});

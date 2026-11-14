import { describe, expect, it } from 'vitest';
import { initClient, resetClient } from '../client.js';
import { platform } from '../index.js';
import { assertArgsAffectRequests, assertHandlerCoverage, assertMakesRequest, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants, samples } from './tool-args.js';
import { assertPubChemRequest } from './request-contract.js';
const fixture = { IdentifierList: { CID: [2244, 3672, 1983] },
  PropertyTable: { Properties: [{ CID: 2244, ConnectivitySMILES: 'CCO', SMILES: 'CCO' }] } };
async function capture(name: string, args: Record<string, unknown>) {
  const recorder = requestRecorder(structuredClone(fixture));
  initClient({}, { adapter: recorder.adapter });
  try { expect(JSON.stringify(await platform.handlers[name](args))).not.toMatch(/not (yet )?implemented/i); }
  finally { resetClient(); }
  assertMakesRequest(recorder.requests);
  recorder.requests.forEach(assertPubChemRequest);
  return recorder.requests;
}
it('registers only implemented tools', () => {
  expect(platform.tools).toHaveLength(11);
  assertHandlerCoverage(platform.tools, platform.handlers);
});
describe.each(platform.tools)('$name requests', tool => {
  it.each(argVariants(tool))('$label follows PUG-REST grammar', async ({ args }) => { await capture(tool.name, args); });
  it('uses every argument and enum value', async () => {
    const reasons: Record<string, string> = {};
    for (const [key, prop] of Object.entries(tool.inputSchema.properties ?? {})) {
      if ((prop as { enum?: unknown[] }).enum) reasons[key] = 'Generic suffix is outside the enum; valid enum requests compared below.';
    }
    if (tool.name === 'search_compounds') reasons.max_records = 'Limits IDs locally; populated response check below.';
    await assertArgsAffectRequests(tool, samples, args => capture(tool.name, args), reasons);
    const base = await capture(tool.name, argVariants(tool)[0].args);
    for (const variant of argVariants(tool).slice(1, -1)) expect(await capture(tool.name, variant.args), variant.label).not.toEqual(base);
  });
});
it('applies max_records locally before retrieving details', async () => {
  for (const limit of [1, 2]) {
    const recorder = requestRecorder(structuredClone(fixture));
    initClient({}, { adapter: recorder.adapter });
    try {
      expect(await platform.handlers.search_compounds({ query: 'aspirin', max_records: limit })).toMatchObject({ total_found: limit });
      expect(recorder.requests[1].url).toContain(`/cid/${[2244, 3672].slice(0, limit).join(',')}/`);
    } finally { resetClient(); }
  }
});
it('normalizes both current SMILES property names', async () => {
  for (const name of ['search_compounds', 'search_by_smiles', 'get_compound_properties', 'analyze_stereochemistry', 'batch_compound_lookup']) {
    initClient({}, { adapter: requestRecorder(structuredClone(fixture)).adapter });
    try {
      const result = await platform.handlers[name]({ ...samples, properties: ['CanonicalSMILES', 'IsomericSMILES'] });
      expect(JSON.stringify(result)).toContain('"CanonicalSMILES":"CCO"');
      expect(JSON.stringify(result)).toContain('"IsomericSMILES":"CCO"');
    } finally { resetClient(); }
  }
});
it('honors zero similarity threshold and processes all batch IDs', async () => {
  const req = await capture('search_similar_compounds', { smiles: 'CCO', threshold: 0, max_records: 2 });
  expect(req[0].params).toMatchObject({ Threshold: 0 });
  expect(await capture('batch_compound_lookup', { cids: Array.from({ length: 11 }, (_, i) => i + 1) })).toHaveLength(11);
});
it('rejects unsupported properties and unknown request parameters', async () => {
  await expect(platform.handlers.get_compound_properties({ cid: 2244, properties: ['bogus'] })).rejects.toThrow();
  expect(() => assertPubChemRequest({ method: 'get', url: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/JSON', params: { bogus: 1 }, body: {} })).toThrow();
});

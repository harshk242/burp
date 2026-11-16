import { describe, expect, it } from 'vitest';
import { init, resetClient } from '../client.js';
import { platform } from '../index.js';
import { assertArgsAffectRequests, assertHandlerCoverage, assertMakesRequest, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants, samplesFor } from './tool-args.js';
import { assertChemblRequest } from './request-contract.js';

const molecule = { molecule_chembl_id: 'CHEMBL25', max_phase: 4,
  molecule_structures: { canonical_smiles: 'CCO', standard_inchi: 'InChI=ethanol', molfile: 'ethanol molfile' },
  molecule_properties: { full_mwt: 180, alogp: 1.3 } };
async function capture(name: string, args: Record<string, unknown>) {
  const recorder = requestRecorder({ ...molecule, molecules: [molecule], activities: [], drug_indications: [] });
  init({}, { adapter: recorder.adapter });
  try { await platform.handlers[name]!(args); } finally { resetClient(); }
  assertMakesRequest(recorder.requests);
  recorder.requests.forEach(assertChemblRequest);
  return recorder.requests;
}
it('has one handler for every advertised tool', () => assertHandlerCoverage(platform.tools, platform.handlers));
describe.each(platform.tools)('$name requests', tool => {
  it.each(argVariants(tool))('$label uses supported parameters', async ({ args }) => { await capture(tool.name, args); });
  it('uses every argument and enum value', async () => {
    const reasons: Record<string, string> = {};
    if (tool.name === 'get_compound_structure') reasons.format = 'JSON formats select fields locally; SDF uses its own endpoint. Output checked below.';
    if (tool.name === 'search_similar_compounds') reasons.similarity = 'Generic +1 mutation exceeds the 0–1 domain; valid alternative checked below.';
    if (tool.name === 'search_drugs') reasons.development_phase = 'Generic string mutation is outside enum; all valid phases checked below.';
    await assertArgsAffectRequests(tool, samplesFor(tool), args => capture(tool.name, args), reasons);
    if (reasons.similarity) {
      const args = argVariants(tool)[0]!.args;
      expect(await capture(tool.name, { ...args, similarity: 0.8 })).not.toEqual(await capture(tool.name, args));
    }
    if (reasons.development_phase) {
      const requests = [];
      for (const variant of argVariants(tool)) requests.push(await capture(tool.name, variant.args));
      expect(new Set(requests.map(r => JSON.stringify(r))).size).toBe(requests.length);
    }
  });
});
it('selects the requested structure field from a populated molecule', async () => {
  init({}, { adapter: requestRecorder(molecule).adapter });
  try {
    for (const [format, structure] of [['smiles', 'CCO'], ['inchi', 'InChI=ethanol'], ['molfile', 'ethanol molfile']]) {
      expect(await platform.handlers.get_compound_structure!({ chembl_id: 'CHEMBL25', format }))
        .toMatchObject({ requested_format: format, structure });
    }
  } finally { resetClient(); }
});
it('rejects unknown parameters even when the upstream would ignore them', () => {
  expect(() => assertChemblRequest({ method: 'get', url: 'https://www.ebi.ac.uk/chembl/api/data/drug_indication.json',
    params: { q: 'asthma' }, body: {} })).toThrow();
});

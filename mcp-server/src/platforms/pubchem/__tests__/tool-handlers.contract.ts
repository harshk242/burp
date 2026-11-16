import axios from 'axios';
import { afterAll, describe, expect, it } from 'vitest';
import { initClient, resetClient } from '../client.js';
import { platform } from '../index.js';
import { pace, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants } from './tool-args.js';
import { assertPubChemRequest } from './request-contract.js';
const transport = axios.getAdapter(axios.defaults.adapter);
afterAll(resetClient);
const renamed: Record<string, string> = { CanonicalSMILES: 'ConnectivitySMILES', IsomericSMILES: 'SMILES' };
function assertData(path: string[], data: any) {
  if (path.at(-1) !== 'JSON' && path.at(-1) !== 'description') {
    expect(typeof data).toBe('string');
    expect(data.length).toBeGreaterThan(100);
    const markers: Record<string, string> = { sdf: 'V2000', xml: '<PC-Compounds', asnt: 'PC-Compounds ::=', asnb: 'M' };
    expect(data).toContain(markers[path.at(-1)!]);
  } else if (path.includes('property')) {
    expect(data.PropertyTable.Properties.length).toBeGreaterThan(0);
    for (const row of data.PropertyTable.Properties) {
      expect(row.CID).toBeGreaterThan(0);
      for (const property of path[path.indexOf('property') + 1]!.split(',')) {
        expect(row[renamed[property] ?? property] ?? row[property], property).toBeDefined();
        if (property.includes('SMILES')) expect(row[renamed[property] ?? property] ?? row[property]).toBeTruthy();
      }
    }
  } else if (path.includes('cids')) expect(data.IdentifierList.CID.length).toBeGreaterThan(0);
  else if (path.includes('synonyms')) expect(data.InformationList.Information[0].Synonym.length).toBeGreaterThan(0);
  else if (path.includes('classification')) expect(data.Hierarchies.Hierarchy.length).toBeGreaterThan(0);
  else if (path[0] === 'assay') expect(data.PC_AssayContainer[0].assay.descr.aid.id).toBe(Number(path[2]));
  else if (path.includes('description')) expect(data.InformationList.Information[0].Title).toBeTruthy();
  else expect(data.PC_Compounds[0].id.id.cid).toBe(Number(path[2]));
}
async function invoke(name: string, args: Record<string, unknown>) {
  const failures: unknown[] = [];
  let calls = 0;
  initClient({}, { adapter: async config => {
    await pace(300); // Every transport call, including follow-ups, stays below 5 req/s.
    try {
      const recorder = requestRecorder();
      await recorder.adapter(config);
      const request = recorder.requests[0]!;
      assertPubChemRequest(request);
      calls++;
      const response = await transport(config);
      expect(response.status).toBe(200);
      const path = new URL(request.url).pathname.replace('/rest/pug/', '').split('/').filter(Boolean);
      const json = path.at(-1) === 'JSON' || path.at(-1) === 'description';
      const data = json && typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      assertData(path, data);
      if (path.includes('fastsimilarity_2d')) {
        expect(data.IdentifierList.CID).toContain(2244);
        expect(data.IdentifierList.CID.length).toBeLessThanOrEqual(Number(config.params.MaxRecords));
      }
      return response;
    } catch (error) { failures.push(error); throw error; }
  } });
  try {
    const result: any = await platform.handlers[name]!(args);
    expect(failures).toEqual([]);
    expect(calls).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/not (yet )?implemented/i);
    if (name === 'search_compounds') {
      expect(result.total_found).toBeGreaterThan(0);
      expect(result.total_found).toBeLessThanOrEqual(Number(args.max_records ?? 100));
      expect(result.details.PropertyTable.Properties[0].CanonicalSMILES).toBeTruthy();
    }
    if (name === 'search_by_smiles') expect(result.details.PropertyTable.Properties[0].CanonicalSMILES).toBeTruthy();
    if (name === 'analyze_stereochemistry') expect(result.stereochemistry.PropertyTable.Properties[0].IsomericSMILES).toBeTruthy();
    if (name === 'batch_compound_lookup') {
      expect(result.batch_results).toHaveLength((args.cids as number[]).length);
      expect(result.batch_results.every((row: any) => row.success)).toBe(true);
    }
    return result;
  } finally { resetClient(); }
}
describe.each(platform.tools)('$name live handler', tool => {
  it.each(argVariants(tool))('$label returns requested data', async ({ args }) => { await invoke(tool.name, args); });
});
it('similarity MaxRecords changes the number of results', async () => {
  const args = { smiles: 'CC(=O)Oc1ccccc1C(=O)O', threshold: 95 };
  const a = await invoke('search_similar_compounds', { ...args, max_records: 1 });
  const b = await invoke('search_similar_compounds', { ...args, max_records: 3 });
  expect(a.IdentifierList.CID).toHaveLength(1);
  expect(b.IdentifierList.CID).toHaveLength(3);
});
it('similarity threshold changes the returned neighbors', async () => {
  const args = { smiles: 'CC(=O)Oc1ccccc1C(=O)O', max_records: 3 };
  const a = await invoke('search_similar_compounds', { ...args, threshold: 90 });
  const b = await invoke('search_similar_compounds', { ...args, threshold: 100 });
  expect(a.IdentifierList.CID).not.toEqual(b.IdentifierList.CID);
});

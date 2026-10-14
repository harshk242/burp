import type { AxiosAdapter } from 'axios';
import { expect, it } from 'vitest';
import { init } from '../client.js';
import { handlers } from '../tools/drugs.js';
import { callTool, stubAdapter, toolText } from '../../../shared/__tests__/retry-test-utils.js';

it('surfaces an indication-fetch failure after a successful molecule lookup', async () => {
  const { adapter, calls } = stubAdapter([200, 503]);
  init({}, { adapter });
  const result = await callTool(handlers, 'get_drug_info', { chembl_id: 'CHEMBL25' });
  expect(calls.map((call) => call.url)).toEqual(['/molecule/CHEMBL25.json', '/drug_indication.json']);
  expect(result.isError).toBe(true);
  expect(JSON.parse(toolText(result))).toMatchObject({ error: 'upstream_unavailable', platform: 'chembl', status: 503 });
});

it('returns a genuine empty indication list as a success', async () => {
  const adapter: AxiosAdapter = async (config) => ({ data: config.url?.includes('drug_indication') ? { drug_indications: [] } : { max_phase: 4 }, status: 200, statusText: 'OK', headers: {}, config });
  init({}, { adapter });
  expect(await handlers.get_drug_info({ chembl_id: 'CHEMBL25' })).toMatchObject({ development_phase: 4, indications: [] });
});

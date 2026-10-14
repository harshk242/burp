import type { AxiosAdapter } from 'axios';
import { expect, it, vi } from 'vitest';
import { initClient } from '../client.js';
import { handleGetSimilarStudies } from '../tools/advanced-handlers.js';

function setup(names?: string[]) {
  const reference = { protocolSection: {
    identificationModule: { nctId: 'NCT00000001', briefTitle: 'A title unrelated to interventions' },
    statusModule: { overallStatus: 'COMPLETED' },
    ...(names ? { armsInterventionsModule: { interventions: names.map((name) => ({ name })) } } : {}),
  } };
  const adapter = vi.fn<AxiosAdapter>(async (config) => ({ data: { studies: [reference] }, status: 200, statusText: 'OK', headers: {}, config }));
  initClient({}, { adapter });
  return adapter;
}

it('searches intervention names with query.intr and excludes the reference study', async () => {
  const adapter = setup(['Drug A', 'Drug B', 'Drug A']);
  const result = await handleGetSimilarStudies({ nctId: 'NCT00000001', similarityType: 'INTERVENTION' });
  expect(adapter.mock.calls[1][0].params).toMatchObject({ 'query.intr': '"Drug A" OR "Drug B"' });
  expect(adapter.mock.calls[1][0].params).not.toHaveProperty('query.term');
  expect(result).toMatchObject({ similarStudies: [] });
});

it.each([undefined, [], ['  ']])('fails explicitly when no intervention names are available (%j)', async (names) => {
  const adapter = setup(names);
  await expect(handleGetSimilarStudies({ nctId: 'NCT00000001', similarityType: 'INTERVENTION' })).rejects.toThrow('no intervention names');
  expect(adapter).toHaveBeenCalledTimes(1);
});

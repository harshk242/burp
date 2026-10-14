import type { AxiosAdapter } from 'axios';
import { expect, it, vi } from 'vitest';
import { initializeClient } from '../client.js';
import { getTargetLiteratureOccurrences } from '../tools/target/associations.js';

it('projects literature rows without truncating the cached GraphQL response', async () => {
  const data = { target: { id: 'ENSG1', literatureOcurrences: { count: 3, rows: [{ pmid: '1' }, { pmid: '2' }, { pmid: '3' }] } } };
  Object.freeze(data.target.literatureOcurrences.rows);
  Object.freeze(data.target.literatureOcurrences);
  const adapter = vi.fn<AxiosAdapter>(async (config) => ({ data: { data }, status: 200, statusText: 'OK', headers: {}, config }));
  initializeClient({ adapter });
  const small = await getTargetLiteratureOccurrences('ENSG1', undefined, undefined, undefined, undefined, undefined, undefined, 1);
  const large = await getTargetLiteratureOccurrences('ENSG1', undefined, undefined, undefined, undefined, undefined, undefined, 3);
  expect(small).toMatchObject({ target: { literatureOcurrences: { count: 3, rows: [{ pmid: '1' }] } } });
  expect(large).toEqual(data);
  expect(data.target.literatureOcurrences.rows).toHaveLength(3);
  expect(await getTargetLiteratureOccurrences('ENSG1', undefined, undefined, undefined, undefined, undefined, undefined, 0)).toEqual(data);
  expect(adapter).toHaveBeenCalledTimes(1);
});

import axios from 'axios';
import { afterAll, describe, expect, it } from 'vitest';
import { closeClient, createPubMedHttp, initializeClient } from '../client.js';
import { platform } from '../index.js';
import { assertNcbiFieldsMatch, paceNcbi } from '../../__test-utils__/ncbi.js';
import { requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants } from './tool-args.js';
import { assertPubmedRequest, assertSearchAccepted, fields } from './request-contract.js';

const transport = axios.getAdapter(axios.defaults.adapter);
afterAll(closeClient);
async function invoke(name: string, args: Record<string, unknown>) {
  let requests = 0;
  initializeClient({ adapter: async config => {
    await paceNcbi();
    requests++;
    const recorder = requestRecorder();
    await recorder.adapter(config);
    assertPubmedRequest(recorder.requests[0]);
    const response = await transport(config);
    if (config.url?.includes('esearch')) assertSearchAccepted(response.data, String(config.params.term));
    return response;
  } });
  try {
    const result = await platform.handlers[name](args);
    expect(requests).toBeGreaterThan(0);
    expect(result).toBeDefined();
    return result;
  } finally { closeClient(); }
}
it('matches the saved PubMed einfo field list including additions', async () => {
  await paceNcbi();
  const response = await createPubMedHttp().get('einfo.fcgi', {
    params: { db: 'pubmed', retmode: 'json', ...(process.env.NCBI_API_KEY ? { api_key: process.env.NCBI_API_KEY } : {}) },
  });
  assertNcbiFieldsMatch(response.data.einforesult.dbinfo[0].fieldlist, fields);
});
describe.each(platform.tools)('$name live handler', tool => {
  it.each(argVariants(tool))('$label is accepted without warnings or ignored fields', async ({ args }) => {
    const result = await invoke(tool.name, args);
    if (tool.name.startsWith('search_')) expect((result as { count: number }).count).toBeGreaterThan(0);
    if (['fetch_article_details', 'get_article_summary'].includes(tool.name)) expect(result).not.toBeNull();
  });
});
it('each friendly sort changes the ordered search results', async () => {
  const results: string[][] = [];
  for (const sort of ['relevance', 'date', 'first_author', 'journal']) {
    const result = await invoke('search_pubmed', { query: 'cancer', max_results: 10, sort }) as { pmids: string[] };
    expect(result.pmids).toHaveLength(10);
    results.push(result.pmids);
  }
  expect(new Set(results.map(ids => ids.join(','))).size).toBe(4);
});
it('publication date bounds narrow journal and advanced searches', async () => {
  for (const [name, base, dates] of [
    ['search_by_journal', { journal_name: 'Nature', max_results: 5 }, { min_date: '2020/01/01', max_date: '2020/12/31' }],
    ['search_with_filters', { query: 'cancer', max_results: 5 }, { date_start: '2020/01/01', date_end: '2020/12/31' }],
  ] as const) {
    const all = await invoke(name, base) as { count: number; pmids: string[] };
    const limited = await invoke(name, { ...base, ...dates }) as typeof all;
    expect(limited.count).toBeGreaterThan(0);
    expect(limited.count).toBeLessThan(all.count);
    expect(limited.pmids).not.toEqual(all.pmids);
  }
});

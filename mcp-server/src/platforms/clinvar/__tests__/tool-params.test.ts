import { describe, expect, it, vi } from 'vitest';
import { initializeClient, closeClient } from '../client.js';
import { platform } from '../index.js';
import { TokenBucketRateLimiter } from '../../../shared/rate-limiter.js';
import { assertArgsAffectRequests, assertHandlerCoverage, assertMakesRequest, requestRecorder, type RecordedRequest } from '../../__test-utils__/tool-requests.js';
import { argVariants, samples } from './tool-args.js';
import { assertNcbiRequest } from './request-contract.js';

// Populated search response ensures the handlers' follow-up summary requests run.
async function capture(name: string, args: Record<string, unknown>) {
  const requests: RecordedRequest[] = [];
  const rateLimiter = new TokenBucketRateLimiter({ requestsPerSecond: 1000 });
  vi.spyOn(rateLimiter, 'waitForToken').mockResolvedValue();
  initializeClient({ rateLimiter, adapter: async config => {
    const id = String(config.params.id ?? '17661');
    const response = config.url?.includes('esearch')
      ? '<eSearchResult><Count>1</Count><IdList><Id>17661</Id></IdList></eSearchResult>'
      : config.url?.includes('efetch') ? '<ClinVarResult-Set><set/></ClinVarResult-Set>'
      : config.params.retmode === 'json' ? JSON.stringify({ result: { [id]: { variation_set: [] } } })
      : '<eSummaryResult><DocumentSummarySet><DocumentSummary uid="17661"><title>TP53 variant</title></DocumentSummary></DocumentSummarySet></eSummaryResult>';
    const recorder = requestRecorder(response);
    const result = await recorder.adapter(config);
    requests.push(...recorder.requests);
    return result;
  } });
  try { await platform.handlers[name](args); } finally { closeClient(); }
  assertMakesRequest(requests);
  return requests;
}
it('has a handler for every advertised tool', () => assertHandlerCoverage(platform.tools, platform.handlers));
describe.each(platform.tools)('$name requests', tool => {
  it.each(argVariants(tool))('$label uses valid fields and parameters', async ({ args }) => {
    for (const request of await capture(tool.name, args)) assertNcbiRequest(request);
  });
  it('uses every argument and enum value', async () => {
    const normalized = Object.fromEntries(['variation_id', 'rs_id']
      .filter(key => key in (tool.inputSchema.properties ?? {}))
      .map(key => [key, 'Identifier normalization strips nonnumeric suffixes; valid numeric alternatives checked below.']));
    await assertArgsAffectRequests(tool, samples, args => capture(tool.name, args), normalized);
    for (const key of Object.keys(normalized)) {
      const args = argVariants(tool)[0].args;
      expect(await capture(tool.name, { ...args, [key]: key === 'rs_id' ? 'rs28934578' : '12375' }))
        .not.toEqual(await capture(tool.name, args));
    }
  });
});
it('searches coordinates on GRCh38 and expands splice sites into indexed consequences', async () => {
  const coords = await capture('lookup_by_coordinates', { chromosome: '17', start: 7676154 });
  expect((coords[0].params as Record<string, unknown>).term).toBe('17[chr] AND 7676154[cpos]');
  const splice = await capture('search_by_molecular_consequence', { consequence: 'splice site variant' });
  expect((splice[0].params as Record<string, unknown>).term)
    .toBe('("splice donor variant"[mcns] OR "splice acceptor variant"[mcns])');
});

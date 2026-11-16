import { describe, expect, it, vi } from 'vitest';
import { initializeClient, closeClient } from '../client.js';
import { platform } from '../index.js';
import { TokenBucketRateLimiter } from '../../../shared/rate-limiter.js';
import { assertArgsAffectRequests, assertHandlerCoverage, assertMakesRequest, requestRecorder, type RecordedRequest } from '../../__test-utils__/tool-requests.js';
import { argVariants, samples } from './tool-args.js';
import { assertPubmedRequest } from './request-contract.js';

const article = '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>28485846</PMID><Article><ArticleTitle>Example study</ArticleTitle><Abstract><AbstractText>Study abstract.</AbstractText></Abstract><AuthorList><Author><LastName>Smith</LastName><ForeName>John</ForeName><Initials>J</Initials></Author></AuthorList><Journal><Title>Nature</Title><JournalIssue><PubDate><Year>2020</Year></PubDate></JournalIssue></Journal></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>';
async function capture(name: string, args: Record<string, unknown>) {
  const requests: RecordedRequest[] = [];
  const rateLimiter = new TokenBucketRateLimiter({ requestsPerSecond: 1000 });
  vi.spyOn(rateLimiter, 'waitForToken').mockResolvedValue();
  initializeClient({ rateLimiter, adapter: async config => {
    const response = config.url?.includes('esearch')
      ? '<eSearchResult><Count>3</Count><IdList><Id>28485846</Id></IdList></eSearchResult>'
      : config.url?.includes('efetch') ? article
      : config.url?.includes('elink') ? `<eLinkResult><LinkSet><DbFrom>pubmed</DbFrom><LinkSetDb><DbTo>pubmed</DbTo><LinkName>${config.params.linkname}</LinkName>${[1, 2, 3, 4].map(id => `<Link><Id>${id}</Id></Link>`).join('')}</LinkSetDb></LinkSet></eLinkResult>`
      : '<eSummaryResult><DocSum><Id>28485846</Id><Item Name="Title" Type="String">Example study</Item></DocSum></eSummaryResult>';
    const recorder = requestRecorder(response);
    const result = await recorder.adapter(config);
    requests.push(...recorder.requests);
    return result;
  } });
  try {
    const result = await platform.handlers[name]!(args);
    assertMakesRequest(requests);
    return { requests, result };
  } finally { closeClient(); }
}
it('has a handler for every advertised tool', () => assertHandlerCoverage(platform.tools, platform.handlers));
describe.each(platform.tools)('$name requests', tool => {
  it.each(argVariants(tool))('$label uses valid fields and parameters', async ({ args }) => {
    for (const request of (await capture(tool.name, args)).requests) assertPubmedRequest(request);
  });
  it('uses every argument and enum value', async () => {
    const local: Record<string, string> = {};
    if (tool.name === 'batch_fetch_articles') local.include_abstracts = 'Abstracts are stripped locally; populated output tested below.';
    if (['find_related_articles', 'get_citations', 'get_references'].includes(tool.name)) local.max_results = 'ELink has no limit; output slicing tested below.';
    if (tool.name === 'format_citation') local.style = 'Local citation formatting; every style tested below.';
    if ('pmid' in (tool.inputSchema.properties ?? {})) local.pmid = 'Numeric normalization; valid alternative tested separately.';
    await assertArgsAffectRequests(tool, samples, async args => (await capture(tool.name, args)).requests, local);
    if (local.pmid) {
      const args = argVariants(tool)[0]!.args;
      expect((await capture(tool.name, { ...args, pmid: '31452104' })).requests)
        .not.toEqual((await capture(tool.name, args)).requests);
    }
  });
});
it.each([
  ['find_related_articles', 'relatedIds'], ['get_citations', 'citingArticles'], ['get_references', 'references'],
])('%s applies its limit to populated links', async (name, key) => {
  for (const limit of [1, 2, 3]) {
    const { result } = await capture(name, { pmid: samples.pmid, max_results: limit });
    expect(result).toMatchObject({ [key]: ['1', '2', '3'].slice(0, limit), count: 4 });
  }
});
it('strips abstracts only when requested', async () => {
  const args = { pmids: [samples.pmid] };
  const yes = (await capture('batch_fetch_articles', { ...args, include_abstracts: true })).result as any;
  const no = (await capture('batch_fetch_articles', { ...args, include_abstracts: false })).result as any;
  expect(yes.articles[0].abstract).toBe('Study abstract.');
  expect(no.articles[0].abstract).toBeUndefined();
  expect(no.found).toBe(1);
});
it('formats every citation style distinctly', async () => {
  const citations: string[] = [];
  for (const style of ['apa', 'mla', 'vancouver', 'bibtex']) {
    const { result } = await capture('format_citation', { pmid: samples.pmid, style });
    citations.push((result as { citation: string }).citation);
  }
  expect(new Set(citations).size).toBe(4);
  expect(citations[3]).toContain('@article{Smith2020');
});
it.each(['date_start', 'date_end'])('honors a lone %s publication bound', async key => {
  const { requests } = await capture('search_with_filters', { query: 'cancer', [key]: samples[key] });
  expect((requests[0]!.params as any).term).toContain(samples[key]);
  expect((requests[0]!.params as any).term).toContain('[Date - Publication]');
});
it('requests counts without IDs for publication trends', async () => {
  const { requests } = await capture('get_publication_trends', { query: 'cancer', start_year: 2024, end_year: 2025 });
  expect(requests).toHaveLength(2);
  for (const request of requests) expect((request.params as any).retmax).toBe(0);
});
it.each(['search_pubmed', 'search_with_filters', 'search_by_author', 'search_by_journal', 'search_clinical_trials_literature'])(
  '%s lists titles for its hits and points to the reader tool', async (name) => {
    const args = argVariants(platform.tools.find((t) => t.name === name)!)[0]!.args;
    const { requests, result } = await capture(name, args);
    expect(requests.map((r) => new URL(r.url).pathname.split('/').pop())).toEqual(['esearch.fcgi', 'esummary.fcgi']);
    expect(result).toMatchObject({
      pmids: ['28485846'],
      articles: [{ pmid: '28485846', title: 'Example study', publicationTypes: [] }],
      next_step: expect.stringContaining('batch_fetch_articles'),
    });
  });
it('skips the summary call when a search has no hits', async () => {
  const requests: RecordedRequest[] = [];
  const rateLimiter = new TokenBucketRateLimiter({ requestsPerSecond: 1000 });
  vi.spyOn(rateLimiter, 'waitForToken').mockResolvedValue();
  initializeClient({ rateLimiter, adapter: async config => {
    const recorder = requestRecorder('<eSearchResult><Count>0</Count><IdList></IdList></eSearchResult>');
    const response = await recorder.adapter(config);
    requests.push(...recorder.requests);
    return response;
  } });
  try {
    expect(await platform.handlers.search_pubmed!({ query: 'nothing' })).toMatchObject({ count: 0, articles: [] });
    expect(requests).toHaveLength(1);
  } finally { closeClient(); }
});
it('returns compact readings from batch_fetch_articles', async () => {
  const { result } = await capture('batch_fetch_articles', { pmids: [samples.pmid] });
  expect((result as any).articles[0]).toEqual({
    pmid: '28485846', title: 'Example study', journal: 'Nature', pubDate: '2020',
    publicationTypes: [], authors: ['Smith J'], authorCount: 1, abstract: 'Study abstract.',
  });
});

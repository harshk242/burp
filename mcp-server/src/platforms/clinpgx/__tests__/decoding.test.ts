import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { PharmGKBClient, initializeClient, closeClient } from '../client.js';
import { parseGeneInfo, parseDrugInfo, parseVariantInfo, parseClinicalAnnotation, parseDosingGuideline, parseDrugLabel, parsePathway } from '../response-parsers.js';
import { decodeEnvelope } from '../response-decoding.js';
import { fetchDatabaseStats } from '../database-stats.js';
import { getCPICGenesWithGuidelines, getGenesWithAnnotations } from '../tools/genes.js';
import { platform } from '../index.js';

function adapterFor(data: unknown) {
  return vi.fn<AxiosAdapter>(async config => ({ data, config, status: 200, statusText: 'OK', headers: {} }));
}
afterEach(closeClient);

describe('ClinPGx boundary decoding', () => {
  it.each([null, {}, { data: [], total: '1' }, { data: [], total: -1 }])('rejects malformed envelopes %j', value => {
    expect(() => decodeEnvelope(value)).toThrow();
  });
  it.each([parseGeneInfo, parseDrugInfo, parseVariantInfo, parseClinicalAnnotation, parseDosingGuideline, parseDrugLabel, parsePathway])('requires endpoint record identifiers', parse => {
    expect(() => parse({})).toThrow();
    expect(() => parse('invalid')).toThrow();
  });
  it('requires gene symbol and drug name rather than returning undefined', () => {
    expect(() => parseGeneInfo({ id: 'PA1' })).toThrow('gene symbol');
    expect(() => parseDrugInfo({ id: 'PA1' })).toThrow('drug name');
    expect(() => parseClinicalAnnotation({ id: '1' })).toThrow('annotation gene');
  });
  it('normalizes singleton arrays and validates their records', async () => {
    const client = new PharmGKBClient({ adapter: adapterFor({ data: { id: 'PA1', symbol: 'CYP2D6', alternateSymbols: 'CYP', crossReferences: { resource: 'HGNC', resourceId: '1' } }, total: 0 }) });
    expect(await client.searchGenes('CYP2D6')).toMatchObject({ totalCount: 0, results: [{ alternateSymbols: ['CYP'], crossReferences: [{ database: 'HGNC', id: '1' }] }] });
    expect(() => parseGeneInfo({ id: 'PA1', symbol: 'CYP', crossReferences: 'invalid' })).toThrow();
    expect(() => parseGeneInfo({ id: 'PA1', symbol: 'CYP', hasGuideline: 'yes' })).toThrow();
    expect(parseClinicalAnnotation({ id: '1', genes: { symbol: 'CYP' }, relatedChemicals: { name: 'drug' }, types: 'efficacy', literature: { pmid: 123 } })).toMatchObject({ gene: 'CYP', drug: 'drug', pmids: ['123'] });
  });
  it('propagates malformed search records instead of returning absence', async () => {
    await expect(new PharmGKBClient({ adapter: adapterFor({ data: 'bad' }) }).searchGenes('CYP')).rejects.toThrow();
  });
});

describe('CPIC listing and symbol search', () => {
  it('trims a symbol once for upstream params, cache keys, and returned query', async () => {
    const adapter = adapterFor({ data: [{ id: 'PA1', symbol: 'CYP' }] });
    const client = new PharmGKBClient({ adapter });
    expect((await client.searchGenes(' CYP ')).query).toBe('CYP');
    await client.searchGenes('CYP');
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(adapter.mock.calls[0][0].params).toEqual({ symbol: 'CYP' });
  });
  it('rejects blank search without making an upstream CPIC request', async () => {
    const adapter = adapterFor({ data: [] });
    await expect(new PharmGKBClient({ adapter }).searchGenes('  ')).rejects.toThrow('blank');
    expect(adapter).not.toHaveBeenCalled();
  });
  it('lists CPIC genes explicitly and filters guidelines under an honest helper name', async () => {
    const adapter = adapterFor({ data: [{ id: 'PA1', symbol: 'CYP', hasGuideline: true }, { id: 'PA2', symbol: 'TEST', hasClinicalAnnotation: true }] });
    initializeClient({ adapter });
    expect((await getCPICGenesWithGuidelines()).map(gene => gene.symbol)).toEqual(['CYP']);
    expect((await getGenesWithAnnotations()).map(gene => gene.symbol)).toEqual(['TEST']);
    expect(adapter.mock.calls[0][0].params).toEqual({ cpicGene: true });
    expect(platform.tools.some(tool => tool.name === 'list_cpic_genes')).toBe(true);
  });
});

describe('scoped sample counts', () => {
  it('distinguishes returned sample size, legitimate empty data, failed requests, and unsupported counts', async () => {
    const result = await fetchDatabaseStats(async endpoint => {
      if (endpoint === '/data/gene') return { data: [{ id: 'PA1' }], total: 1000 };
      if (endpoint === '/data/clinicalAnnotation') throw new Error('unavailable');
      if (endpoint === '/data/labelAnnotation') return { bad: [] };
      return { data: [] };
    });
    expect(result.genes).toMatchObject({ status: 'available', count: 1 });
    expect(result.pathways).toMatchObject({ status: 'available', count: 0 });
    expect(result.clinicalAnnotations).toMatchObject({ status: 'failed', error: { message: 'unavailable' } });
    expect(result.labels.status).toBe('failed');
    expect(result.drugs.status).toBe('unsupported');
    expect(result.variants.status).toBe('unsupported');
    expect(result.clinicalAnnotations).not.toHaveProperty('count');
    expect(platform.tools.find(tool => tool.name === 'get_database_stats')?.description).toContain('scoped sample');
  });
});

describe('ClinPGx current upstream record shapes', () => {
  it('decodes guideline boolean recommendation as availability, separately from recommendation text', () => {
    expect(parseDosingGuideline({ id: 'PA1', name: 'DPWG guideline', recommendation: true, relatedGenes: { symbol: 'CYP' }, relatedChemicals: { name: 'drug' } })).toMatchObject({ hasRecommendation: true, recommendation: undefined, genes: ['CYP'], drugs: ['drug'] });
    expect(parseDosingGuideline({ id: 'PA1', name: 'CPIC guideline', recommendation: 'Reduce dose' })).toMatchObject({ recommendation: 'Reduce dose', hasRecommendation: undefined });
  });
  it('decodes label chemicals/genes and pathway HTML descriptions', () => {
    expect(parseDrugLabel({ id: 'PA1', name: 'label', source: 'FDA', relatedChemicals: [{ name: 'warfarin' }], relatedGenes: [{ symbol: 'CYP2C9' }] })).toMatchObject({ drug: 'warfarin', genes: ['CYP2C9'] });
    expect(parsePathway({ id: 'PA1', name: 'pathway', description: { html: '<p>Description</p>' } }).description).toBe('<p>Description</p>');
    expect(() => parsePathway({ id: 'PA1', name: 'pathway', description: { html: [] } })).toThrow();
  });
});

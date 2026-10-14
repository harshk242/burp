import { decodeEnvelope, list, record } from './response-decoding.js';
import { UpstreamError } from '../../shared/exceptions.js';

type SampleCount =
  | { status: 'available'; scope: string; count: number }
  | { status: 'failed'; scope: string; error: { message: string; kind?: string; status?: number | null } }
  | { status: 'unsupported'; scope: string };

export async function fetchDatabaseStats(
  request: (endpoint: string, params?: Record<string, unknown>) => Promise<unknown>
): Promise<Record<string, SampleCount>> {
  async function sample(endpoint: string, params: Record<string, unknown>, scope: string): Promise<SampleCount> {
    try {
      const data = list(decodeEnvelope(await request(endpoint, params)).data);
      data.forEach(record);
      return { status: 'available', scope, count: data.length };
    } catch (error) {
      return { status: 'failed', scope, error: {
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof UpstreamError ? { kind: error.kind, status: error.status } : {}),
      } };
    }
  }
  const [genes, pathways, clinicalAnnotations, guidelines, labels] = await Promise.all([
    sample('/data/gene', { cpicGene: true }, 'Returned CPIC gene records'),
    sample('/data/pathway', { cpicGene: true }, 'Returned pathways matching cpicGene=true'),
    sample('/data/clinicalAnnotation', { 'location.genes.symbol': 'CYP2D6' }, 'Returned CYP2D6 clinical annotations'),
    sample('/data/guidelineAnnotation', { 'relatedGenes.symbol': 'CYP2D6' }, 'Returned CYP2D6 guidelines'),
    sample('/data/labelAnnotation', { 'relatedGenes.symbol': 'CYP2D6' }, 'Returned CYP2D6 labels'),
  ]);
  return { genes, pathways, clinicalAnnotations, guidelines, labels,
    drugs: { status: 'unsupported', scope: 'Drug counts are not queried' },
    variants: { status: 'unsupported', scope: 'Variant counts are not queried' },
  };
}

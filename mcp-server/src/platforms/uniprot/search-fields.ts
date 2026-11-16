import { XMLBuilder } from 'fast-xml-parser';
import { getClient } from './client.js';

// Verified against /configure/uniprotkb/result-fields. JSON still includes nested
// evidence and lineage for these fields, so project again before returning it.
export const SEARCH_FIELDS = 'accession,id,reviewed,protein_name,gene_names,organism_name,organism_id,length,annotation_score,cc_function';
export const SEARCH_SIZE_SCHEMA = {
  type: 'integer', minimum: 1, maximum: 100, default: 10,
  description: 'Number of summaries (1-100, default: 10).',
};
export const REVIEWED_SCHEMA = {
  type: 'boolean', default: true,
  description: 'Reviewed (Swiss-Prot) entries by default; set false to search unreviewed (TrEMBL) entries instead.',
};

export function quoteQuery(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function searchSize(value: unknown): number {
  if (value === undefined) return 10;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('size must be an integer between 1 and 100');
  }
  return value;
}

export function reviewedQuery(args: Record<string, unknown>): string {
  if (args.reviewed !== undefined && typeof args.reviewed !== 'boolean') {
    throw new Error('reviewed must be a boolean');
  }
  return `reviewed:${args.reviewed !== false}`;
}

function snippet(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

export function summarizeSearch(data: any) {
  return {
    results: (data.results ?? []).map((entry: any) => ({
      accession: entry.primaryAccession,
      entryId: entry.uniProtkbId,
      reviewed: entry.entryType === 'UniProtKB reviewed (Swiss-Prot)',
      proteinName: snippet(
        entry.proteinDescription?.recommendedName?.fullName?.value
          ?? entry.proteinDescription?.submissionNames?.[0]?.fullName?.value
          ?? entry.proteinDescription?.alternativeNames?.[0]?.fullName?.value, 300),
      geneNames: [...new Set<string>((entry.genes ?? []).flatMap((gene: any) =>
        [gene.geneName, ...(gene.synonyms ?? []), ...(gene.orderedLocusNames ?? []), ...(gene.orfNames ?? [])]
          .map((name: any) => name?.value).filter(Boolean)))].slice(0, 20),
      organism: entry.organism?.scientificName,
      taxonId: entry.organism?.taxonId,
      length: entry.sequence?.length,
      annotationScore: entry.annotationScore,
      function: snippet(entry.comments?.find((c: any) => c.commentType === 'FUNCTION')
        ?.texts?.[0]?.value, 300),
    })),
  };
}

export async function searchSummaries(query: string, size: unknown, format = 'json') {
  const boundedSize = searchSize(size);
  if (!['json', 'tsv', 'fasta', 'xml'].includes(format)) throw new Error('Unsupported search format');
  // UniProt ignores fields for XML. Build summary XML from the projected JSON
  // instead; TSV supports fields, and FASTA needs sequences rather than summaries.
  const response = await getClient().get('/uniprotkb/search', {
    params: {
      query, size: format === 'fasta' ? Math.min(boundedSize, 10) : boundedSize,
      format: format === 'xml' ? 'json' : format,
      ...(format === 'fasta' ? {} : {
        fields: format === 'tsv' ? SEARCH_FIELDS.replace(',cc_function', '') : SEARCH_FIELDS,
      }),
    },
  });
  if (format === 'xml') {
    return new XMLBuilder({ format: false }).build({ search: summarizeSearch(response.data) });
  }
  return format === 'json' ? summarizeSearch(response.data) : String(response.data);
}

import { XMLBuilder } from 'fast-xml-parser';
import { getClient } from './client.js';
import type { UniProtEntry, UniProtSearchResponse } from './entry-types.js';

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

// A query that already constrains `reviewed:` wins over the default filter;
// adding ours would AND two contradictory terms and always return nothing.
export function reviewedQuery(args: Record<string, unknown>): string;
export function reviewedQuery(args: Record<string, unknown>, userQuery: string | undefined): string | undefined;
export function reviewedQuery(args: Record<string, unknown>, userQuery?: string): string | undefined {
  if (args.reviewed !== undefined && typeof args.reviewed !== 'boolean') {
    throw new Error('reviewed must be a boolean');
  }
  if (userQuery && /(^|[^A-Za-z0-9_])reviewed\s*:/i.test(userQuery)) return undefined;
  return `reviewed:${args.reviewed !== false}`;
}

export function andQuery(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' AND ');
}

export const UNREVIEWED_HINT = 'No reviewed (Swiss-Prot) entries matched; retry with reviewed: false to search unreviewed (TrEMBL) entries.';

function snippet(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

function summarizeEntry(entry: UniProtEntry) {
  return {
    accession: entry.primaryAccession,
    entryId: entry.uniProtkbId,
    reviewed: entry.entryType === 'UniProtKB reviewed (Swiss-Prot)',
    proteinName: snippet(
      entry.proteinDescription?.recommendedName?.fullName?.value
        ?? entry.proteinDescription?.submissionNames?.[0]?.fullName?.value
        ?? entry.proteinDescription?.alternativeNames?.[0]?.fullName?.value, 300),
    geneNames: [...new Set((entry.genes ?? []).flatMap((gene) =>
      [gene.geneName, ...(gene.synonyms ?? []), ...(gene.orderedLocusNames ?? []), ...(gene.orfNames ?? [])]
        .flatMap((name) => name?.value ? [name.value] : [])))].slice(0, 20),
    organism: entry.organism?.scientificName,
    taxonId: entry.organism?.taxonId,
    length: entry.sequence?.length,
    annotationScore: entry.annotationScore,
    function: snippet(entry.comments?.find((c) => c.commentType === 'FUNCTION')
      ?.texts?.[0]?.value, 300),
  };
}

export type UniProtSearchSummary = ReturnType<typeof summarizeEntry>;

export function summarizeSearch(data: UniProtSearchResponse, totalResults?: number): {
  totalResults?: number; results: UniProtSearchSummary[]; hint?: string;
} {
  return {
    ...(totalResults === undefined ? {} : { totalResults }),
    results: (data.results ?? []).map(summarizeEntry),
  };
}

// UniProt reports the full hit count in X-Total-Results; without it the agent
// cannot tell whether a page of summaries is complete.
export function totalResultsHeader(headers: Record<string, unknown> | undefined): number | undefined {
  const raw = headers?.['x-total-results'];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const total = Number(raw);
  return Number.isInteger(total) && total >= 0 ? total : undefined;
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
  if (format !== 'json' && format !== 'xml') return String(response.data);
  const summary = summarizeSearch(response.data, totalResultsHeader(response.headers));
  if (summary.results.length === 0 && /(^|[^A-Za-z0-9_])reviewed:true\b/i.test(query)) summary.hint = UNREVIEWED_HINT;
  if (format === 'xml') {
    const { results, ...rest } = summary;
    return new XMLBuilder({ format: false }).build({ search: { ...rest, results: { entry: results } } });
  }
  return summary;
}

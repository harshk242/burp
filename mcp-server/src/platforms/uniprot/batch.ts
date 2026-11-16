import { getClient } from './client.js';
import { SEARCH_FIELDS, summarizeSearch } from './search-fields.js';

// UniProt's documented accession pattern (https://www.uniprot.org/help/accession_numbers)
// plus an optional isoform suffix such as P04637-2.
export const ACCESSION_PATTERN =
  /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/;
export const MAX_BATCH = 25;
export const MAX_FASTA_BATCH = 10;
const TSV_FIELDS = SEARCH_FIELDS.replace(',cc_function', '');

export function normalizeAccession(value: string): string {
  return value.trim().toUpperCase();
}

interface InactiveReason { inactiveReasonType?: string; mergeDemergeTo?: string[] }

// /uniprotkb/accessions accepts lowercase input and isoforms, but rejects the
// whole request on one malformed accession (so callers validate first) and
// silently omits inactive (merged, demerged or deleted) accessions.
async function fetchAccessions(accessions: string[], format: string, fields?: string) {
  const response = await getClient().get('/uniprotkb/accessions', {
    params: { accessions: accessions.join(','), format, ...(fields ? { fields } : {}) },
  });
  return response.data;
}

// The search endpoint returns stub entries for inactive accessions, including
// what they were merged or demerged into.
async function fetchInactive(accessions: string[]): Promise<Map<string, InactiveReason>> {
  const inactive = new Map<string, InactiveReason>();
  if (accessions.length === 0) return inactive;
  const response = await getClient().get('/uniprotkb/search', {
    params: {
      query: accessions.map(accession => `accession:${accession}`).join(' OR '),
      fields: 'accession', format: 'json', size: accessions.length,
    },
  });
  for (const entry of response.data?.results ?? []) {
    if (entry.entryType === 'Inactive' && entry.primaryAccession) {
      inactive.set(String(entry.primaryAccession).toUpperCase(), entry.inactiveReason ?? {});
    }
  }
  return inactive;
}

async function summaries(accessions: string[]): Promise<Map<string, any>> {
  const found = new Map<string, any>();
  if (accessions.length === 0) return found;
  for (const summary of summarizeSearch(await fetchAccessions(accessions, 'json', SEARCH_FIELDS)).results) {
    if (summary.accession) found.set(String(summary.accession).toUpperCase(), summary);
  }
  return found;
}

function inactiveResult(accession: string, reason: InactiveReason) {
  const type = reason.inactiveReasonType ?? 'UNKNOWN';
  const replacedBy = reason.mergeDemergeTo ?? [];
  return {
    accession, success: false, inactiveReason: type, ...(replacedBy.length ? { replacedBy } : {}),
    error: replacedBy.length
      ? `Inactive accession (${type.toLowerCase()} into ${replacedBy.join(', ')}); look up the replacement accession(s).`
      : `Inactive accession (${type.toLowerCase()}); the entry is obsolete.`,
  };
}

export async function batchLookup(accessions: unknown, format = 'json') {
  if (
    !Array.isArray(accessions) || accessions.length === 0 || accessions.length > MAX_BATCH ||
    !accessions.every((a: unknown) => typeof a === 'string' && a.trim().length > 0)
  ) {
    throw new Error(`batch_protein_lookup: accessions must be an array of 1-${MAX_BATCH} non-empty strings`);
  }
  if (!['json', 'tsv', 'fasta'].includes(format)) throw new Error('Unsupported batch format');
  if (format === 'fasta' && accessions.length > MAX_FASTA_BATCH) {
    throw new Error(`FASTA batches are limited to ${MAX_FASTA_BATCH} accessions`);
  }
  const inputs = accessions as string[];
  const normalized = inputs.map(normalizeAccession);
  const invalid = inputs.filter((_, i) => !ACCESSION_PATTERN.test(normalized[i]));
  const valid = [...new Set(normalized.filter(accession => ACCESSION_PATTERN.test(accession)))];

  if (format !== 'json') {
    if (invalid.length) {
      throw new Error(`batch_protein_lookup: invalid UniProt accession(s): ${invalid.join(', ')}. Remove them, or use format json for per-accession errors.`);
    }
    return String(await fetchAccessions(valid, format, format === 'tsv' ? TSV_FIELDS : undefined));
  }

  const found = await summaries(valid);
  // Isoform suffixes are not inactive entries; only canonical accessions can be merged.
  const inactive = await fetchInactive(valid.filter(accession => !found.has(accession) && !accession.includes('-')));
  // An accession merged into exactly one entry resolves to that entry's summary.
  const targets = [...new Set([...inactive.values()]
    .filter(reason => reason.inactiveReasonType === 'MERGED' && reason.mergeDemergeTo?.length === 1)
    .map(reason => reason.mergeDemergeTo![0].toUpperCase()))]
    .filter(target => ACCESSION_PATTERN.test(target) && !found.has(target));
  for (const [accession, summary] of await summaries(targets)) found.set(accession, summary);

  return { batchResults: inputs.map((input, i) => {
    const accession = normalized[i];
    if (!ACCESSION_PATTERN.test(accession)) {
      return { accession: input, success: false, error: 'Invalid UniProt accession format' };
    }
    if (found.has(accession)) return { accession: input, success: true, data: found.get(accession) };
    const reason = inactive.get(accession);
    if (!reason) return { accession: input, success: false, error: 'Accession not found in UniProtKB' };
    const target = reason.inactiveReasonType === 'MERGED' && reason.mergeDemergeTo?.length === 1
      ? found.get(reason.mergeDemergeTo[0].toUpperCase()) : undefined;
    return target
      ? { accession: input, success: true, mergedInto: target.accession, data: target }
      : inactiveResult(input, reason);
  }) };
}

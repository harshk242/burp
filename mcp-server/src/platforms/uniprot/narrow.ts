// Narrowing for UniProtKB REST JSON. Each reader checks the fields the tools read
// (entry-types.ts) and passes every other field through untouched, in its original
// key order, since handlers return entries and sub-records as UniProt sent them.

import { asArray, asRecord, isRecord, optNumber, optRecord, optString, stringArray, type JsonRecord } from '../../shared/json.js';
import type {
  UniProtComment, UniProtCrossReference, UniProtEntry, UniProtEvidence, UniProtFeature,
  UniProtGene, UniProtProteinName, UniProtReference, UniProtSearchResponse, UniProtValue,
} from './entry-types.js';

/**
 * `source` with each field of `narrowed` written over it, keeping the source's key order. A field
 * narrowed to `undefined` (absent, or the wrong type upstream) is removed; other fields pass through.
 */
export function overlay<T extends object>(source: JsonRecord, narrowed: T): JsonRecord & T {
  const result = Object.assign({ ...source }, narrowed);
  const fields: JsonRecord = result;
  for (const [key, value] of Object.entries(narrowed)) {
    if (value === undefined) delete fields[key];
  }
  return result;
}

/** The parsed elements of an array (elements that do not parse are dropped), or `undefined` for a non-array. */
function list<T>(value: unknown, parse: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return asArray(value).map(parse).filter((item): item is T => item !== undefined);
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? stringArray(value) : undefined;
}

function counts(value: unknown): Record<string, number> | undefined {
  const record = optRecord(value);
  return record && Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

function textValue(value: unknown): UniProtValue | undefined {
  const record = optRecord(value);
  return record && overlay(record, { value: optString(record.value) });
}

function evidence(value: unknown): UniProtEvidence | undefined {
  const record = optRecord(value);
  return record && overlay(record, { evidenceCode: optString(record.evidenceCode) });
}

function feature(value: unknown): UniProtFeature | undefined {
  const record = optRecord(value);
  const type = optString(record?.type);
  if (!record || type === undefined) return undefined;
  return overlay(record, {
    type, description: optString(record.description), evidences: list(record.evidences, evidence),
  });
}

function comment(value: unknown): UniProtComment | undefined {
  const record = optRecord(value);
  const commentType = optString(record?.commentType);
  if (!record || commentType === undefined) return undefined;
  const disease = optRecord(record.disease);
  return overlay(record, {
    commentType,
    disease: disease && overlay(disease, { acronym: optString(disease.acronym) }),
    texts: list(record.texts, textValue),
  });
}

function crossReference(value: unknown): UniProtCrossReference | undefined {
  const record = optRecord(value);
  const database = optString(record?.database);
  const id = optString(record?.id);
  if (!record || database === undefined || id === undefined) return undefined;
  return overlay(record, { database, id });
}

function reference(value: unknown): UniProtReference | undefined {
  const record = optRecord(value);
  if (!record) return undefined;
  const citation = optRecord(record.citation);
  return overlay(record, {
    citation: citation && overlay(citation, {
      citationCrossReferences: list(citation.citationCrossReferences, crossReference),
    }),
  });
}

function gene(value: unknown): UniProtGene | undefined {
  const record = optRecord(value);
  return record && overlay(record, {
    geneName: textValue(record.geneName),
    synonyms: list(record.synonyms, textValue),
    orderedLocusNames: list(record.orderedLocusNames, textValue),
    orfNames: list(record.orfNames, textValue),
  });
}

function proteinName(value: unknown): UniProtProteinName | undefined {
  const record = optRecord(value);
  return record && overlay(record, { fullName: textValue(record.fullName) });
}

function proteinDescription(value: unknown): UniProtEntry['proteinDescription'] {
  const record = optRecord(value);
  return record && overlay(record, {
    recommendedName: proteinName(record.recommendedName),
    submissionNames: list(record.submissionNames, proteinName),
    alternativeNames: list(record.alternativeNames, proteinName),
  });
}

function organism(value: unknown): UniProtEntry['organism'] {
  const record = optRecord(value);
  return record && overlay(record, {
    scientificName: optString(record.scientificName),
    commonName: optString(record.commonName),
    taxonId: optNumber(record.taxonId),
    lineage: strings(record.lineage),
  });
}

function sequence(value: unknown): UniProtEntry['sequence'] {
  const record = optRecord(value);
  return record && overlay(record, {
    value: optString(record.value), length: optNumber(record.length), molWeight: optNumber(record.molWeight),
  });
}

/** A UniProtKB entry; a non-object reads as an entry with no fields. */
export function toUniProtEntry(value: unknown): UniProtEntry {
  const record = asRecord(value);
  const extraAttributes = optRecord(record.extraAttributes);
  return overlay(record, {
    primaryAccession: optString(record.primaryAccession),
    uniProtkbId: optString(record.uniProtkbId),
    entryType: optString(record.entryType),
    proteinExistence: optString(record.proteinExistence),
    annotationScore: optNumber(record.annotationScore),
    proteinDescription: proteinDescription(record.proteinDescription),
    genes: list(record.genes, gene),
    organism: organism(record.organism),
    sequence: sequence(record.sequence),
    features: list(record.features, feature),
    comments: list(record.comments, comment),
    keywords: Array.isArray(record.keywords) ? asArray(record.keywords) : undefined,
    references: list(record.references, reference),
    uniProtKBCrossReferences: list(record.uniProtKBCrossReferences, crossReference),
    extraAttributes: extraAttributes && overlay(extraAttributes, {
      countByFeatureType: counts(extraAttributes.countByFeatureType),
    }),
  });
}

/** The features of an array; malformed elements are dropped. */
export function toFeatures(value: unknown): UniProtFeature[] {
  return list(value, feature) ?? [];
}

/** A /uniprotkb/search (or /uniprotkb/accessions) JSON body. */
export function toSearchResponse(value: unknown): UniProtSearchResponse {
  const record = asRecord(value);
  return overlay(record, {
    results: list(record.results, (item) => (isRecord(item) ? toUniProtEntry(item) : undefined)),
  });
}

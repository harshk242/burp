import type { AuthorInfo } from './types.js';
import { ensureArray, extractText } from './utils.js';
import { XMLParseError } from './exceptions.js';
import { isRecord, type JsonRecord } from '../../shared/json.js';

function record(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new XMLParseError('Invalid PubMed author element');
  }
  return value;
}

export function decodeAuthors(value: unknown): AuthorInfo[] {
  return ensureArray(value).flatMap((list) => {
    const authors = record(list).Author;
    return ensureArray(authors).map((value): AuthorInfo => {
      const author = record(value);
      const affiliations = ensureArray(author.AffiliationInfo)
        .map((info) => extractText(record(info).Affiliation))
        .filter(Boolean);
      const orcid = ensureArray(author.Identifier)
        .map(record)
        .find((identifier) => identifier['@_Source'] === 'ORCID');
      return {
        lastName: extractText(author.LastName),
        foreName: extractText(author.ForeName),
        initials: extractText(author.Initials),
        collectiveName: extractText(author.CollectiveName),
        affiliation: affiliations.length ? affiliations.join('; ') : undefined,
        orcid: orcid ? extractText(orcid) : undefined,
      };
    });
  });
}

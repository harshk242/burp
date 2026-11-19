import { XMLParser } from 'fast-xml-parser';
import { decodeAuthors } from './author-decoder.js';
import { XMLParseError } from './exceptions.js';
import { ensureArray, extractText } from './utils.js';
import { asRecord, optRecord, optText, path, recordList, type JsonRecord } from '../../shared/json.js';
import type {
  ESearchResult,
  ArticleSummary,
  PubMedArticle,
  MeshTerm,
  Grant,
  LinkResult,
  SummaryListItem,
  SummaryStructure,
} from './types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  isArray: (name) => {
    // Note: IdList is NOT included because there's only one per response
    // and including it causes IdList?.Id to fail (becomes array[0].Id)
    const arrayElements = [
      'Id', 'Item', 'Author',
      'ArticleId', 'MeshHeading', 'Keyword', 'Grant',
      'PublicationType', 'Link', 'LinkSet', 'Translation'
    ];
    return arrayElements.includes(name);
  },
});

// Markup characters must stay escaped or the decoded text would be parsed as XML.
const MARKUP_REFERENCES: Record<number, string> = { 34: '&quot;', 38: '&amp;', 39: '&apos;', 60: '&lt;', 62: '&gt;' };

/**
 * PubMed encodes non-ASCII as numeric references (A&#x3b2;, &#x2212;0.45). Decode them before
 * parsing so abstracts read as text and quoted numbers match the source. The parser's own
 * `htmlEntities` option counts each reference against its 1000-expansion entity-bomb limit,
 * which a 20-abstract EFetch batch exceeds.
 */
export function decodeCharacterReferences(xml: string): string {
  return xml.replace(/&#(x[0-9a-fA-F]{1,6}|[0-9]{1,7});/g, (match, ref: string) => {
    const code = ref[0] === 'x' || ref[0] === 'X' ? parseInt(ref.slice(1), 16) : parseInt(ref, 10);
    if (MARKUP_REFERENCES[code]) return MARKUP_REFERENCES[code];
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  });
}

const parse = (xml: string): unknown => parser.parse(decodeCharacterReferences(xml));

export function parseESearchResult(xml: string): ESearchResult {
  try {
    const searchResult = optRecord(path(parse(xml), 'eSearchResult'));

    if (!searchResult) {
      throw new XMLParseError('Invalid ESearch response: missing eSearchResult');
    }

    const idList = path(searchResult, 'IdList', 'Id') || [];

    return {
      count: parseInt(optText(searchResult.Count) || '0', 10),
      retmax: parseInt(optText(searchResult.RetMax) || '0', 10),
      retstart: parseInt(optText(searchResult.RetStart) || '0', 10),
      idList: ensureArray(idList).map(String),
      translationSet: recordList(path(searchResult, 'TranslationSet', 'Translation')).map((t) => ({
        from: extractText(t.From),
        to: extractText(t.To),
      })),
      translationStack: recordList(path(searchResult, 'TranslationStack', 'TermSet')).map((ts) => ({
        term: extractText(ts.Term),
        field: extractText(ts.Field),
        count: parseInt(extractText(ts.Count) || '0', 10),
        explode: extractText(ts.Explode),
      })),
      queryTranslation: extractText(searchResult.QueryTranslation) || '',
    };
  } catch (error) {
    if (error instanceof XMLParseError) throw error;
    throw new XMLParseError(`Failed to parse ESearch response: ${error}`, xml);
  }
}

/** An ESummary item's value: text, a `Structure` of named texts, or a `List` of either. */
type SummaryValue = string | SummaryStructure | SummaryListItem[];

const summaryText = (value: SummaryValue | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

const summaryList = (value: SummaryValue | undefined): SummaryListItem[] | undefined =>
  Array.isArray(value) ? value : undefined;

const summaryTextList = (value: SummaryValue | undefined): string[] | undefined =>
  summaryList(value)?.filter((item): item is string => typeof item === 'string');

export function parseESummaryResult(xml: string): ArticleSummary[] {
  try {
    const summaryResult = asRecord(path(parse(xml), 'eSummaryResult'));
    const docSums = summaryResult.DocSum || path(summaryResult, 'DocumentSummarySet', 'DocumentSummary');

    return recordList(docSums).map((doc) => {
      const itemMap: Record<string, SummaryValue> = {};

      for (const item of recordList(doc.Item)) {
        const name = optText(item['@_Name']);
        if (name === undefined) continue;
        const type = item['@_Type'];

        if (type === 'List') {
          itemMap[name] = recordList(item.Item).map((subItem) => {
            if (subItem['@_Type'] === 'Structure') {
              return parseStructureItem(subItem);
            }
            return extractText(subItem);
          });
        } else if (type === 'Structure') {
          itemMap[name] = parseStructureItem(item);
        } else {
          itemMap[name] = extractText(item);
        }
      }

      const pmcRefCount = summaryText(itemMap.PmcRefCount);

      return {
        uid: extractText(ensureArray(doc.Id)[0]) || optText(doc['@_uid']) || '',
        pubdate: summaryText(itemMap.PubDate) || '',
        epubdate: summaryText(itemMap.EPubDate),
        source: summaryText(itemMap.Source) || '',
        authors: summaryTextList(itemMap.AuthorList) || [],
        lastauthor: summaryText(itemMap.LastAuthor),
        title: summaryText(itemMap.Title) || '',
        sorttitle: summaryText(itemMap.SortTitle),
        volume: summaryText(itemMap.Volume),
        issue: summaryText(itemMap.Issue),
        pages: summaryText(itemMap.Pages),
        lang: summaryTextList(itemMap.Lang),
        nlmuniqueid: summaryText(itemMap.NlmUniqueID),
        issn: summaryText(itemMap.ISSN),
        essn: summaryText(itemMap.ESSN),
        pubtype: summaryTextList(itemMap.PubTypeList),
        recordstatus: summaryText(itemMap.RecordStatus),
        pubstatus: summaryText(itemMap.PubStatus),
        articleids: summaryList(itemMap.ArticleIds),
        history: summaryList(itemMap.History),
        references: summaryList(itemMap.References),
        pmcrefcount: pmcRefCount ? parseInt(pmcRefCount, 10) : undefined,
        fulljournalname: summaryText(itemMap.FullJournalName),
        elocationid: summaryText(itemMap.ELocationID),
        sortpubdate: summaryText(itemMap.SortPubDate),
        sortfirstauthor: summaryText(itemMap.SortFirstAuthor),
      };
    });
  } catch (error) {
    if (error instanceof XMLParseError) throw error;
    throw new XMLParseError(`Failed to parse ESummary response: ${error}`, xml);
  }
}

function parseStructureItem(item: JsonRecord): SummaryStructure {
  const result: SummaryStructure = {};

  for (const subItem of recordList(item.Item)) {
    const name = optText(subItem['@_Name']);
    if (name !== undefined) result[name] = extractText(subItem);
  }

  return result;
}

export function parseEFetchResult(xml: string): PubMedArticle[] {
  try {
    const articles = recordList(path(parse(xml), 'PubmedArticleSet', 'PubmedArticle'));

    const parsedArticles: PubMedArticle[] = [];

    for (const article of articles) {
      const medlineCitation = optRecord(article.MedlineCitation);
      const articleData = optRecord(medlineCitation?.Article);
      const pubmedData = optRecord(article.PubmedData);

      if (!medlineCitation || !articleData) {
        continue;
      }

      const pmid = extractText(medlineCitation.PMID);

      const title = extractText(articleData.ArticleTitle);

      const abstractText = path(articleData, 'Abstract', 'AbstractText');
      let abstract: string | undefined;
      if (abstractText) {
        if (Array.isArray(abstractText)) {
          abstract = abstractText.map((at: unknown) => extractText(at)).join(' ');
        } else {
          abstract = extractText(abstractText);
        }
      }

      const authors = decodeAuthors(articleData.AuthorList);

      const journalData = optRecord(articleData.Journal);
      const journalIssue = optRecord(journalData?.JournalIssue);
      const pagination = optRecord(articleData.Pagination);
      const journal = {
        title: extractText(journalData?.Title) || extractText(journalData?.ISOAbbreviation),
        isoAbbreviation: extractText(journalData?.ISOAbbreviation),
        issn: extractText(journalData?.ISSN),
        volume: extractText(journalIssue?.Volume),
        issue: extractText(journalIssue?.Issue),
        pubDate: formatPubDate(optRecord(journalIssue?.PubDate)),
        pages: extractText(pagination?.MedlinePgn),
      };

      const meshList = recordList(path(medlineCitation, 'MeshHeadingList', 'MeshHeading'));
      const meshTerms: MeshTerm[] = meshList.map((mesh) => {
        const descriptorName = optRecord(mesh.DescriptorName);
        return {
          descriptorName: extractText(mesh.DescriptorName),
          qualifierName: mesh.QualifierName ? extractText(mesh.QualifierName) : undefined,
          majorTopic: descriptorName?.['@_MajorTopicYN'] === 'Y',
        };
      });

      const keywordList = path(medlineCitation, 'KeywordList', 'Keyword') || [];
      const keywords = ensureArray(keywordList).map((kw: unknown) => extractText(kw));

      const pubTypeList = path(articleData, 'PublicationTypeList', 'PublicationType') || [];
      const publicationTypes = ensureArray(pubTypeList).map((pt: unknown) => extractText(pt));

      const grantList = recordList(path(articleData, 'GrantList', 'Grant'));
      const grants: Grant[] = grantList.map((grant) => ({
        grantId: extractText(grant.GrantID),
        acronym: extractText(grant.Acronym),
        agency: extractText(grant.Agency),
        country: extractText(grant.Country),
      }));

      const articleIdList = recordList(path(pubmedData, 'ArticleIdList', 'ArticleId'));
      let doi: string | undefined;
      let pmcId: string | undefined;

      for (const id of articleIdList) {
        const idType = id['@_IdType'];
        const idValue = extractText(id);
        if (idType === 'doi') {
          doi = idValue;
        } else if (idType === 'pmc') {
          pmcId = idValue;
        }
      }

      const language = extractText(articleData.Language);

      parsedArticles.push({
        pmid,
        title,
        abstract,
        authors,
        journal,
        pubDate: journal.pubDate || '',
        doi,
        pmcId,
        meshTerms: meshTerms.length > 0 ? meshTerms : undefined,
        keywords: keywords.length > 0 ? keywords : undefined,
        publicationTypes: publicationTypes.length > 0 ? publicationTypes : undefined,
        grantList: grants.length > 0 ? grants : undefined,
        language,
      });
    }

    return parsedArticles;
  } catch (error) {
    if (error instanceof XMLParseError) throw error;
    throw new XMLParseError(`Failed to parse EFetch response: ${error}`, xml);
  }
}

function formatPubDate(pubDate: JsonRecord | undefined): string {
  if (!pubDate) return '';

  const year = extractText(pubDate.Year);
  const month = extractText(pubDate.Month);
  const day = extractText(pubDate.Day);
  const medlineDate = extractText(pubDate.MedlineDate);

  if (medlineDate) {
    return medlineDate;
  }

  if (year) {
    let dateStr = year;
    if (month) {
      dateStr += ` ${month}`;
      if (day) {
        dateStr += ` ${day}`;
      }
    }
    return dateStr;
  }

  return '';
}

export function parseELinkResult(xml: string): LinkResult {
  try {
    const linkSetObj = recordList(path(parse(xml), 'eLinkResult', 'LinkSet'))[0];

    if (!linkSetObj) {
      return {
        dbFrom: '',
        idList: [],
        linkSetDb: [],
      };
    }

    const idList = ensureArray(path(linkSetObj, 'IdList', 'Id') || []).map(String);
    const linkSetDbList = recordList(linkSetObj.LinkSetDb);

    return {
      dbFrom: extractText(linkSetObj.DbFrom) || 'pubmed',
      idList,
      linkSetDb: linkSetDbList.map((lsdb) => ({
        dbTo: extractText(lsdb.DbTo) || '',
        linkName: extractText(lsdb.LinkName) || '',
        link: recordList(lsdb.Link).map((link) => ({
          id: extractText(ensureArray(link.Id)[0]) || '',
          score: link.Score ? parseInt(extractText(link.Score), 10) : undefined,
        })),
      })),
    };
  } catch (error) {
    if (error instanceof XMLParseError) throw error;
    throw new XMLParseError(`Failed to parse ELink response: ${error}`, xml);
  }
}

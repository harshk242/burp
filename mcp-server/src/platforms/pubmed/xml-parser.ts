import { XMLParser } from 'fast-xml-parser';
import { decodeAuthors } from './author-decoder.js';
import { XMLParseError } from './exceptions.js';
import { ensureArray, extractText } from './utils.js';
import type {
  ESearchResult,
  ArticleSummary,
  PubMedArticle,
  MeshTerm,
  Grant,
  LinkResult,
  Author,
} from './types.js';

type AnyObject = Record<string, any>;

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

export function parseESearchResult(xml: string): ESearchResult {
  try {
    const result = parser.parse(xml);
    const searchResult = result.eSearchResult;

    if (!searchResult) {
      throw new XMLParseError('Invalid ESearch response: missing eSearchResult');
    }

    const idList = searchResult.IdList?.Id || [];

    return {
      count: parseInt(searchResult.Count || '0', 10),
      retmax: parseInt(searchResult.RetMax || '0', 10),
      retstart: parseInt(searchResult.RetStart || '0', 10),
      idList: ensureArray(idList).map(String),
      translationSet: ensureArray(searchResult.TranslationSet?.Translation || []).map((t: AnyObject) => ({
        from: extractText(t.From),
        to: extractText(t.To),
      })),
      translationStack: ensureArray(searchResult.TranslationStack?.TermSet || []).map((ts: AnyObject) => ({
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

export function parseESummaryResult(xml: string): ArticleSummary[] {
  try {
    const result = parser.parse(xml);
    const docSums = result.eSummaryResult?.DocSum || result.eSummaryResult?.DocumentSummarySet?.DocumentSummary || [];

    return ensureArray(docSums).map((doc: AnyObject) => {
      const items = ensureArray(doc.Item || []);
      const itemMap: AnyObject = {};

      for (const item of items) {
        const itemObj = item as AnyObject;
        const name = itemObj['@_Name'] as string;
        const type = itemObj['@_Type'] as string;

        if (type === 'List') {
          itemMap[name] = ensureArray(itemObj.Item || []).map((subItem: AnyObject) => {
            if (subItem['@_Type'] === 'Structure') {
              return parseStructureItem(subItem);
            }
            return extractText(subItem);
          });
        } else if (type === 'Structure') {
          itemMap[name] = parseStructureItem(itemObj);
        } else {
          itemMap[name] = extractText(item);
        }
      }

      return {
        uid: extractText(ensureArray(doc.Id)[0]) || doc['@_uid'] as string || '',
        pubdate: (itemMap.PubDate as string) || '',
        epubdate: itemMap.EPubDate as string,
        source: (itemMap.Source as string) || '',
        authors: (itemMap.AuthorList as Author[]) || [],
        lastauthor: itemMap.LastAuthor as string,
        title: (itemMap.Title as string) || '',
        sorttitle: itemMap.SortTitle as string,
        volume: itemMap.Volume as string,
        issue: itemMap.Issue as string,
        pages: itemMap.Pages as string,
        lang: itemMap.Lang as string[],
        nlmuniqueid: itemMap.NlmUniqueID as string,
        issn: itemMap.ISSN as string,
        essn: itemMap.ESSN as string,
        pubtype: itemMap.PubTypeList as string[],
        recordstatus: itemMap.RecordStatus as string,
        pubstatus: itemMap.PubStatus as string,
        articleids: itemMap.ArticleIds as { idtype: string; idtypen: number; value: string }[],
        history: itemMap.History as { pubstatus: string; date: string }[],
        references: itemMap.References as string[],
        pmcrefcount: itemMap.PmcRefCount ? parseInt(itemMap.PmcRefCount as string, 10) : undefined,
        fulljournalname: itemMap.FullJournalName as string,
        elocationid: itemMap.ELocationID as string,
        sortpubdate: itemMap.SortPubDate as string,
        sortfirstauthor: itemMap.SortFirstAuthor as string,
      };
    });
  } catch (error) {
    if (error instanceof XMLParseError) throw error;
    throw new XMLParseError(`Failed to parse ESummary response: ${error}`, xml);
  }
}

function parseStructureItem(item: AnyObject): AnyObject {
  const result: AnyObject = {};
  const subItems = ensureArray(item.Item || []);

  for (const subItem of subItems) {
    const subItemObj = subItem as AnyObject;
    const name = subItemObj['@_Name'] as string;
    result[name] = extractText(subItem);
  }

  return result;
}

export function parseEFetchResult(xml: string): PubMedArticle[] {
  try {
    const result = parser.parse(xml);
    const articles = result.PubmedArticleSet?.PubmedArticle || [];

    const parsedArticles: PubMedArticle[] = [];

    for (const article of ensureArray(articles)) {
      const articleObj = article as AnyObject;
      const medlineCitation = articleObj.MedlineCitation as AnyObject;
      const articleData = medlineCitation?.Article as AnyObject;
      const pubmedData = articleObj.PubmedData as AnyObject;

      if (!medlineCitation || !articleData) {
        continue;
      }

      const pmid = extractText(medlineCitation.PMID);

      const title = extractText(articleData.ArticleTitle);

      const abstractObj = articleData.Abstract as AnyObject | undefined;
      const abstractText = abstractObj?.AbstractText;
      let abstract: string | undefined;
      if (abstractText) {
        if (Array.isArray(abstractText)) {
          abstract = abstractText.map((at: unknown) => extractText(at)).join(' ');
        } else {
          abstract = extractText(abstractText);
        }
      }

      const authors = decodeAuthors(articleData.AuthorList);

      const journalData = articleData.Journal as AnyObject | undefined;
      const journalIssue = journalData?.JournalIssue as AnyObject | undefined;
      const pagination = articleData.Pagination as AnyObject | undefined;
      const journal = {
        title: extractText(journalData?.Title) || extractText(journalData?.ISOAbbreviation),
        isoAbbreviation: extractText(journalData?.ISOAbbreviation),
        issn: extractText(journalData?.ISSN),
        volume: extractText(journalIssue?.Volume),
        issue: extractText(journalIssue?.Issue),
        pubDate: formatPubDate(journalIssue?.PubDate as AnyObject | undefined),
        pages: extractText(pagination?.MedlinePgn),
      };

      const meshHeadingList = medlineCitation.MeshHeadingList as AnyObject | undefined;
      const meshList = meshHeadingList?.MeshHeading || [];
      const meshTerms: MeshTerm[] = ensureArray(meshList).map((mesh: AnyObject) => {
        const descriptorName = mesh.DescriptorName as AnyObject | undefined;
        return {
          descriptorName: extractText(mesh.DescriptorName),
          qualifierName: mesh.QualifierName ? extractText(mesh.QualifierName) : undefined,
          majorTopic: descriptorName?.['@_MajorTopicYN'] === 'Y',
        };
      });

      const keywordListObj = medlineCitation.KeywordList as AnyObject | undefined;
      const keywordList = keywordListObj?.Keyword || [];
      const keywords = ensureArray(keywordList).map((kw: unknown) => extractText(kw));

      const pubTypeListObj = articleData.PublicationTypeList as AnyObject | undefined;
      const pubTypeList = pubTypeListObj?.PublicationType || [];
      const publicationTypes = ensureArray(pubTypeList).map((pt: unknown) => extractText(pt));

      const grantListObj = articleData.GrantList as AnyObject | undefined;
      const grantList = grantListObj?.Grant || [];
      const grants: Grant[] = ensureArray(grantList).map((grant: AnyObject) => ({
        grantId: extractText(grant.GrantID),
        acronym: extractText(grant.Acronym),
        agency: extractText(grant.Agency),
        country: extractText(grant.Country),
      }));

      const articleIdListObj = pubmedData?.ArticleIdList as AnyObject | undefined;
      const articleIdList = articleIdListObj?.ArticleId || [];
      let doi: string | undefined;
      let pmcId: string | undefined;

      for (const id of ensureArray(articleIdList)) {
        const idObj = id as AnyObject;
        const idType = idObj['@_IdType'];
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

function formatPubDate(pubDate: AnyObject | undefined): string {
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
    const result = parser.parse(xml);
    const linkSet = result.eLinkResult?.LinkSet;

    if (!linkSet) {
      return {
        dbFrom: '',
        idList: [],
        linkSetDb: [],
      };
    }

    const linkSetObj = ensureArray(linkSet)[0] as AnyObject;
    const idListObj = linkSetObj.IdList as AnyObject | undefined;
    const idList = ensureArray(idListObj?.Id || []).map(String);
    const linkSetDbList = ensureArray(linkSetObj.LinkSetDb || []);

    return {
      dbFrom: extractText(linkSetObj.DbFrom) || 'pubmed',
      idList,
      linkSetDb: linkSetDbList.map((lsdb: AnyObject) => ({
        dbTo: extractText(lsdb.DbTo) || '',
        linkName: extractText(lsdb.LinkName) || '',
        link: ensureArray(lsdb.Link || []).map((link: AnyObject) => ({
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

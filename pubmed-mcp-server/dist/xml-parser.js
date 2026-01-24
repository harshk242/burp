// XML Parser for NCBI E-utilities responses
import { XMLParser } from 'fast-xml-parser';
import { XMLParseError } from './exceptions.js';
import { ensureArray, extractText } from './utils.js';
// Configure XML parser for NCBI responses
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true,
    trimValues: true,
    isArray: (name) => {
        // Force these elements to always be arrays
        const arrayElements = [
            'Id', 'IdList', 'Item', 'Author', 'AuthorList',
            'ArticleId', 'MeshHeading', 'Keyword', 'Grant',
            'PublicationType', 'Link', 'LinkSet'
        ];
        return arrayElements.includes(name);
    },
});
/**
 * Parse ESearch response
 */
export function parseESearchResult(xml) {
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
            translationSet: ensureArray(searchResult.TranslationSet?.Translation || []).map((t) => ({
                from: extractText(t.From),
                to: extractText(t.To),
            })),
            translationStack: ensureArray(searchResult.TranslationStack?.TermSet || []).map((ts) => ({
                term: extractText(ts.Term),
                field: extractText(ts.Field),
                count: parseInt(extractText(ts.Count) || '0', 10),
                explode: extractText(ts.Explode),
            })),
            queryTranslation: extractText(searchResult.QueryTranslation) || '',
        };
    }
    catch (error) {
        if (error instanceof XMLParseError)
            throw error;
        throw new XMLParseError(`Failed to parse ESearch response: ${error}`, xml);
    }
}
/**
 * Parse ESummary response
 */
export function parseESummaryResult(xml) {
    try {
        const result = parser.parse(xml);
        const docSums = result.eSummaryResult?.DocSum || result.eSummaryResult?.DocumentSummarySet?.DocumentSummary || [];
        return ensureArray(docSums).map((doc) => {
            const items = ensureArray(doc.Item || []);
            const itemMap = {};
            for (const item of items) {
                const itemObj = item;
                const name = itemObj['@_Name'];
                const type = itemObj['@_Type'];
                if (type === 'List') {
                    itemMap[name] = ensureArray(itemObj.Item || []).map((subItem) => {
                        if (subItem['@_Type'] === 'Structure') {
                            return parseStructureItem(subItem);
                        }
                        return extractText(subItem);
                    });
                }
                else if (type === 'Structure') {
                    itemMap[name] = parseStructureItem(itemObj);
                }
                else {
                    itemMap[name] = extractText(item);
                }
            }
            return {
                uid: extractText(doc.Id) || doc['@_uid'] || '',
                pubdate: itemMap.PubDate || '',
                epubdate: itemMap.EPubDate,
                source: itemMap.Source || '',
                authors: itemMap.AuthorList || [],
                lastauthor: itemMap.LastAuthor,
                title: itemMap.Title || '',
                sorttitle: itemMap.SortTitle,
                volume: itemMap.Volume,
                issue: itemMap.Issue,
                pages: itemMap.Pages,
                lang: itemMap.Lang,
                nlmuniqueid: itemMap.NlmUniqueID,
                issn: itemMap.ISSN,
                essn: itemMap.ESSN,
                pubtype: itemMap.PubTypeList,
                recordstatus: itemMap.RecordStatus,
                pubstatus: itemMap.PubStatus,
                articleids: itemMap.ArticleIds,
                history: itemMap.History,
                references: itemMap.References,
                pmcrefcount: itemMap.PmcRefCount ? parseInt(itemMap.PmcRefCount, 10) : undefined,
                fulljournalname: itemMap.FullJournalName,
                elocationid: itemMap.ELocationID,
                sortpubdate: itemMap.SortPubDate,
                sortfirstauthor: itemMap.SortFirstAuthor,
            };
        });
    }
    catch (error) {
        if (error instanceof XMLParseError)
            throw error;
        throw new XMLParseError(`Failed to parse ESummary response: ${error}`, xml);
    }
}
/**
 * Parse structure items from ESummary
 */
function parseStructureItem(item) {
    const result = {};
    const subItems = ensureArray(item.Item || []);
    for (const subItem of subItems) {
        const subItemObj = subItem;
        const name = subItemObj['@_Name'];
        result[name] = extractText(subItem);
    }
    return result;
}
/**
 * Parse EFetch (full article) response
 */
export function parseEFetchResult(xml) {
    try {
        const result = parser.parse(xml);
        const articles = result.PubmedArticleSet?.PubmedArticle || [];
        const parsedArticles = [];
        for (const article of ensureArray(articles)) {
            const articleObj = article;
            const medlineCitation = articleObj.MedlineCitation;
            const articleData = medlineCitation?.Article;
            const pubmedData = articleObj.PubmedData;
            if (!medlineCitation || !articleData) {
                continue;
            }
            // Extract PMID
            const pmid = extractText(medlineCitation.PMID);
            // Extract title
            const title = extractText(articleData.ArticleTitle);
            // Extract abstract
            const abstractObj = articleData.Abstract;
            const abstractText = abstractObj?.AbstractText;
            let abstract;
            if (abstractText) {
                if (Array.isArray(abstractText)) {
                    abstract = abstractText.map((at) => extractText(at)).join(' ');
                }
                else {
                    abstract = extractText(abstractText);
                }
            }
            // Extract authors
            const authorListObj = articleData.AuthorList;
            const authorList = authorListObj?.Author || [];
            const authors = ensureArray(authorList).map((author) => {
                const affiliationInfo = author.AffiliationInfo;
                const identifier = author.Identifier;
                return {
                    lastName: extractText(author.LastName),
                    foreName: extractText(author.ForeName),
                    initials: extractText(author.Initials),
                    affiliation: affiliationInfo ? extractText(affiliationInfo.Affiliation) : undefined,
                    orcid: identifier ? extractText(identifier['#text']) : undefined,
                    collectiveName: extractText(author.CollectiveName),
                };
            });
            // Extract journal info
            const journalData = articleData.Journal;
            const journalIssue = journalData?.JournalIssue;
            const pagination = articleData.Pagination;
            const journal = {
                title: extractText(journalData?.Title) || extractText(journalData?.ISOAbbreviation),
                isoAbbreviation: extractText(journalData?.ISOAbbreviation),
                issn: extractText(journalData?.ISSN),
                volume: extractText(journalIssue?.Volume),
                issue: extractText(journalIssue?.Issue),
                pubDate: formatPubDate(journalIssue?.PubDate),
                pages: extractText(pagination?.MedlinePgn),
            };
            // Extract MeSH terms
            const meshHeadingList = medlineCitation.MeshHeadingList;
            const meshList = meshHeadingList?.MeshHeading || [];
            const meshTerms = ensureArray(meshList).map((mesh) => {
                const descriptorName = mesh.DescriptorName;
                return {
                    descriptorName: extractText(mesh.DescriptorName),
                    qualifierName: mesh.QualifierName ? extractText(mesh.QualifierName) : undefined,
                    majorTopic: descriptorName?.['@_MajorTopicYN'] === 'Y',
                };
            });
            // Extract keywords
            const keywordListObj = medlineCitation.KeywordList;
            const keywordList = keywordListObj?.Keyword || [];
            const keywords = ensureArray(keywordList).map((kw) => extractText(kw));
            // Extract publication types
            const pubTypeListObj = articleData.PublicationTypeList;
            const pubTypeList = pubTypeListObj?.PublicationType || [];
            const publicationTypes = ensureArray(pubTypeList).map((pt) => extractText(pt));
            // Extract grants
            const grantListObj = articleData.GrantList;
            const grantList = grantListObj?.Grant || [];
            const grants = ensureArray(grantList).map((grant) => ({
                grantId: extractText(grant.GrantID),
                acronym: extractText(grant.Acronym),
                agency: extractText(grant.Agency),
                country: extractText(grant.Country),
            }));
            // Extract DOI and PMC ID from article IDs
            const articleIdListObj = pubmedData?.ArticleIdList;
            const articleIdList = articleIdListObj?.ArticleId || [];
            let doi;
            let pmcId;
            for (const id of ensureArray(articleIdList)) {
                const idObj = id;
                const idType = idObj['@_IdType'];
                const idValue = extractText(id);
                if (idType === 'doi') {
                    doi = idValue;
                }
                else if (idType === 'pmc') {
                    pmcId = idValue;
                }
            }
            // Extract language
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
    }
    catch (error) {
        if (error instanceof XMLParseError)
            throw error;
        throw new XMLParseError(`Failed to parse EFetch response: ${error}`, xml);
    }
}
/**
 * Format publication date from NCBI date structure
 */
function formatPubDate(pubDate) {
    if (!pubDate)
        return '';
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
/**
 * Parse ELink response
 */
export function parseELinkResult(xml) {
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
        const linkSetObj = linkSet;
        const idListObj = linkSetObj.IdList;
        const idList = ensureArray(idListObj?.Id || []).map(String);
        const linkSetDbList = ensureArray(linkSetObj.LinkSetDb || []);
        return {
            dbFrom: extractText(linkSetObj.DbFrom) || 'pubmed',
            idList,
            linkSetDb: linkSetDbList.map((lsdb) => ({
                dbTo: extractText(lsdb.DbTo) || '',
                linkName: extractText(lsdb.LinkName) || '',
                link: ensureArray(lsdb.Link || []).map((link) => ({
                    id: extractText(link.Id) || '',
                    score: link.Score ? parseInt(extractText(link.Score), 10) : undefined,
                })),
            })),
        };
    }
    catch (error) {
        if (error instanceof XMLParseError)
            throw error;
        throw new XMLParseError(`Failed to parse ELink response: ${error}`, xml);
    }
}
//# sourceMappingURL=xml-parser.js.map
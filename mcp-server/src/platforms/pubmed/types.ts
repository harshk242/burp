import type { AxiosAdapter } from 'axios';
import type { RetryDeps } from '../../shared/http-retry.js';
import type { TokenBucketRateLimiter } from '../../shared/rate-limiter.js';

export interface CacheEntry {
  data: unknown;
  timestamp: number;
}

export interface ESearchResult {
  count: number;
  retmax: number;
  retstart: number;
  idList: string[];
  translationSet: TranslationSet[];
  translationStack: TranslationStack[];
  queryTranslation: string;
}

export interface TranslationSet {
  from: string;
  to: string;
}

export interface TranslationStack {
  term: string;
  field: string;
  count: number;
  explode: string;
}

export interface ArticleSummary {
  uid: string;
  pubdate: string;
  epubdate?: string;
  source: string;
  authors: Author[];
  lastauthor?: string;
  title: string;
  sorttitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  lang?: string[];
  nlmuniqueid?: string;
  issn?: string;
  essn?: string;
  pubtype?: string[];
  recordstatus?: string;
  pubstatus?: string;
  articleids?: ArticleId[];
  history?: HistoryEntry[];
  references?: string[];
  attributes?: string[];
  pmcrefcount?: number;
  fulljournalname?: string;
  elocationid?: string;
  doctype?: string;
  srccontriblist?: string[];
  booktitle?: string;
  medium?: string;
  edition?: string;
  publisherlocation?: string;
  publishername?: string;
  srcdate?: string;
  reportnumber?: string;
  availablefromurl?: string;
  locationlabel?: string;
  doccontriblist?: string[];
  docdate?: string;
  bookname?: string;
  chapter?: string;
  sortpubdate?: string;
  sortfirstauthor?: string;
}

export interface Author {
  name: string;
  authtype?: string;
  clusterid?: string;
}

export interface ArticleId {
  idtype: string;
  idtypen: number;
  value: string;
}

export interface HistoryEntry {
  pubstatus: string;
  date: string;
}

export interface PubMedArticle {
  pmid: string;
  title: string;
  abstract?: string;
  authors: AuthorInfo[];
  journal: JournalInfo;
  pubDate: string;
  doi?: string;
  pmcId?: string;
  meshTerms?: MeshTerm[];
  keywords?: string[];
  publicationTypes?: string[];
  grantList?: Grant[];
  affiliations?: string[];
  language?: string;
  citedByCount?: number;
}

export interface AuthorInfo {
  lastName?: string;
  foreName?: string;
  initials?: string;
  affiliation?: string;
  orcid?: string;
  collectiveName?: string;
}

export interface JournalInfo {
  title: string;
  isoAbbreviation?: string;
  issn?: string;
  volume?: string;
  issue?: string;
  pubDate?: string;
  pages?: string;
}

export interface MeshTerm {
  descriptorName: string;
  qualifierName?: string;
  majorTopic: boolean;
}

export interface Grant {
  grantId?: string;
  acronym?: string;
  agency?: string;
  country?: string;
}

export interface LinkResult {
  dbFrom: string;
  idList: string[];
  linkSetDbHistory?: LinkSetDbHistory[];
  linkSetDb?: LinkSetDb[];
}

export interface LinkSetDbHistory {
  dbTo: string;
  linkName: string;
  queryKey: string;
}

export interface LinkSetDb {
  dbTo: string;
  linkName: string;
  link: LinkItem[];
}

export interface LinkItem {
  id: string;
  score?: number;
}

export interface SearchFilters {
  dateRange?: {
    start: string;
    end: string;
  };
  publicationType?: string[];
  language?: string;
  hasAbstract?: boolean;
  freeFullText?: boolean;
  humanOnly?: boolean;
  journalList?: string[];
}

export interface SearchResponse {
  count: number;
  pmids: string[];
  queryTranslation: string;
}

export interface ArticleDetailsResponse {
  articles: PubMedArticle[];
}

export interface RelatedArticlesResponse {
  sourceId: string;
  relatedIds: string[];
  linkName: string;
}

export interface CitationResponse {
  sourceId: string;
  citingArticles: string[];
  count: number;
}

export interface ReferenceResponse {
  sourceId: string;
  references: string[];
  count: number;
}

export interface MeshTermsResponse {
  pmid: string;
  meshTerms: MeshTerm[];
}

export interface PublicationTrendsResponse {
  query: string;
  years: YearCount[];
  totalCount: number;
}

export interface YearCount {
  year: number;
  count: number;
}

export interface FormattedCitation {
  pmid: string;
  citation: string;
  style: string;
}

export interface PubMedClientOptions {
  apiKey?: string;
  cacheTtl?: number;
  maxAttempts?: number;
  retryDelay?: number;
  rateLimiter?: TokenBucketRateLimiter;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}

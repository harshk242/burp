import type { AxiosAdapter } from 'axios';
import type { RetryDeps } from '../../shared/http-retry.js';
import type { TokenBucketRateLimiter } from '../../shared/rate-limiter.js';

export interface CacheEntry {
  /** The raw response text; it is parsed again on each hit. */
  xml: string;
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

/** An ESummary `Structure` item: its sub-items' text by name. */
export type SummaryStructure = Record<string, string>;

/** An element of an ESummary `List` item. */
export type SummaryListItem = string | SummaryStructure;

export interface ArticleSummary {
  uid: string;
  pubdate: string;
  epubdate?: string | undefined;
  source: string;
  authors: string[];
  lastauthor?: string | undefined;
  title: string;
  sorttitle?: string | undefined;
  volume?: string | undefined;
  issue?: string | undefined;
  pages?: string | undefined;
  lang?: string[] | undefined;
  nlmuniqueid?: string | undefined;
  issn?: string | undefined;
  essn?: string | undefined;
  pubtype?: string[] | undefined;
  recordstatus?: string | undefined;
  pubstatus?: string | undefined;
  articleids?: SummaryListItem[] | undefined;
  history?: SummaryListItem[] | undefined;
  references?: SummaryListItem[] | undefined;
  attributes?: string[];
  pmcrefcount?: number | undefined;
  fulljournalname?: string | undefined;
  elocationid?: string | undefined;
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
  sortpubdate?: string | undefined;
  sortfirstauthor?: string | undefined;
}

export interface PubMedArticle {
  pmid: string;
  title: string;
  abstract?: string | undefined;
  authors: AuthorInfo[];
  journal: JournalInfo;
  pubDate: string;
  doi?: string | undefined;
  pmcId?: string | undefined;
  meshTerms?: MeshTerm[] | undefined;
  keywords?: string[] | undefined;
  publicationTypes?: string[] | undefined;
  grantList?: Grant[] | undefined;
  affiliations?: string[];
  language?: string;
  citedByCount?: number;
}

export interface AuthorInfo {
  lastName?: string;
  foreName?: string;
  initials?: string;
  affiliation?: string | undefined;
  orcid?: string | undefined;
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
  qualifierName?: string | undefined;
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
  score?: number | undefined;
}

export interface SearchFilters {
  dateRange?: {
    start: string;
    end: string;
  } | undefined;
  publicationType?: string[] | undefined;
  language?: string | undefined;
  hasAbstract?: boolean | undefined;
  freeFullText?: boolean | undefined;
  humanOnly?: boolean | undefined;
  journalList?: string[] | undefined;
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
  apiKey?: string | undefined;
  cacheTtl?: number;
  maxAttempts?: number;
  retryDelay?: number;
  rateLimiter?: TokenBucketRateLimiter;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}

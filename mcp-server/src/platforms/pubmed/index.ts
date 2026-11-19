import { TOOLS } from './tools/definitions.js';
import type { PlatformModule, ToolHandler } from '../../types.js';
import { initializeClient, closeClient } from './client.js';
import * as tools from './tools/index.js';
import {
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireNumber,
  requireString,
  requireStringArray,
} from '../../shared/args.js';

const CITATION_STYLES = ['apa', 'mla', 'vancouver', 'bibtex'] as const;

const toolHandlers: Record<string, ToolHandler> = {
  search_pubmed: async (args) => {
    return tools.searchPubmed(
      requireString(args, 'query'),
      optionalNumber(args, 'max_results'),
      optionalNumber(args, 'start'),
      optionalString(args, 'sort')
    );
  },

  search_with_filters: async (args) => {
    const dateStart = optionalString(args, 'date_start');
    const dateEnd = optionalString(args, 'date_end');
    const filters = {
      dateRange: dateStart || dateEnd
        ? { start: dateStart || '1000/01/01', end: dateEnd || '3000/12/31' }
        : undefined,
      publicationType: optionalStringArray(args, 'publication_types'),
      language: optionalString(args, 'language'),
      hasAbstract: optionalBoolean(args, 'has_abstract'),
      freeFullText: optionalBoolean(args, 'free_full_text'),
      humanOnly: optionalBoolean(args, 'human_only'),
      journalList: optionalStringArray(args, 'journals'),
    };
    return tools.searchWithFilters(
      requireString(args, 'query'),
      filters,
      optionalNumber(args, 'max_results')
    );
  },

  search_by_author: async (args) => {
    return tools.searchByAuthor(
      requireString(args, 'author_name'),
      optionalString(args, 'additional_query'),
      optionalNumber(args, 'max_results')
    );
  },

  search_by_journal: async (args) => {
    return tools.searchByJournal(
      requireString(args, 'journal_name'),
      optionalString(args, 'additional_query'),
      optionalNumber(args, 'max_results'),
      optionalString(args, 'min_date'),
      optionalString(args, 'max_date')
    );
  },

  search_clinical_trials_literature: async (args) => {
    return tools.searchClinicalTrialsLiterature(
      requireString(args, 'condition'),
      optionalString(args, 'intervention'),
      optionalNumber(args, 'max_results')
    );
  },

  fetch_article_details: async (args) => {
    return tools.fetchArticleDetails(requireString(args, 'pmid'));
  },

  get_article_abstract: async (args) => {
    return tools.getArticleAbstract(requireString(args, 'pmid'));
  },

  get_article_summary: async (args) => {
    return tools.getArticleSummary(requireString(args, 'pmid'));
  },

  batch_fetch_articles: async (args) => {
    return tools.batchFetchArticles(
      requireStringArray(args, 'pmids'),
      optionalBoolean(args, 'include_abstracts')
    );
  },

  find_related_articles: async (args) => {
    return tools.findRelatedArticles(
      requireString(args, 'pmid'),
      optionalNumber(args, 'max_results')
    );
  },

  get_citations: async (args) => {
    return tools.getCitations(
      requireString(args, 'pmid'),
      optionalNumber(args, 'max_results')
    );
  },

  get_references: async (args) => {
    return tools.getReferences(
      requireString(args, 'pmid'),
      optionalNumber(args, 'max_results')
    );
  },

  get_mesh_terms: async (args) => {
    return tools.getMeshTerms(requireString(args, 'pmid'));
  },

  get_publication_trends: async (args) => {
    return tools.getPublicationTrends(
      requireString(args, 'query'),
      requireNumber(args, 'start_year'),
      optionalNumber(args, 'end_year')
    );
  },

  format_citation: async (args) => {
    return tools.formatCitation(
      requireString(args, 'pmid'),
      optionalEnum(args, 'style', CITATION_STYLES)
    );
  },
};

const pubmedModule: PlatformModule = {
  name: 'pubmed',
  tools: TOOLS,
  handlers: toolHandlers,

  init(env: Record<string, string | undefined>): void {
    initializeClient({
      apiKey: env.NCBI_API_KEY,
    });
  },

  cleanup(): void {
    closeClient();
  },
};

export { pubmedModule as platform };

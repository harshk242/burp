import { TOOLS } from './tools/definitions.js';
import type { PlatformModule, ToolHandler } from '../../types.js';
import { initializeClient, closeClient } from './client.js';
import * as tools from './tools/index.js';


const toolHandlers: Record<string, ToolHandler> = {
  search_pubmed: async (args) => {
    return tools.searchPubmed(
      args.query as string,
      args.max_results as number | undefined,
      args.start as number | undefined,
      args.sort as string | undefined
    );
  },

  search_with_filters: async (args) => {
    const filters = {
      dateRange: args.date_start || args.date_end
        ? { start: (args.date_start as string) || '1000/01/01', end: (args.date_end as string) || '3000/12/31' }
        : undefined,
      publicationType: args.publication_types as string[] | undefined,
      language: args.language as string | undefined,
      hasAbstract: args.has_abstract as boolean | undefined,
      freeFullText: args.free_full_text as boolean | undefined,
      humanOnly: args.human_only as boolean | undefined,
      journalList: args.journals as string[] | undefined,
    };
    return tools.searchWithFilters(
      args.query as string,
      filters,
      args.max_results as number | undefined
    );
  },

  search_by_author: async (args) => {
    return tools.searchByAuthor(
      args.author_name as string,
      args.additional_query as string | undefined,
      args.max_results as number | undefined
    );
  },

  search_by_journal: async (args) => {
    return tools.searchByJournal(
      args.journal_name as string,
      args.additional_query as string | undefined,
      args.max_results as number | undefined,
      args.min_date as string | undefined,
      args.max_date as string | undefined
    );
  },

  search_clinical_trials_literature: async (args) => {
    return tools.searchClinicalTrialsLiterature(
      args.condition as string,
      args.intervention as string | undefined,
      args.max_results as number | undefined
    );
  },

  fetch_article_details: async (args) => {
    return tools.fetchArticleDetails(args.pmid as string);
  },

  get_article_abstract: async (args) => {
    return tools.getArticleAbstract(args.pmid as string);
  },

  get_article_summary: async (args) => {
    return tools.getArticleSummary(args.pmid as string);
  },

  batch_fetch_articles: async (args) => {
    return tools.batchFetchArticles(
      args.pmids as string[],
      args.include_abstracts as boolean | undefined
    );
  },

  find_related_articles: async (args) => {
    return tools.findRelatedArticles(
      args.pmid as string,
      args.max_results as number | undefined
    );
  },

  get_citations: async (args) => {
    return tools.getCitations(
      args.pmid as string,
      args.max_results as number | undefined
    );
  },

  get_references: async (args) => {
    return tools.getReferences(
      args.pmid as string,
      args.max_results as number | undefined
    );
  },

  get_mesh_terms: async (args) => {
    return tools.getMeshTerms(args.pmid as string);
  },

  get_publication_trends: async (args) => {
    return tools.getPublicationTrends(
      args.query as string,
      args.start_year as number,
      args.end_year as number | undefined
    );
  },

  format_citation: async (args) => {
    return tools.formatCitation(
      args.pmid as string,
      args.style as 'apa' | 'mla' | 'vancouver' | 'bibtex' | undefined
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

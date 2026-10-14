import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { PlatformModule, ToolHandler } from '../../types.js';
import { initializeClient, closeClient } from './client.js';
import * as tools from './tools/index.js';

const TOOLS: Tool[] = [
  {
    name: 'search_pubmed',
    description: 'Search PubMed database with a query string. Returns matching article PMIDs and total count.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (supports PubMed query syntax)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 20, max: 10000)',
          default: 20,
        },
        start: {
          type: 'number',
          description: 'Starting index for pagination (default: 0)',
          default: 0,
        },
        sort: {
          type: 'string',
          description: 'Sort order: relevance, date, first_author, journal',
          enum: ['relevance', 'date', 'first_author', 'journal'],
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_with_filters',
    description: 'Advanced PubMed search with filters for date range, publication type, language, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Base search query',
        },
        date_start: {
          type: 'string',
          description: 'Start date in YYYY/MM/DD format',
        },
        date_end: {
          type: 'string',
          description: 'End date in YYYY/MM/DD format',
        },
        publication_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by publication types (e.g., Review, Clinical Trial)',
        },
        language: {
          type: 'string',
          description: 'Filter by language (e.g., English, French)',
        },
        has_abstract: {
          type: 'boolean',
          description: 'Only return articles with abstracts',
        },
        free_full_text: {
          type: 'boolean',
          description: 'Only return articles with free full text',
        },
        human_only: {
          type: 'boolean',
          description: 'Only return human studies',
        },
        journals: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by journal names',
        },
        max_results: {
          type: 'number',
          description: 'Maximum results (default: 20)',
          default: 20,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_by_author',
    description: 'Search PubMed for articles by a specific author.',
    inputSchema: {
      type: 'object',
      properties: {
        author_name: {
          type: 'string',
          description: 'Author name (e.g., "Smith J" or "Smith John")',
        },
        additional_query: {
          type: 'string',
          description: 'Additional search terms to combine with author search',
        },
        max_results: {
          type: 'number',
          description: 'Maximum results (default: 20)',
          default: 20,
        },
      },
      required: ['author_name'],
    },
  },
  {
    name: 'search_by_journal',
    description: 'Search PubMed for articles from a specific journal.',
    inputSchema: {
      type: 'object',
      properties: {
        journal_name: {
          type: 'string',
          description: 'Journal name or ISSN',
        },
        additional_query: {
          type: 'string',
          description: 'Additional search terms',
        },
        max_results: {
          type: 'number',
          description: 'Maximum results (default: 20)',
          default: 20,
        },
        min_date: {
          type: 'string',
          description: 'Minimum date (YYYY/MM/DD)',
        },
        max_date: {
          type: 'string',
          description: 'Maximum date (YYYY/MM/DD)',
        },
      },
      required: ['journal_name'],
    },
  },
  {
    name: 'search_clinical_trials_literature',
    description: 'Search for clinical trial literature by condition and optional intervention.',
    inputSchema: {
      type: 'object',
      properties: {
        condition: {
          type: 'string',
          description: 'Medical condition or disease',
        },
        intervention: {
          type: 'string',
          description: 'Treatment or intervention (optional)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum results (default: 20)',
          default: 20,
        },
      },
      required: ['condition'],
    },
  },

  {
    name: 'fetch_article_details',
    description: 'Fetch complete article details including title, abstract, authors, MeSH terms, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        pmid: {
          type: 'string',
          description: 'PubMed ID of the article',
        },
      },
      required: ['pmid'],
    },
  },
  {
    name: 'get_article_abstract',
    description: 'Get just the abstract and basic info for an article.',
    inputSchema: {
      type: 'object',
      properties: {
        pmid: {
          type: 'string',
          description: 'PubMed ID of the article',
        },
      },
      required: ['pmid'],
    },
  },
  {
    name: 'get_article_summary',
    description: 'Get a lightweight summary of article metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        pmid: {
          type: 'string',
          description: 'PubMed ID of the article',
        },
      },
      required: ['pmid'],
    },
  },
  {
    name: 'batch_fetch_articles',
    description: 'Fetch details for multiple articles at once (up to 200 per request).',
    inputSchema: {
      type: 'object',
      properties: {
        pmids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of PubMed IDs',
        },
        include_abstracts: {
          type: 'boolean',
          description: 'Include abstracts in response (default: true)',
          default: true,
        },
      },
      required: ['pmids'],
    },
  },

  {
    name: 'find_related_articles',
    description: 'Find articles related to a given article based on PubMed similarity algorithm.',
    inputSchema: {
      type: 'object',
      properties: {
        pmid: {
          type: 'string',
          description: 'PubMed ID of the source article',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of related articles (default: 20)',
          default: 20,
        },
      },
      required: ['pmid'],
    },
  },
  {
    name: 'get_citations',
    description: 'Get articles that cite the given article.',
    inputSchema: {
      type: 'object',
      properties: {
        pmid: {
          type: 'string',
          description: 'PubMed ID of the article',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of citing articles (default: 50)',
          default: 50,
        },
      },
      required: ['pmid'],
    },
  },
  {
    name: 'get_references',
    description: 'Get articles referenced by (cited in) the given article.',
    inputSchema: {
      type: 'object',
      properties: {
        pmid: {
          type: 'string',
          description: 'PubMed ID of the article',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of references (default: 100)',
          default: 100,
        },
      },
      required: ['pmid'],
    },
  },

  {
    name: 'get_mesh_terms',
    description: 'Get MeSH (Medical Subject Headings) terms for an article.',
    inputSchema: {
      type: 'object',
      properties: {
        pmid: {
          type: 'string',
          description: 'PubMed ID of the article',
        },
      },
      required: ['pmid'],
    },
  },
  {
    name: 'get_publication_trends',
    description: 'Get publication count trends over years for a search query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        start_year: {
          type: 'number',
          description: 'Starting year for trend analysis',
        },
        end_year: {
          type: 'number',
          description: 'Ending year (default: current year)',
        },
      },
      required: ['query', 'start_year'],
    },
  },
  {
    name: 'format_citation',
    description: 'Generate a formatted citation for an article in various styles.',
    inputSchema: {
      type: 'object',
      properties: {
        pmid: {
          type: 'string',
          description: 'PubMed ID of the article',
        },
        style: {
          type: 'string',
          description: 'Citation style',
          enum: ['apa', 'mla', 'vancouver', 'bibtex'],
          default: 'vancouver',
        },
      },
      required: ['pmid'],
    },
  },
];

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
      dateRange: args.date_start && args.date_end
        ? { start: args.date_start as string, end: args.date_end as string }
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

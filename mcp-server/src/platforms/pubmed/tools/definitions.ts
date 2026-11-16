import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const TOOLS: Tool[] = [
  {
    name: 'search_pubmed',
    description: 'Search PubMed with a query string (PubMed syntax). Returns the total count and the top hits with PMID, title, journal, date and publication types (e.g. Review, Randomized Controlled Trial, Retracted Publication). Titles are leads: open the abstracts with batch_fetch_articles before stating what a paper found.',
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
          description: 'Publication start date in YYYY/MM/DD format (inclusive)',
        },
        date_end: {
          type: 'string',
          description: 'Publication end date in YYYY/MM/DD format (inclusive)',
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
          description: 'Minimum publication date (YYYY/MM/DD, inclusive)',
        },
        max_date: {
          type: 'string',
          description: 'Maximum publication date (YYYY/MM/DD, inclusive)',
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
    description: 'Read papers: abstracts for one or more PMIDs in one call (up to 200), with title, journal, date, DOI, publication types and first authors. Use it to open the papers you cite before stating their findings, numbers or conclusions.',
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

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const PHASE_PROP = {
  type: 'string' as const,
  description: 'Study phase filter',
  enum: ['PHASE1', 'PHASE2', 'PHASE3', 'PHASE4', 'NA'],
};

const PAGE_SIZE_100 = {
  type: 'number' as const,
  description: 'Number of results to return (default 10, max 100)',
  minimum: 1,
  maximum: 100,
};

const PAGE_SIZE_50 = {
  type: 'number' as const,
  description: 'Number of results to return (default 10, max 50)',
  minimum: 1,
  maximum: 50,
};

const CONDITION_PROP = {
  type: 'string' as const,
  description: 'Medical condition to filter by',
};

const RECRUITING_STATUS_3 = {
  type: 'string' as const,
  description: 'Filter by recruitment status',
  enum: ['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING'],
};

export const tools: Tool[] = [
  {
    name: 'search_studies',
    description: 'Search for clinical trials with various filters',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'General search term (condition, intervention, etc.)' },
        condition: { type: 'string', description: 'Medical condition or disease' },
        intervention: { type: 'string', description: 'Treatment, drug, or intervention' },
        location: { type: 'string', description: 'Geographic location (city, state, country)' },
        phase: { ...PHASE_PROP, description: 'Study phase (PHASE1, PHASE2, PHASE3, PHASE4, NA)' },
        status: {
          type: 'string', description: 'Recruitment status',
          enum: ['RECRUITING', 'NOT_YET_RECRUITING', 'COMPLETED', 'TERMINATED', 'SUSPENDED', 'WITHDRAWN'],
        },
        sex: { type: 'string', description: 'Sex eligibility', enum: ['ALL', 'FEMALE', 'MALE'] },
        age: { type: 'string', description: 'Age group', enum: ['CHILD', 'ADULT', 'OLDER_ADULT'] },
        pageSize: PAGE_SIZE_100,
      },
    },
  },
  {
    name: 'get_study_details',
    description: 'Get detailed information about a specific clinical trial',
    inputSchema: {
      type: 'object',
      properties: {
        nctId: { type: 'string', description: 'NCT ID of the study (e.g., NCT00000419)', pattern: '^NCT\\d{8}$' },
      },
      required: ['nctId'],
    },
  },
  {
    name: 'search_by_location',
    description: 'Find clinical trials by geographic location',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'Country name' },
        state: { type: 'string', description: 'State or province' },
        city: { type: 'string', description: 'City name' },
        facilityName: { type: 'string', description: 'Name of medical facility or institution' },
        distance: { type: 'number', description: 'Search radius in miles (when using city)', minimum: 1, maximum: 500 },
        pageSize: PAGE_SIZE_100,
      },
    },
  },
  {
    name: 'search_by_condition',
    description: 'Search for clinical trials focusing on specific medical conditions',
    inputSchema: {
      type: 'object',
      properties: {
        condition: { type: 'string', description: 'Medical condition, disease, or syndrome', minLength: 2 },
        phase: PHASE_PROP,
        recruitmentStatus: RECRUITING_STATUS_3,
        pageSize: PAGE_SIZE_100,
      },
      required: ['condition'],
    },
  },
  {
    name: 'get_trial_statistics',
    description: 'Get aggregate statistics about clinical trials',
    inputSchema: {
      type: 'object',
      properties: {
        groupBy: {
          type: 'string', description: 'Field to group statistics by',
          enum: ['phase', 'status', 'studyType', 'condition', 'sponsor'],
        },
        filters: {
          type: 'object', description: 'Optional filters to apply',
          properties: { condition: { type: 'string' }, phase: { type: 'string' }, status: { type: 'string' } },
        },
      },
    },
  },
  {
    name: 'search_by_sponsor',
    description: 'Search clinical trials by sponsor or organization',
    inputSchema: {
      type: 'object',
      properties: {
        sponsor: {
          type: 'string', minLength: 2,
          description: 'Sponsor name or organization (e.g., "Pfizer", "National Cancer Institute")',
        },
        sponsorType: { type: 'string', description: 'Type of sponsor', enum: ['INDUSTRY', 'NIH', 'FED', 'OTHER'] },
        pageSize: PAGE_SIZE_100,
      },
      required: ['sponsor'],
    },
  },
  {
    name: 'search_by_intervention',
    description: 'Search clinical trials by intervention or treatment type',
    inputSchema: {
      type: 'object',
      properties: {
        intervention: { type: 'string', description: 'Intervention, drug, device, or treatment name', minLength: 2 },
        interventionType: {
          type: 'string', description: 'Type of intervention',
          enum: ['DRUG', 'DEVICE', 'BIOLOGICAL', 'PROCEDURE', 'BEHAVIORAL', 'OTHER'],
        },
        phase: PHASE_PROP,
        pageSize: PAGE_SIZE_100,
      },
      required: ['intervention'],
    },
  },
  {
    name: 'get_recruiting_studies',
    description: 'Get currently recruiting clinical trials with contact information',
    inputSchema: {
      type: 'object',
      properties: {
        condition: CONDITION_PROP,
        location: { type: 'string', description: 'Geographic location (city, state, country)' },
        ageGroup: { type: 'string', description: 'Age group eligibility', enum: ['CHILD', 'ADULT', 'OLDER_ADULT'] },
        pageSize: PAGE_SIZE_50,
      },
    },
  },
  {
    name: 'search_by_date_range',
    description: 'Search clinical trials by start or completion date range',
    inputSchema: {
      type: 'object',
      properties: {
        startDateFrom: { type: 'string', description: 'Start date from (YYYY-MM-DD)', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        startDateTo: { type: 'string', description: 'Start date to (YYYY-MM-DD)', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        completionDateFrom: { type: 'string', description: 'Completion date from (YYYY-MM-DD)', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        completionDateTo: { type: 'string', description: 'Completion date to (YYYY-MM-DD)', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        condition: { type: 'string', description: 'Optional condition filter' },
        pageSize: PAGE_SIZE_100,
      },
    },
  },
  {
    name: 'get_studies_with_results',
    description: 'Find completed clinical trials that have published results',
    inputSchema: {
      type: 'object',
      properties: {
        condition: CONDITION_PROP,
        intervention: { type: 'string', description: 'Treatment or intervention to filter by' },
        completedAfter: { type: 'string', description: 'Find studies completed after this date (YYYY-MM-DD)', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        pageSize: PAGE_SIZE_100,
      },
    },
  },
  {
    name: 'search_rare_diseases',
    description: 'Search clinical trials for rare diseases and orphan conditions',
    inputSchema: {
      type: 'object',
      properties: {
        rareDisease: { type: 'string', description: 'Rare disease or orphan condition name', minLength: 2 },
        recruitmentStatus: {
          type: 'string', description: 'Filter by recruitment status',
          enum: ['RECRUITING', 'NOT_YET_RECRUITING', 'COMPLETED'],
        },
        pageSize: PAGE_SIZE_100,
      },
      required: ['rareDisease'],
    },
  },
  {
    name: 'get_pediatric_studies',
    description: 'Find clinical trials specifically designed for children and adolescents',
    inputSchema: {
      type: 'object',
      properties: {
        condition: { type: 'string', description: 'Pediatric condition or disease' },
        ageRange: { type: 'string', description: 'Specific pediatric age range', enum: ['INFANT', 'CHILD', 'ADOLESCENT'] },
        recruitmentStatus: RECRUITING_STATUS_3,
        pageSize: PAGE_SIZE_50,
      },
    },
  },
  {
    name: 'get_similar_studies',
    description: 'Find clinical trials similar to a specific study by NCT ID',
    inputSchema: {
      type: 'object',
      properties: {
        nctId: { type: 'string', description: 'NCT ID of the reference study (e.g., NCT00000419)', pattern: '^NCT\\d{8}$' },
        similarityType: { type: 'string', description: 'Type of similarity to search for', enum: ['CONDITION', 'INTERVENTION', 'SPONSOR', 'PHASE'] },
        pageSize: PAGE_SIZE_50,
      },
      required: ['nctId'],
    },
  },
  {
    name: 'search_by_primary_outcome',
    description: 'Search clinical trials by primary outcome measures or endpoints',
    inputSchema: {
      type: 'object',
      properties: {
        outcome: { type: 'string', description: 'Primary outcome or endpoint to search for', minLength: 3 },
        condition: { type: 'string', description: 'Optional condition filter' },
        phase: PHASE_PROP,
        pageSize: PAGE_SIZE_100,
      },
      required: ['outcome'],
    },
  },
  {
    name: 'search_by_eligibility_criteria',
    description: 'Advanced search based on detailed eligibility criteria',
    inputSchema: {
      type: 'object',
      properties: {
        minAge: { type: 'string', description: 'Minimum age (e.g., "18 Years", "6 Months")' },
        maxAge: { type: 'string', description: 'Maximum age (e.g., "65 Years", "12 Years")' },
        sex: { type: 'string', description: 'Sex eligibility', enum: ['ALL', 'FEMALE', 'MALE'] },
        healthyVolunteers: { type: 'boolean', description: 'Whether study accepts healthy volunteers' },
        condition: { type: 'string', description: 'Medical condition filter' },
        exclusionKeywords: { type: 'string', description: 'Keywords that should NOT appear in eligibility criteria' },
        inclusionKeywords: { type: 'string', description: 'Keywords that should appear in eligibility criteria' },
        pageSize: PAGE_SIZE_100,
      },
    },
  },
  {
    name: 'get_study_timeline',
    description: 'Get detailed timeline and milestone information for studies',
    inputSchema: {
      type: 'object',
      properties: {
        condition: { type: 'string', description: 'Condition to filter studies' },
        sponsor: { type: 'string', description: 'Sponsor to filter studies' },
        phase: PHASE_PROP,
        timelineType: { type: 'string', description: 'Type of timeline analysis', enum: ['CURRENT', 'COMPLETED', 'UPCOMING'] },
        pageSize: PAGE_SIZE_50,
      },
    },
  },
  {
    name: 'search_international_studies',
    description: 'Find multi-country international clinical trials',
    inputSchema: {
      type: 'object',
      properties: {
        condition: CONDITION_PROP,
        excludeCountry: { type: 'string', description: 'Country to exclude from results (e.g., "United States")' },
        includeCountry: { type: 'string', description: 'Country that must be included in results' },
        minCountries: { type: 'number', description: 'Minimum number of countries involved', minimum: 2, maximum: 50 },
        phase: PHASE_PROP,
        pageSize: PAGE_SIZE_100,
      },
    },
  },
];

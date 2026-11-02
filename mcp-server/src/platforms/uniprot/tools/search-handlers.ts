import type { ToolHandler } from '../../../types.js';
import { getClient } from '../client.js';
import { resolveSpeciesFilter } from '../extractors.js';

function requireString(args: Record<string, unknown>, key: string, label: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Invalid ${label}: '${key}' must be a non-empty string`);
  }
  return v;
}

function optString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

function optNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === 'number' ? v : undefined;
}

function optStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key];
  return Array.isArray(v) ? (v as string[]) : undefined;
}

const handleSearchProteins: ToolHandler = async (args) => {
  const query_base = requireString(args, 'query', 'search_proteins');
  const organism = optString(args, 'organism');
  const size = optNumber(args, 'size') ?? 25;
  const format = optString(args, 'format') ?? 'json';

  let query = query_base;
  if (organism) {
    query += ` AND organism_name:"${organism}"`;
  }

  const response = await getClient().get('/uniprotkb/search', {
    params: { query, format, size },
  });

  return typeof response.data === 'object'
    ? response.data
    : String(response.data);
};

const handleSearchByGene: ToolHandler = async (args) => {
  const gene = requireString(args, 'gene', 'search_by_gene');
  const species = optStringArray(args, 'species');
  const size = optNumber(args, 'size') ?? 25;

  let query = `gene:"${gene}"`;
  const speciesFilter = resolveSpeciesFilter(species);
  if (speciesFilter) {
    query += ` AND ${speciesFilter}`;
  }

  const response = await getClient().get('/uniprotkb/search', {
    params: { query, format: 'json', size },
  });

  return response.data;
};

const handleSearchByFunction: ToolHandler = async (args) => {
  const goTerm = optString(args, 'goTerm');
  const func = optString(args, 'function');
  if (!goTerm && !func) {
    throw new Error('search_by_function requires at least one of goTerm or function');
  }

  const organism = optString(args, 'organism');
  const size = optNumber(args, 'size') ?? 25;

  let query = 'reviewed:true';
  if (goTerm) query += ` AND go:${goTerm.replace(/^GO:/i, '')}`;
  if (func) query += ` AND (cc_function:"${func}" OR ft_act_site:"${func}")`;
  if (organism) query += ` AND organism_name:"${organism}"`;

  const response = await getClient().get('/uniprotkb/search', {
    params: { query, format: 'json', size },
  });
  return response.data;
};

const handleSearchByLocalization: ToolHandler = async (args) => {
  const localization = requireString(args, 'localization', 'search_by_localization');
  const organism = optString(args, 'organism');
  const size = optNumber(args, 'size') ?? 25;

  let query = `reviewed:true AND cc_subcellular_location:"${localization}"`;
  if (organism) query += ` AND organism_name:"${organism}"`;

  const response = await getClient().get('/uniprotkb/search', {
    params: { query, format: 'json', size },
  });
  return response.data;
};

const handleSearchByTaxonomy: ToolHandler = async (args) => {
  const taxonomyId = optNumber(args, 'taxonomyId');
  const taxonomyName = optString(args, 'taxonomyName');
  if (taxonomyId === undefined && !taxonomyName) {
    throw new Error('search_by_taxonomy requires at least one of taxonomyId or taxonomyName');
  }

  const size = optNumber(args, 'size') ?? 25;

  let query = 'reviewed:true';
  if (taxonomyId !== undefined) query += ` AND taxonomy_id:"${taxonomyId}"`;
  if (taxonomyName) query += ` AND taxonomy_name:"${taxonomyName}"`;

  const response = await getClient().get('/uniprotkb/search', {
    params: { query, format: 'json', size },
  });
  return response.data;
};

const handleAdvancedSearch: ToolHandler = async (args) => {
  const baseQuery = optString(args, 'query');
  const organism = optString(args, 'organism');
  const minLength = optNumber(args, 'minLength');
  const maxLength = optNumber(args, 'maxLength');
  const minMass = optNumber(args, 'minMass');
  const maxMass = optNumber(args, 'maxMass');
  const keywords = optStringArray(args, 'keywords');
  const size = optNumber(args, 'size') ?? 25;

  let query = 'reviewed:true';
  if (baseQuery) query += ` AND (${baseQuery})`;
  if (organism) query += ` AND organism_name:"${organism}"`;

  if (minLength !== undefined || maxLength !== undefined) {
    const lo = minLength ?? '*';
    const hi = maxLength ?? '*';
    query += ` AND length:[${lo} TO ${hi}]`;
  }
  if (minMass !== undefined || maxMass !== undefined) {
    const lo = minMass ?? '*';
    const hi = maxMass ?? '*';
    query += ` AND mass:[${lo} TO ${hi}]`;
  }
  if (keywords) {
    for (const kw of keywords) {
      query += ` AND keyword:"${kw}"`;
    }
  }

  const response = await getClient().get('/uniprotkb/search', {
    params: { query, format: 'json', size },
  });
  return response.data;
};

export const searchHandlers: Record<string, ToolHandler> = {
  search_proteins: handleSearchProteins,
  search_by_gene: handleSearchByGene,
  search_by_function: handleSearchByFunction,
  search_by_localization: handleSearchByLocalization,
  search_by_taxonomy: handleSearchByTaxonomy,
  advanced_search: handleAdvancedSearch,
};

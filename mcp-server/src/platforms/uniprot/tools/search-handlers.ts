import type { ToolHandler } from '../../../types.js';
import { optionalStringArray } from '../../../shared/args.js';
import { andQuery, quoteQuery, reviewedQuery, searchSummaries } from '../search-fields.js';
import { resolveOrganismFilter, resolveSpeciesFilter } from '../extractors.js';

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

const handleSearchProteins: ToolHandler = async (args) => {
  const query_base = requireString(args, 'query', 'search_proteins');
  const organism = optString(args, 'organism');
  const size = args.size;
  const format = optString(args, 'format') ?? 'json';

  const query = andQuery([
    reviewedQuery(args, query_base), `(${query_base})`,
    organism ? resolveOrganismFilter(organism) : undefined,
  ]);

  return searchSummaries(query, size, format);
};

const handleSearchByGene: ToolHandler = async (args) => {
  const gene = requireString(args, 'gene', 'search_by_gene');
  const species = optionalStringArray(args, 'species');
  const size = args.size;

  let query = `${reviewedQuery(args)} AND gene:${quoteQuery(gene)}`;
  const speciesFilter = resolveSpeciesFilter(species);
  if (speciesFilter) {
    query += ` AND ${speciesFilter}`;
  }

  return searchSummaries(query, size);
};

const handleSearchByFunction: ToolHandler = async (args) => {
  const goTerm = optString(args, 'goTerm');
  const func = optString(args, 'function');
  if (!goTerm && !func) {
    throw new Error('search_by_function requires at least one of goTerm or function');
  }

  const organism = optString(args, 'organism');
  const size = args.size;

  let query = reviewedQuery(args);
  if (goTerm) query += ` AND go:${quoteQuery(goTerm.replace(/^GO:/i, ''))}`;
  if (func) query += ` AND (cc_function:${quoteQuery(func)} OR ft_act_site:${quoteQuery(func)})`;
  if (organism) query += ` AND ${resolveOrganismFilter(organism)}`;

  return searchSummaries(query, size);
};

const handleSearchByLocalization: ToolHandler = async (args) => {
  const localization = requireString(args, 'localization', 'search_by_localization');
  const organism = optString(args, 'organism');
  const size = args.size;

  let query = `${reviewedQuery(args)} AND cc_subcellular_location:${quoteQuery(localization)}`;
  if (organism) query += ` AND ${resolveOrganismFilter(organism)}`;

  return searchSummaries(query, size);
};

const handleSearchByTaxonomy: ToolHandler = async (args) => {
  const taxonomyId = optNumber(args, 'taxonomyId');
  const taxonomyName = optString(args, 'taxonomyName');
  if (taxonomyId === undefined && !taxonomyName) {
    throw new Error('search_by_taxonomy requires at least one of taxonomyId or taxonomyName');
  }

  const size = args.size;

  let query = reviewedQuery(args);
  if (taxonomyId !== undefined) query += ` AND taxonomy_id:"${taxonomyId}"`;
  if (taxonomyName) query += ` AND taxonomy_name:${quoteQuery(taxonomyName)}`;

  return searchSummaries(query, size);
};

const handleAdvancedSearch: ToolHandler = async (args) => {
  const baseQuery = optString(args, 'query');
  const organism = optString(args, 'organism');
  const minLength = optNumber(args, 'minLength');
  const maxLength = optNumber(args, 'maxLength');
  const minMass = optNumber(args, 'minMass');
  const maxMass = optNumber(args, 'maxMass');
  const keywords = optionalStringArray(args, 'keywords');
  const size = args.size;

  let query = andQuery([
    reviewedQuery(args, baseQuery), baseQuery ? `(${baseQuery})` : undefined,
    organism ? resolveOrganismFilter(organism) : undefined,
  ]);

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
      query += ` AND keyword:${quoteQuery(kw)}`;
    }
  }

  return searchSummaries(query, size);
};

export const searchHandlers: Record<string, ToolHandler> = {
  search_proteins: handleSearchProteins,
  search_by_gene: handleSearchByGene,
  search_by_function: handleSearchByFunction,
  search_by_localization: handleSearchByLocalization,
  search_by_taxonomy: handleSearchByTaxonomy,
  advanced_search: handleAdvancedSearch,
};

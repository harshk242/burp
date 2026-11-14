import type { ToolHandler } from '../../types.js';
import { UpstreamError } from '../../shared/exceptions.js';
import { getToolCallContext } from '../../shared/tool-call-context.js';
import { getClient } from './client.js';

export const SEARCH_TYPES = ['Pathway', 'Reaction', 'Protein', 'Complex'] as const;
const clean = (name: any): string => String(Array.isArray(name) ? name[0] : name ?? 'Unknown').replace(/<[^>]*>/g, '');
const speciesName = (item: any) => item.speciesName ?? item.species?.[0]?.displayName ?? item.species?.[0]?.name ?? item.species?.[0];
const entries = (data: any): any[] => (data.results ?? []).flatMap((g: any) => g.entries ?? []);
const entity = (item: any) => ({
  id: item.stId ?? item.dbId,
  name: clean(item.displayName ?? item.name),
  type: item.schemaClass ?? item.type ?? item.exactType,
  species: speciesName(item),
  url: `https://reactome.org/content/detail/${item.stId ?? item.dbId}`,
});

function required(args: Record<string, unknown>, key: string): string {
  if (typeof args[key] !== 'string' || !args[key]) throw new Error(`${key} is required`);
  return args[key] as string;
}
function size(args: Record<string, unknown>, fallback: number): number {
  if (args.size === undefined) return fallback;
  if (!Number.isInteger(args.size) || Number(args.size) < 1 || Number(args.size) > 100) throw new Error('size must be an integer from 1 to 100');
  return args.size as number;
}
async function search(query: string, params: Record<string, unknown> = {}) {
  return (await getClient().get('/search/query', {
    params: { query, cluster: true, 'Force filters': true, ...params },
  })).data;
}
async function resolvePathwayId(identifier: string): Promise<string> {
  if (/^R-[A-Z]{3}-\d+$/.test(identifier)) return identifier;
  const first = entries(await search(identifier, { types: 'Pathway', rows: 1 }))[0];
  if (!first?.stId) throw new Error(`No pathway found for identifier: ${identifier}. Try a Reactome stable identifier or search first.`);
  return first.stId;
}
const participants = async (id: string): Promise<any[]> =>
  (await getClient().get(`/data/participants/${encodeURIComponent(id)}/participatingPhysicalEntities`)).data;
const events = async (id: string): Promise<any[]> =>
  (await getClient().get(`/data/pathway/${encodeURIComponent(id)}/containedEvents`)).data;

async function interactors(accessions: string[]): Promise<any | null> {
  try {
    return (await getClient().post('/interactors/static/molecules/details', accessions.join(','), { headers: { 'Content-Type': 'text/plain' } })).data;
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) {
      const raw = (error.cause as { response?: { data?: unknown } })?.response?.data;
      let data: any = raw;
      if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        try { data = JSON.parse(raw); } catch (parseError) { throw error; }
      }
      if (data?.code === 404 && Array.isArray(data.messages) && data.messages.length > 0 &&
          data.messages.every((message: string) => message.startsWith('No interactors found for accession: ') &&
            [...accessions, accessions.join(",")].includes(message.slice('No interactors found for accession: '.length)))) return null;
    }
    throw error;
  }
}

async function handleSearchPathways(args: Record<string, unknown>) {
  const query = required(args, 'query');
  if (args.type !== undefined && !SEARCH_TYPES.includes(args.type as any)) throw new Error('Invalid search type');
  const data = await search(query, { types: args.type ?? 'Pathway', rows: size(args, 20) });
  const results = entries(data).slice(0, size(args, 20));
  return { query, totalResults: data.numberOfMatches ?? 0, returnedResults: results.length, results: results.map(entity) };
}
async function handleGetPathwayDetails(args: Record<string, unknown>) {
  const id = await resolvePathwayId(required(args, 'id'));
  const basicInfo = (await getClient().get(`/data/query/${id}`)).data;
  return { id, originalQuery: args.id, basicInfo, components: await events(id), participants: await participants(id),
    url: `https://reactome.org/content/detail/${id}`, diagramUrl: `https://reactome.org/PathwayBrowser/#/${id}` };
}
async function handleFindPathwaysByGene(args: Record<string, unknown>) {
  const gene = required(args, 'gene');
  const species = args.species === undefined ? 'Homo sapiens' : required(args, 'species');
  const proteins = entries(await search(gene, { types: 'Protein', species, rows: 1 }));
  if (!proteins.length) return { gene, species, message: 'No protein entity found for this gene and species', pathways: [] };
  const protein = proteins[0];
  const pathways = (await getClient().get(`/data/pathways/low/entity/${encodeURIComponent(protein.stId)}`)).data;
  return { gene, species, protein: entity(protein), pathwayCount: pathways.length, pathways: pathways.map(entity) };
}
async function handleFindPathwaysByDisease(args: Record<string, unknown>) {
  const disease = required(args, 'disease');
  const pathways = entries(await search(disease, { types: 'Pathway', rows: size(args, 25) })).slice(0, size(args, 25));
  return { disease, pathwayCount: pathways.length, pathways: pathways.map(entity) };
}
async function handleGetPathwayHierarchy(args: Record<string, unknown>) {
  const pathwayId = await resolvePathwayId(required(args, 'id'));
  const info = (await getClient().get(`/data/query/${pathwayId}`)).data;
  const paths: any[][] = (await getClient().get(`/data/event/${pathwayId}/ancestors`)).data;
  const ancestors = [...new Map(paths.flat().filter(p => p.stId !== pathwayId).map(p => [p.stId ?? p.dbId, p])).values()];
  return { pathwayId, originalQuery: args.id, basicInfo: entity(info),
    ancestors: ancestors.map(entity), children: (info.hasEvent ?? []).map(entity) };
}
async function handleGetPathwayParticipants(args: Record<string, unknown>) {
  const pathwayId = await resolvePathwayId(required(args, 'id'));
  const molecules = await participants(pathwayId);
  return { pathwayId, originalQuery: args.id, participantCount: molecules.length, participants: molecules.map(entity) };
}
async function handleGetPathwayReactions(args: Record<string, unknown>) {
  const pathwayId = await resolvePathwayId(required(args, 'id'));
  const reactions = (await events(pathwayId)).filter(e => ['Reaction', 'BlackBoxEvent', 'Polymerisation', 'Depolymerisation'].includes(e.schemaClass));
  return { pathwayId, originalQuery: args.id, reactionCount: reactions.length, reactions: reactions.map(entity) };
}
async function handleGetProteinInteractions(args: Record<string, unknown>) {
  const pathwayId = await resolvePathwayId(required(args, 'pathwayId'));
  const api = getClient();
  const info = (await api.get(`/data/query/${pathwayId}`)).data;
  const refs: any[] = (await api.get(`/data/participants/${pathwayId}/referenceEntities`)).data;
  const proteins = refs.filter(p => p.databaseName === 'UniProt');
  const ids = new Set(proteins.map(p => p.identifier));
  const interactions = new Map<string, unknown>();
  const noInteractorsFor: string[] = [];
  const context = getToolCallContext();
  const accessions = [...ids];
  const skippedAccessions = accessions.slice(1000);
  let queriedAccessions = 0;
  // At most ten batches; shared HTTP context also bounds each request by the deadline.
  for (let offset = 0; offset < Math.min(accessions.length, 1000); offset += 100) {
    if (context && (context.remainingMs() <= 0 || context.cancelled)) {
      skippedAccessions.push(...accessions.slice(offset, 1000));
      break;
    }
    const batch = accessions.slice(offset, Math.min(offset + 100, 1000));
    const data = await interactors(batch);
    queriedAccessions += batch.length;
    if (data === null) { noInteractorsFor.push(...batch); continue; }
    // Successful batch responses omit accessions with no interactors.
    const returned = new Set((data.entities ?? []).map((source: any) => source.acc));
    noInteractorsFor.push(...batch.filter(acc => !returned.has(acc)));
    for (const source of data.entities ?? []) {
      if (!ids.has(source.acc)) continue;
      for (const partner of source.interactors ?? []) {
        if (!ids.has(partner.acc)) continue;
        const key = [source.acc, partner.acc].sort().join(':');
        interactions.set(key, { source: source.acc, target: partner.acc, name: clean(partner.alias),
          score: partner.score, evidences: partner.evidences });
      }
    }
  }
  return { pathwayId, originalQuery: args.pathwayId, basicInfo: entity(info),
    proteinCount: proteins.length, proteins: proteins.map(p => ({ identifier: p.identifier, name: clean(p.name) })),
    interactionCount: interactions.size, interactions: [...interactions.values()],
    noInteractorsFor, queriedAccessions, skippedAccessions, truncated: skippedAccessions.length > 0,
    note: 'Static Reactome interactors restricted to pairs of UniProt accessions participating in this pathway. An empty list means no pairs were returned. At most 1000 unique accessions in batches of 100; skippedAccessions reports work omitted by the cap or deadline. noInteractorsFor lists queried accessions with no interactors; other HTTP failures propagate.' };
}
export const handlers: Record<string, ToolHandler> = {
  search_pathways: handleSearchPathways, get_pathway_details: handleGetPathwayDetails,
  find_pathways_by_gene: handleFindPathwaysByGene, find_pathways_by_disease: handleFindPathwaysByDisease,
  get_pathway_hierarchy: handleGetPathwayHierarchy, get_pathway_participants: handleGetPathwayParticipants,
  get_pathway_reactions: handleGetPathwayReactions, get_protein_interactions: handleGetProteinInteractions,
};

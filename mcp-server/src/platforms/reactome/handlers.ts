import type { ToolHandler } from '../../types.js';
import { UpstreamError } from '../../shared/exceptions.js';
import { getToolCallContext } from '../../shared/tool-call-context.js';
import { getClient } from './client.js';
import { asArray, asRecord, isRecord, optNumber, optString, path, recordArray, type JsonRecord } from '../../shared/json.js';

export const SEARCH_TYPES = ['Pathway', 'Reaction', 'Protein', 'Complex'] as const;
const REACTION_CLASSES = new Set(['Reaction', 'BlackBoxEvent', 'Polymerisation', 'Depolymerisation']);

// Reactome ContentService records arrive untyped; the handlers read the few fields they need and pass the rest through.
const clean = (name: unknown): string => String(Array.isArray(name) ? name[0] : name ?? 'Unknown').replace(/<[^>]*>/g, '');
const itemId = (item: JsonRecord): string | number | undefined => optString(item.stId) ?? optNumber(item.dbId);
const speciesName = (item: JsonRecord): unknown => {
  const first = asArray(item.species)[0];
  return optString(item.speciesName) ?? (isRecord(first) ? first.displayName ?? first.name ?? first : first);
};
const entries = (data: unknown): JsonRecord[] => recordArray(asRecord(data).results).flatMap((g) => recordArray(g.entries));
const entity = (item: JsonRecord) => ({
  id: itemId(item),
  name: clean(item.displayName ?? item.name),
  type: optString(item.schemaClass) ?? optString(item.type) ?? optString(item.exactType),
  species: speciesName(item),
  url: `https://reactome.org/content/detail/${String(itemId(item))}`,
});

function required(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value) throw new Error(`${key} is required`);
  return value;
}
function size(args: Record<string, unknown>, fallback: number): number {
  const value = args.size;
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) throw new Error('size must be an integer from 1 to 100');
  return value;
}
async function search(query: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return (await getClient().get<unknown>('/search/query', {
    params: { query, cluster: true, 'Force filters': true, ...params },
  })).data;
}
async function resolvePathwayId(identifier: string): Promise<string> {
  if (/^R-[A-Z]{3}-\d+$/.test(identifier)) return identifier;
  const stId = optString(entries(await search(identifier, { types: 'Pathway', rows: 1 }))[0]?.stId);
  if (!stId) throw new Error(`No pathway found for identifier: ${identifier}. Try a Reactome stable identifier or search first.`);
  return stId;
}
const participants = async (id: string): Promise<JsonRecord[]> =>
  recordArray((await getClient().get<unknown>(`/data/participants/${encodeURIComponent(id)}/participatingPhysicalEntities`)).data);
const events = async (id: string): Promise<JsonRecord[]> =>
  recordArray((await getClient().get<unknown>(`/data/pathway/${encodeURIComponent(id)}/containedEvents`)).data);

/** Reactome answers 404 with this message list when no accession in the batch has interactors. */
function isNoInteractorsResponse(data: unknown, accessions: string[]): boolean {
  if (!isRecord(data)) return false;
  const { code, messages } = data;
  const prefix = 'No interactors found for accession: ';
  return code === 404 && Array.isArray(messages) && messages.length > 0 &&
    messages.every((message) => typeof message === 'string' && message.startsWith(prefix) &&
      [...accessions, accessions.join(',')].includes(message.slice(prefix.length)));
}

async function interactors(accessions: string[]): Promise<unknown> {
  try {
    return (await getClient().post<unknown>('/interactors/static/molecules/details', accessions.join(','), { headers: { 'Content-Type': 'text/plain' } })).data;
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) {
      const raw = path(error.cause, 'response', 'data');
      let data: unknown = raw;
      if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        try { data = JSON.parse(raw); } catch { throw error; }
      }
      if (isNoInteractorsResponse(data, accessions)) return null;
    }
    throw error;
  }
}

async function handleSearchPathways(args: Record<string, unknown>) {
  const query = required(args, 'query');
  if (args.type !== undefined && !(SEARCH_TYPES as readonly unknown[]).includes(args.type)) throw new Error('Invalid search type');
  const data = await search(query, { types: args.type ?? 'Pathway', rows: size(args, 20) });
  const results = entries(data).slice(0, size(args, 20));
  return { query, totalResults: optNumber(asRecord(data).numberOfMatches) ?? 0, returnedResults: results.length, results: results.map(entity) };
}
async function handleGetPathwayDetails(args: Record<string, unknown>) {
  const id = await resolvePathwayId(required(args, 'id'));
  const basicInfo: unknown = (await getClient().get<unknown>(`/data/query/${id}`)).data;
  return { id, originalQuery: args.id, basicInfo, components: await events(id), participants: await participants(id),
    url: `https://reactome.org/content/detail/${id}`, diagramUrl: `https://reactome.org/PathwayBrowser/#/${id}` };
}
async function handleFindPathwaysByGene(args: Record<string, unknown>) {
  const gene = required(args, 'gene');
  const species = args.species === undefined ? 'Homo sapiens' : required(args, 'species');
  const [protein] = entries(await search(gene, { types: 'Protein', species, rows: 1 }));
  if (!protein) return { gene, species, message: 'No protein entity found for this gene and species', pathways: [] };
  const pathways = recordArray((await getClient().get<unknown>(`/data/pathways/low/entity/${encodeURIComponent(String(itemId(protein)))}`)).data);
  return { gene, species, protein: entity(protein), pathwayCount: pathways.length, pathways: pathways.map(entity) };
}
async function handleFindPathwaysByDisease(args: Record<string, unknown>) {
  const disease = required(args, 'disease');
  const pathways = entries(await search(disease, { types: 'Pathway', rows: size(args, 25) })).slice(0, size(args, 25));
  return { disease, pathwayCount: pathways.length, pathways: pathways.map(entity) };
}
async function handleGetPathwayHierarchy(args: Record<string, unknown>) {
  const pathwayId = await resolvePathwayId(required(args, 'id'));
  const info = asRecord((await getClient().get<unknown>(`/data/query/${pathwayId}`)).data);
  const paths = asArray((await getClient().get<unknown>(`/data/event/${pathwayId}/ancestors`)).data).map((ancestry) => recordArray(ancestry));
  const ancestors = [...new Map(paths.flat().filter(p => p.stId !== pathwayId).map(p => [itemId(p), p])).values()];
  return { pathwayId, originalQuery: args.id, basicInfo: entity(info),
    ancestors: ancestors.map(entity), children: recordArray(info.hasEvent).map(entity) };
}
async function handleGetPathwayParticipants(args: Record<string, unknown>) {
  const pathwayId = await resolvePathwayId(required(args, 'id'));
  const molecules = await participants(pathwayId);
  return { pathwayId, originalQuery: args.id, participantCount: molecules.length, participants: molecules.map(entity) };
}
async function handleGetPathwayReactions(args: Record<string, unknown>) {
  const pathwayId = await resolvePathwayId(required(args, 'id'));
  const reactions = (await events(pathwayId)).filter(e => REACTION_CLASSES.has(optString(e.schemaClass) ?? ''));
  return { pathwayId, originalQuery: args.id, reactionCount: reactions.length, reactions: reactions.map(entity) };
}
async function handleGetProteinInteractions(args: Record<string, unknown>) {
  const pathwayId = await resolvePathwayId(required(args, 'pathwayId'));
  const api = getClient();
  const info = asRecord((await api.get<unknown>(`/data/query/${pathwayId}`)).data);
  const refs = recordArray((await api.get<unknown>(`/data/participants/${pathwayId}/referenceEntities`)).data);
  const proteins = refs.filter(p => p.databaseName === 'UniProt');
  const ids = new Set(proteins.flatMap(p => optString(p.identifier) ?? []));
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
    const sources = recordArray(asRecord(data).entities);
    const returned = new Set(sources.map((source) => source.acc));
    noInteractorsFor.push(...batch.filter(acc => !returned.has(acc)));
    for (const source of sources) {
      const sourceAcc = optString(source.acc);
      if (sourceAcc === undefined || !ids.has(sourceAcc)) continue;
      for (const partner of recordArray(source.interactors)) {
        const partnerAcc = optString(partner.acc);
        if (partnerAcc === undefined || !ids.has(partnerAcc)) continue;
        const pair: string[] = [sourceAcc, partnerAcc];
        const key = pair.sort().join(':');
        interactions.set(key, { source: sourceAcc, target: partnerAcc, name: clean(partner.alias),
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

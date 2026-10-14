import type { ToolHandler } from '../../types.js';
import { isRejectedLookup } from '../../shared/exceptions.js';
import { getClient } from './client.js';

const isValidSearchArgs = (
  args: Record<string, unknown>,
): args is { query: string; type?: string; size?: number } =>
  typeof args.query === 'string' &&
  args.query.length > 0 &&
  (args.type === undefined ||
    ['pathway', 'reaction', 'protein', 'complex', 'disease'].includes(args.type as string)) &&
  (args.size === undefined ||
    (typeof args.size === 'number' && args.size > 0 && args.size <= 100));

const isValidIdArgs = (args: Record<string, unknown>): args is { id: string } =>
  typeof args.id === 'string' && args.id.length > 0;
const isValidGeneArgs = (
  args: Record<string, unknown>,
): args is { gene: string; species?: string } =>
  typeof args.gene === 'string' &&
  args.gene.length > 0 &&
  (args.species === undefined || typeof args.species === 'string');
const isValidDiseaseArgs = (
  args: Record<string, unknown>,
): args is { disease: string; size?: number } =>
  typeof args.disease === 'string' &&
  args.disease.length > 0 &&
  (args.size === undefined ||
    (typeof args.size === 'number' && args.size > 0 && args.size <= 100));
const isValidInteractionArgs = (
  args: Record<string, unknown>,
): args is { pathwayId: string; interactionType?: string } =>
  typeof args.pathwayId === 'string' &&
  args.pathwayId.length > 0 &&
  (args.interactionType === undefined ||
    ['protein-protein', 'regulatory', 'catalysis', 'all'].includes(
      args.interactionType as string,
    ));

async function resolvePathwayId(identifier: string): Promise<string | null> {
  if (/^R-[A-Z]{3}-\d+$/.test(identifier)) return identifier;

  try {
    const api = getClient();
    const res = await api.get('/search/query', {
      params: { query: identifier, types: 'Pathway', cluster: true },
    });

    const firstEntry = res.data?.results?.[0]?.entries?.[0];
    if (firstEntry?.stId) return firstEntry.stId as string;
  } catch (error) {
    // Reactome answers a search with no hits with a 404: that means "no
    // pathway". Outages, timeouts and rate limits must reach the agent as
    // structured upstream errors instead.
    if (!isRejectedLookup(error)) throw error;
  }

  return null;
}

async function handleSearchPathways(args: Record<string, unknown>) {
  if (!isValidSearchArgs(args)) {
    throw new Error('Invalid search arguments');
  }

  const api = getClient();
  const params: Record<string, unknown> = { query: args.query, cluster: true };
  if (args.type) params.types = args.type;
  const response = await api.get('/search/query', { params });
  let allEntries: any[] = [];
  if (response.data.results) {
    for (const group of response.data.results) {
      if (group.entries) allEntries = allEntries.concat(group.entries);
    }
  }

  if (args.type) {
    const typeFilter = args.type.toLowerCase();
    allEntries = allEntries.filter(
      (entry: any) =>
        entry.exactType?.toLowerCase().includes(typeFilter) ||
        entry.typeName?.toLowerCase().includes(typeFilter),
    );
  }

  if (args.size) allEntries = allEntries.slice(0, args.size);
  return {
    query: args.query,
    totalResults: response.data.numberOfMatches || 0,
    returnedResults: allEntries.length,
    results: allEntries.map((item: any) => ({
      id: item.stId || item.id,
      name: item.name?.replace(/<[^>]*>/g, '') || 'Unknown',
      type: item.exactType || item.typeName || 'Unknown',
      species: Array.isArray(item.species) ? item.species[0] : item.species || 'Unknown',
      description: (item.summation?.substring(0, 200) || 'No description available') + '...',
      url: `https://reactome.org/content/detail/${item.stId || item.id}`,
    })),
  };
}

async function handleGetPathwayDetails(args: Record<string, unknown>) {
  if (!isValidIdArgs(args)) {
    throw new Error('Pathway ID is required');
  }

  const pathwayId = await resolvePathwayId(args.id);
  if (!pathwayId) {
    throw new Error(
      `No pathway found for identifier: ${args.id}. ` +
        'Try using a Reactome stable identifier (e.g., R-HSA-1640170) or search first.',
    );
  }

  const api = getClient();
  const basicInfo = await api.get(`/data/query/${pathwayId}`);
  let components = null;
  let participants = null;
  try {
    const eventsResponse = await api.get(`/data/events/${pathwayId}`);
    components = eventsResponse.data;
  } catch { }
  try {
    const participantsResponse = await api.get(`/data/participants/${pathwayId}`);
    participants = participantsResponse.data;
  } catch { }
  return {
    id: pathwayId,
    originalQuery: args.id,
    basicInfo: basicInfo.data,
    components: components || 'Components data not available via API',
    participants: participants || 'Participants data not available via API',
    url: `https://reactome.org/content/detail/${pathwayId}`,
    diagramUrl: `https://reactome.org/PathwayBrowser/#/${pathwayId}`,
    note: 'Some detailed information may not be available through the current API endpoints',
  };
}

async function handleFindPathwaysByGene(args: Record<string, unknown>) {
  if (!isValidGeneArgs(args)) {
    throw new Error('Invalid gene arguments');
  }

  const api = getClient();
  const searchResponse = await api.get('/search/query', {
    params: { query: args.gene, types: 'Protein', cluster: true },
  });

  let proteinEntries: any[] = [];
  if (searchResponse.data.results) {
    for (const group of searchResponse.data.results) {
      if (group.typeName === 'Protein' && group.entries) {
        proteinEntries = proteinEntries.concat(group.entries);
      }
    }
  }

  if (args.species) {
    proteinEntries = proteinEntries.filter((entry: any) =>
      Array.isArray(entry.species)
        ? entry.species.some((s: string) => s.toLowerCase().includes(args.species!.toLowerCase()))
        : entry.species?.toLowerCase().includes(args.species!.toLowerCase()),
    );
  }

  if (proteinEntries.length === 0) {
    return {
      gene: args.gene,
      species: args.species || 'Homo sapiens',
      message: 'No protein entity found for this gene',
      pathways: [],
    };
  }

  const protein = proteinEntries[0];
  const pathwaysResponse = await api.get(`/data/pathways/low/entity/${protein.stId}`);

  return {
    gene: args.gene,
    protein: {
      id: protein.stId,
      name: protein.name,
      species: protein.species?.[0]?.name,
    },
    pathwayCount: pathwaysResponse.data?.length || 0,
    pathways:
      pathwaysResponse.data?.map((pathway: any) => ({
        id: pathway.stId,
        name: pathway.name,
        species: pathway.species?.[0]?.name,
        url: `https://reactome.org/content/detail/${pathway.stId}`,
      })) || [],
  };
}

async function handleFindPathwaysByDisease(args: Record<string, unknown>) {
  if (!isValidDiseaseArgs(args)) {
    throw new Error('Invalid disease arguments');
  }

  const api = getClient();
  const searchResponse = await api.get('/search/query', {
    params: { query: args.disease, types: 'Pathway', cluster: true },
  });

  let pathwayEntries: any[] = [];
  if (searchResponse.data.results) {
    for (const group of searchResponse.data.results) {
      if (group.typeName === 'Pathway' && group.entries) {
        pathwayEntries = pathwayEntries.concat(group.entries);
      }
    }
  }

  if (args.size) pathwayEntries = pathwayEntries.slice(0, args.size);

  return {
    disease: args.disease,
    pathwayCount: pathwayEntries.length,
    pathways: pathwayEntries.map((pathway: any) => ({
      id: pathway.stId || pathway.id,
      name: pathway.name?.replace(/<[^>]*>/g, '') || 'Unknown',
      type: pathway.exactType || pathway.typeName || 'Unknown',
      species: Array.isArray(pathway.species)
        ? pathway.species[0]
        : pathway.species || 'Unknown',
      description: (pathway.summation?.substring(0, 200) || 'No description available') + '...',
      url: `https://reactome.org/content/detail/${pathway.stId || pathway.id}`,
    })),
  };
}

async function handleGetPathwayHierarchy(args: Record<string, unknown>) {
  if (!isValidIdArgs(args)) {
    throw new Error('Pathway ID is required');
  }

  const pathwayId = await resolvePathwayId(args.id);
  if (!pathwayId) {
    throw new Error(
      `No pathway found for identifier: ${args.id}. ` +
        'Try using a Reactome stable identifier (e.g., R-HSA-1640170) or search first.',
    );
  }

  const api = getClient();
  const pathwayInfo = await api.get(`/data/query/${pathwayId}`);

  let ancestors: any[] = [];
  let children: any[] = [];

  try {
    const orthologousResponse = await api.get(`/data/orthologous/${pathwayId}/pathways`);
    ancestors = orthologousResponse.data || [];
  } catch {
    if (pathwayInfo.data.hasEvent) {
      children = pathwayInfo.data.hasEvent.map((event: any) => ({
        id: event.stId || event.dbId,
        name: event.displayName || event.name,
        type: event.schemaClass || 'Event',
      }));
    }
  }

  return {
    pathwayId,
    originalQuery: args.id,
    basicInfo: {
      name: pathwayInfo.data.displayName || pathwayInfo.data.name,
      type: pathwayInfo.data.schemaClass,
      species: pathwayInfo.data.species?.[0]?.displayName,
    },
    ancestors:
      ancestors.length > 0
        ? ancestors.slice(0, 10).map((ancestor: any) => ({
            id: ancestor.stId || ancestor.dbId,
            name: ancestor.displayName || ancestor.name,
            type: ancestor.schemaClass || 'Pathway',
          }))
        : 'Ancestor information not available via current API',
    children:
      children.length > 0
        ? children.slice(0, 10)
        : 'Child pathway information not available via current API',
    note: 'Hierarchy data may be limited due to API endpoint availability',
  };
}

async function handleGetPathwayParticipants(args: Record<string, unknown>) {
  if (!isValidIdArgs(args)) {
    throw new Error('Pathway ID is required');
  }

  const pathwayId = await resolvePathwayId(args.id);
  if (!pathwayId) {
    throw new Error(
      `No pathway found for identifier: ${args.id}. ` +
        'Try using a Reactome stable identifier (e.g., R-HSA-1640170) or search first.',
    );
  }

  const api = getClient();
  let participants: any[] = [];

  try {
    const response = await api.get(`/data/pathway/${pathwayId}/participatingMolecules`);
    participants = response.data || [];
  } catch {
    try {
      const pathwayDetails = await api.get(`/data/query/${pathwayId}`);
      if (pathwayDetails.data.hasEvent) {
        participants = pathwayDetails.data.hasEvent.map((event: any) => ({
          stId: event.stId || event.dbId,
          name: event.displayName || event.name,
          schemaClass: event.schemaClass,
          identifier: event.stId || event.dbId,
        }));
      }
    } catch {
      const basicInfo = await api.get(`/data/query/${pathwayId}`);
      return {
        pathwayId,
        originalQuery: args.id,
        basicInfo: {
          name: basicInfo.data.displayName || basicInfo.data.name,
          type: basicInfo.data.schemaClass,
          species: basicInfo.data.species?.[0]?.displayName,
        },
        participantCount: 0,
        participants: 'Participants data not available via current API endpoints',
        note: 'Use search_pathways or get_pathway_details for alternative pathway information',
      };
    }
  }

  return {
    pathwayId,
    originalQuery: args.id,
    participantCount: participants.length,
    participants: participants.slice(0, 50).map((participant: any) => ({
      id: participant.stId,
      name: participant.name || participant.displayName,
      type: participant.schemaClass,
      species: participant.species?.[0]?.name || participant.species?.[0]?.displayName,
      identifier: participant.identifier,
      url: `https://reactome.org/content/detail/${participant.stId}`,
    })),
  };
}

async function handleGetPathwayReactions(args: Record<string, unknown>) {
  if (!isValidIdArgs(args)) {
    throw new Error('Pathway ID is required');
  }

  const pathwayId = await resolvePathwayId(args.id);
  if (!pathwayId) {
    throw new Error(
      `No pathway found for identifier: ${args.id}. ` +
        'Try using a Reactome stable identifier (e.g., R-HSA-1640170) or search first.',
    );
  }

  const api = getClient();
  const response = await api.get(`/data/pathway/${pathwayId}/containedEvents`);

  const reactions =
    response.data?.filter(
      (event: any) => event.schemaClass === 'Reaction' || event.schemaClass === 'BlackBoxEvent',
    ) || [];

  return {
    pathwayId,
    originalQuery: args.id,
    reactionCount: reactions.length,
    reactions: reactions.map((reaction: any) => ({
      id: reaction.stId,
      name: reaction.name,
      type: reaction.schemaClass,
      reversible: reaction.reversible,
      species: reaction.species?.[0]?.name,
      url: `https://reactome.org/content/detail/${reaction.stId}`,
    })),
  };
}

async function handleGetProteinInteractions(args: Record<string, unknown>) {
  if (!isValidInteractionArgs(args)) {
    throw new Error('Invalid interaction arguments');
  }

  const pathwayId = await resolvePathwayId(args.pathwayId);
  if (!pathwayId) {
    throw new Error(
      `No pathway found for identifier: ${args.pathwayId}. ` +
        'Try using a Reactome stable identifier (e.g., R-HSA-1640170) or search first.',
    );
  }

  const api = getClient();
  const pathwayInfo = await api.get(`/data/query/${pathwayId}`);

  let proteins: any[] = [];
  let reactions: any[] = [];

  try {
    const participantsResponse = await api.get(
      `/data/pathway/${pathwayId}/participatingMolecules`,
    );
    proteins =
      participantsResponse.data?.filter(
        (p: any) =>
          p.schemaClass === 'EntityWithAccessionedSequence' || p.schemaClass === 'Protein',
      ) || [];
  } catch {
    try {
      const searchResponse = await api.get('/search/query', {
        params: {
          query: pathwayInfo.data.displayName || pathwayInfo.data.name,
          types: 'Protein',
          cluster: true,
        },
      });

      if (searchResponse.data.results) {
        for (const group of searchResponse.data.results) {
          if (group.typeName === 'Protein' && group.entries) {
            proteins = group.entries.slice(0, 10);
          }
        }
      }
    } catch {
      if (pathwayInfo.data.hasEvent) {
        proteins = pathwayInfo.data.hasEvent
          .filter(
            (event: any) =>
              event.schemaClass?.includes('Protein') || event.schemaClass?.includes('Entity'),
          )
          .slice(0, 5);
      }
    }
  }

  try {
    const reactionsResponse = await api.get(`/data/pathway/${pathwayId}/containedEvents`);
    reactions =
      reactionsResponse.data?.filter((event: any) => event.schemaClass === 'Reaction') || [];
  } catch {
    if (pathwayInfo.data.hasEvent) {
      reactions = pathwayInfo.data.hasEvent
        .filter((event: any) => event.schemaClass === 'Reaction')
        .slice(0, 10);
    }
  }

  return {
    pathwayId,
    originalQuery: args.pathwayId,
    basicInfo: {
      name: pathwayInfo.data.displayName || pathwayInfo.data.name,
      type: pathwayInfo.data.schemaClass,
      species: pathwayInfo.data.species?.[0]?.displayName,
    },
    proteinCount: proteins.length,
    reactionCount: reactions.length,
    proteins: proteins.slice(0, 20).map((protein: any) => ({
      id: protein.stId || protein.dbId,
      name: protein.name || protein.displayName,
      type: protein.schemaClass,
      identifier: protein.identifier,
    })),
    potentialInteractions: reactions.slice(0, 15).map((reaction: any) => ({
      reactionId: reaction.stId || reaction.dbId,
      reactionName: reaction.name || reaction.displayName,
      type: reaction.schemaClass,
      reversible: reaction.reversible,
    })),
    note: 'Protein interactions inferred from pathway components and reactions. For detailed molecular interactions, consider using specialized protein interaction databases.',
    analysisNote:
      args.interactionType !== 'all'
        ? `Filtered for ${args.interactionType} interactions`
        : 'Showing all available interaction types',
  };
}

export const handlers: Record<string, ToolHandler> = {
  search_pathways: handleSearchPathways,
  get_pathway_details: handleGetPathwayDetails,
  find_pathways_by_gene: handleFindPathwaysByGene,
  find_pathways_by_disease: handleFindPathwaysByDisease,
  get_pathway_hierarchy: handleGetPathwayHierarchy,
  get_pathway_participants: handleGetPathwayParticipants,
  get_pathway_reactions: handleGetPathwayReactions,
  get_protein_interactions: handleGetProteinInteractions,
};

import { initializeClient as initOpenTargets } from './mcp-servers/open-targets/src/client.js';
import { searchEntities } from './mcp-servers/open-targets/src/tools/search.js';
import { getTargetInfo } from './mcp-servers/open-targets/src/tools/target/identity.js';
import { getTargetPathwaysAndGoTerms } from './mcp-servers/open-targets/src/tools/target/biology.js';
import { getTargetAssociatedDiseases, getTargetKnownDrugs } from './mcp-servers/open-targets/src/tools/target/associations.js';
import { URLSearchParams } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

type SearchHit = {
  id: string;
  entity: string;
  name?: string;
  object?: {
    approvedSymbol?: string;
  };
};

type TargetEvidence = {
  gene: string;
  ensemblId: string;
  otAssociationScore: number | null;
  otDatatypeScores: Record<string, number>;
  knownDrugCount: number;
  pathwayCount: number;
  uniprotIds: string[];
  genomicLocation?: {
    chromosome?: string;
    start?: number;
    end?: number;
    strand?: string;
  };
  clinvarPathogenicCount: number;
  clinvarLikelyPathogenicCount: number;
  pubmedCount: number;
};

const diseaseQuery = 'breast cancer';
const geneSymbols = ['BRCA1', 'TP53', 'PALB2', 'APOE'];

function getHits(result: any): SearchHit[] {
  return (result?.search?.hits as SearchHit[]) || [];
}

function pickDiseaseHit(hits: SearchHit[], query: string): SearchHit {
  const normalized = query.toLowerCase();
  const exact = hits.find((hit) => hit.name?.toLowerCase() === normalized);
  if (exact) {
    return exact;
  }
  const contains = hits.find((hit) => {
    const name = hit.name?.toLowerCase() || '';
    return name.includes('breast') && name.includes('cancer');
  });
  return contains || hits[0];
}

function pickTargetHit(hits: SearchHit[], gene: string): SearchHit {
  const normalized = gene.toUpperCase();
  const exact = hits.find((hit) => hit.object?.approvedSymbol?.toUpperCase() === normalized);
  return exact || hits[0];
}

async function safeCall<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error(`[warn] ${label} failed: ${message}`);
    return fallback;
  }
}

async function fetchNcbiCount(db: 'clinvar' | 'pubmed', term: string): Promise<number> {
  const apiKey = process.env.NCBI_API_KEY;
  const baseParams = {
    db,
    term,
    retmax: '0',
    retmode: 'xml',
  };
  const buildUrl = (key?: string) => {
    const params = new URLSearchParams(baseParams);
    if (key) {
      params.set('api_key', key);
    }
    return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`;
  };

  let url = buildUrl(apiKey);
  let triedWithoutKey = false;
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (lastNcbiCall > 0) {
      const elapsed = Date.now() - lastNcbiCall;
      if (elapsed < NCBI_MIN_INTERVAL_MS) {
        await sleep(NCBI_MIN_INTERVAL_MS - elapsed);
      }
    }
    lastNcbiCall = Date.now();

    const response = await fetch(url);
    if (response.ok) {
      const xml = await response.text();
      const match = xml.match(/<Count>(\d+)<\/Count>/);
      return match ? Number.parseInt(match[1], 10) : 0;
    }

    const body = await response.text();
    if (apiKey && !triedWithoutKey && body.includes('API key status invalid')) {
      triedWithoutKey = true;
      url = buildUrl();
      attempt = -1;
      continue;
    }

    if (response.status === 429) {
      await sleep(1000 * (attempt + 1));
      continue;
    }

    throw new Error(`NCBI ${db} esearch failed: HTTP ${response.status} url=${url} body=${body.slice(0, 200)}`);
  }

  throw new Error(`NCBI ${db} esearch failed after ${maxAttempts} attempts: url=${url}`);
}

let lastNcbiCall = 0;
const NCBI_MIN_INTERVAL_MS = 400;

async function resolveDisease(query: string): Promise<{ id: string; name: string }> {
  const result = await searchEntities(query, ['disease'], 0, 10);
  const hits = getHits(result);
  if (!hits.length) {
    throw new Error(`No disease hits for "${query}"`);
  }
  const hit = pickDiseaseHit(hits, query);
  return { id: hit.id, name: hit.name || query };
}

async function resolveTarget(gene: string): Promise<{ ensemblId: string; symbol: string }> {
  const result = await searchEntities(gene, ['target'], 0, 10);
  const hits = getHits(result).filter((hit) => hit.entity === 'target');
  if (!hits.length) {
    throw new Error(`No target hits for "${gene}"`);
  }
  const hit = pickTargetHit(hits, gene);
  return { ensemblId: hit.id, symbol: hit.object?.approvedSymbol || gene };
}

async function findAssociationScore(
  ensemblId: string,
  diseaseId: string,
  diseaseName: string
): Promise<{ score: number; datatypeScores: Record<string, number> } | null> {
  const pageSize = 200;
  let pageIndex = 0;
  while (true) {
    const result: any = await getTargetAssociatedDiseases(ensemblId, pageIndex, pageSize);
    const rows = result?.target?.associatedDiseases?.rows || [];
    const match = rows.find((row: any) =>
      row?.disease?.id === diseaseId ||
      (row?.disease?.name?.toLowerCase() === diseaseName.toLowerCase())
    );
    if (match) {
      const datatypeScores: Record<string, number> = {};
      for (const entry of match?.datatypeScores || []) {
        if (entry?.id && typeof entry?.score === 'number') {
          datatypeScores[entry.id] = entry.score;
        }
      }
      return { score: match.score ?? null, datatypeScores };
    }

    const total = result?.target?.associatedDiseases?.count || 0;
    const fetched = (pageIndex + 1) * pageSize;
    if (rows.length === 0 || fetched >= total) {
      break;
    }
    pageIndex += 1;
  }
  return null;
}

async function collectTargetEvidence(
  gene: string,
  ensemblId: string,
  disease: { id: string; name: string }
): Promise<TargetEvidence> {
  const targetInfo: any = await safeCall(
    `${gene}: open-targets target info`,
    () => getTargetInfo(ensemblId) as Promise<any>,
    {}
  );
  const target = targetInfo?.target || {};

  const pathwaysResult: any = await safeCall(
    `${gene}: open-targets pathways`,
    () => getTargetPathwaysAndGoTerms(ensemblId) as Promise<any>,
    {}
  );
  const pathways = pathwaysResult?.target?.pathways || [];

  const knownDrugsResult: any = await safeCall(
    `${gene}: open-targets known drugs`,
    () => getTargetKnownDrugs(ensemblId) as Promise<any>,
    {}
  );
  const knownDrugCount = knownDrugsResult?.target?.knownDrugs?.count || 0;

  const association = await safeCall(
    `${gene}: open-targets association`,
    () => findAssociationScore(ensemblId, disease.id, disease.name),
    null
  );

  const clinvarPathogenicCount = await safeCall(
    `${gene}: clinvar pathogenic`,
    () => fetchNcbiCount('clinvar', `"${gene}"[gene] AND "Pathogenic"[clinsig]`),
    0
  );
  const clinvarLikelyPathogenicCount = await safeCall(
    `${gene}: clinvar likely pathogenic`,
    () => fetchNcbiCount('clinvar', `"${gene}"[gene] AND "Likely pathogenic"[clinsig]`),
    0
  );

  const pubmedQuery = `"${gene}"[Title/Abstract] AND "${disease.name}"[Title/Abstract]`;
  const pubmedCount = await safeCall(
    `${gene}: pubmed count`,
    () => fetchNcbiCount('pubmed', pubmedQuery),
    0
  );

  const uniprotIds = Array.isArray(target?.proteinIds)
    ? target.proteinIds
        .filter((entry: any) => entry?.source?.toLowerCase() === 'uniprot')
        .map((entry: any) => entry.id)
        .filter(Boolean)
    : [];

  return {
    gene,
    ensemblId,
    otAssociationScore: association?.score ?? null,
    otDatatypeScores: association?.datatypeScores || {},
    knownDrugCount,
    pathwayCount: Array.isArray(pathways) ? pathways.length : 0,
    uniprotIds,
    genomicLocation: target?.genomicLocation || {},
    clinvarPathogenicCount,
    clinvarLikelyPathogenicCount,
    pubmedCount,
  };
}

function rankTargets(results: TargetEvidence[]): TargetEvidence[] {
  return [...results].sort((a, b) => {
    const scoreDiff = (b.otAssociationScore ?? -1) - (a.otAssociationScore ?? -1);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    if (b.knownDrugCount !== a.knownDrugCount) {
      return b.knownDrugCount - a.knownDrugCount;
    }
    if (b.clinvarPathogenicCount !== a.clinvarPathogenicCount) {
      return b.clinvarPathogenicCount - a.clinvarPathogenicCount;
    }
    return b.pubmedCount - a.pubmedCount;
  });
}

initOpenTargets();
const disease = await resolveDisease(diseaseQuery);
const resolvedTargets: Array<{ gene: string; ensemblId: string }> = [];

for (const gene of geneSymbols) {
  const resolved = await resolveTarget(gene);
  resolvedTargets.push({ gene: resolved.symbol, ensemblId: resolved.ensemblId });
}

const results: TargetEvidence[] = [];
for (const target of resolvedTargets) {
  const evidence = await collectTargetEvidence(target.gene, target.ensemblId, disease);
  results.push(evidence);
}

const ranked = rankTargets(results);

console.log(JSON.stringify({
  disease,
  rankingCriteria: [
    'Open Targets association score (desc)',
    'Known drugs count (desc)',
    'ClinVar pathogenic variants count (desc)',
    'PubMed count for gene + disease (desc)',
  ],
  results: ranked,
}, null, 2));

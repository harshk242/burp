type AnyObject = Record<string, any>;

export async function fetchDatabaseStats(
  request: (endpoint: string, params?: Record<string, unknown>) => Promise<AnyObject>
): Promise<{
  genes: number;
  drugs: number;
  variants: number;
  clinicalAnnotations: number;
  guidelines: number;
  labels: number;
  pathways: number;
  note: string;
}> {
  const stats = {
    genes: 0,
    drugs: 0,
    variants: 0,
    clinicalAnnotations: 0,
    guidelines: 0,
    labels: 0,
    pathways: 0,
    note: 'Counts represent CPIC pharmacogenes and CYP2D6-related data as representative samples',
  };

  try {
    const [genesResult, pathwaysResult] = await Promise.all([
      request('/data/gene', { cpicGene: true }).catch(() => ({ data: [] })),
      request('/data/pathway', { cpicGene: true }).catch(() => ({ data: [] })),
    ]);
    stats.genes = genesResult.data?.length || 0;
    stats.pathways = pathwaysResult.data?.length || 0;
  } catch {
  }

  try {
    const [annotationsResult, guidelinesResult, labelsResult] = await Promise.all([
      request('/data/clinicalAnnotation', { 'location.genes.symbol': 'CYP2D6' }).catch(() => ({ data: [] })),
      request('/data/guidelineAnnotation', { 'relatedGenes.symbol': 'CYP2D6' }).catch(() => ({ data: [] })),
      request('/data/labelAnnotation', { 'relatedGenes.symbol': 'CYP2D6' }).catch(() => ({ data: [] })),
    ]);
    stats.clinicalAnnotations = annotationsResult.data?.length || 0;
    stats.guidelines = guidelinesResult.data?.length || 0;
    stats.labels = labelsResult.data?.length || 0;
  } catch {
  }

  return stats;
}


export const SPECIES_MAP: Record<string, number> = {
  human: 9606,
  'homo sapiens': 9606,
  mouse: 10090,
  'mus musculus': 10090,
  rat: 10116,
  'rattus norvegicus': 10116,
  cow: 9913,
  'bos taurus': 9913,
  dog: 9615,
  'canis lupus familiaris': 9615,
  chimpanzee: 9598,
  'pan troglodytes': 9598,
  rhesus: 9544,
  'macaca mulatta': 9544,
  pig: 9823,
  'sus scrofa': 9823,
  zebrafish: 7955,
  'danio rerio': 7955,
};

const DEFAULT_SPECIES = 'Homo sapiens';

export function resolveSpeciesFilter(
  species?: string[],
): string | undefined {
  if (!species || species.length === 0) {
    return `organism_name:"${DEFAULT_SPECIES}"`;
  }

  const parts = species.map((s) => {
    const trimmed = s.trim();
    if (/^\d+$/.test(trimmed)) {
      return `organism_id:${trimmed}`;
    }
    const lower = trimmed.toLowerCase();
    if (SPECIES_MAP[lower]) {
      return `organism_id:${SPECIES_MAP[lower]}`;
    }
    return `organism_name:"${trimmed}"`;
  });

  if (parts.length === 1) return parts[0];
  return `(${parts.join(' OR ')})`;
}

import { stripEvidences } from './entry-fields.js';
import type { UniProtEntry, UniProtFeature } from './entry-types.js';
import { toFeatures } from './narrow.js';

// UniProt variant descriptions are '; '-separated clauses, e.g.
// "in BC; benign; functionally neutral in vitro; dbSNP:rs80357102". Curators state
// clinical significance as a standalone clause using exactly these terms.
const SIGNIFICANCE_TERMS = new Set([
  'pathogenic', 'likely pathogenic', 'uncertain significance', 'likely benign', 'benign',
]);
const NOT_DISEASE_CAUSING = new Set(['uncertain significance', 'likely benign', 'benign']);
// Negated mentions, e.g. "in a familial cancer not matching LFS".
const NEGATED_MENTION = /\bnot\s+(?:matching|associated\s+with|found\s+in)\b.*$/i;

function clauses(description: string | undefined): string[] {
  return (description ?? '').split(';').map(clause => clause.trim()).filter(Boolean);
}

export function clinicalSignificance(description: string | undefined): string | undefined {
  return clauses(description).map(clause => clause.toLowerCase()).find(clause => SIGNIFICANCE_TERMS.has(clause));
}

function mentionedAcronyms(description: string | undefined, acronyms: string[]): string[] {
  const text = clauses(description).map(clause => clause.replace(NEGATED_MENTION, '')).join('; ');
  return acronyms.filter(acronym => {
    const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`).test(text);
  });
}

export const DISEASE_VARIANT_CRITERION = 'A natural variant whose description names a disease acronym from this entry’s DISEASE comments (negated mentions such as "not matching LFS" ignored) and whose stated clinical significance, if any, is not benign, likely benign or uncertain significance. Those are counted in excludedDiseaseMentionCount and keep clinicalSignificance in naturalVariants. This is UniProt curation, not a clinical pathogenicity classification.';

// Sporadic cancers without a named acronym remain only in naturalVariants.
type AnnotatedVariant = UniProtFeature & { clinicalSignificance?: string };

export function variantSummary(protein: UniProtEntry) {
  const acronyms = [...new Set((protein.comments || [])
    .filter((c) => c.commentType === 'DISEASE')
    .flatMap((c) => c.disease?.acronym ? [c.disease.acronym] : []))];
  const naturalVariants = toFeatures(stripEvidences(protein.features?.filter((f) => f.type === 'Natural variant') || []))
    .map((feature): AnnotatedVariant => {
      const significance = clinicalSignificance(feature.description);
      return significance ? { ...feature, clinicalSignificance: significance } : feature;
    });
  const significanceCounts: Record<string, number> = {};
  const diseaseVariants: (AnnotatedVariant & { diseases: string[] })[] = [];
  let excludedDiseaseMentionCount = 0;
  for (const variant of naturalVariants) {
    if (variant.clinicalSignificance) {
      significanceCounts[variant.clinicalSignificance] = (significanceCounts[variant.clinicalSignificance] || 0) + 1;
    }
    const diseases = mentionedAcronyms(variant.description, acronyms);
    if (diseases.length === 0) continue;
    if (NOT_DISEASE_CAUSING.has(variant.clinicalSignificance ?? '')) excludedDiseaseMentionCount++;
    else diseaseVariants.push({ ...variant, diseases });
  }
  return {
    accession: protein.primaryAccession,
    naturalVariants,
    mutagenesisFeatures: stripEvidences(protein.features?.filter((f) => f.type === 'Mutagenesis') || []),
    diseaseVariants,
    polymorphisms: stripEvidences(protein.comments?.filter((c) => c.commentType === 'POLYMORPHISM') || []),
    naturalVariantCount: naturalVariants.length,
    diseaseVariantCount: diseaseVariants.length,
    excludedDiseaseMentionCount,
    significanceCounts,
    diseaseVariantCriterion: DISEASE_VARIANT_CRITERION,
    diseaseAcronyms: acronyms,
  };
}

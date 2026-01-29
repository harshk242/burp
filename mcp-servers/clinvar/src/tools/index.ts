// Export all tool functions

export {
  searchVariantsByGene,
  getVariantInfo,
  getVCVRecord,
  lookupByCoordinates,
  lookupByRsId,
  batchVariantLookup,
  quickVariantSearch,
} from './variant-lookup.js';

export {
  getClinicalSignificance,
  searchByCondition,
  searchByMolecularConsequence,
  searchByReviewStatus,
  getVariantSubmissions,
  getVariantFrequency,
  getPathogenicVariantsForGene,
} from './clinical-significance.js';

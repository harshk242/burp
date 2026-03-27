/**
 * Re-exports the combined tool definitions and handler map
 * for the ClinicalTrials.gov platform module.
 */

import type { ToolHandler } from '../../../types.js';
import { tools } from './definitions.js';

import {
  handleSearchStudies,
  handleGetStudyDetails,
  handleSearchByLocation,
  handleSearchByCondition,
  handleGetTrialStatistics,
  handleSearchBySponsor,
  handleSearchByIntervention,
  handleGetRecruitingStudies,
  handleSearchByDateRange,
} from './search-handlers.js';

import {
  handleGetStudiesWithResults,
  handleSearchRareDiseases,
  handleGetPediatricStudies,
  handleGetSimilarStudies,
  handleSearchByPrimaryOutcome,
  handleSearchByEligibilityCriteria,
  handleGetStudyTimeline,
  handleSearchInternationalStudies,
} from './advanced-handlers.js';

export { tools };

export const handlers: Record<string, ToolHandler> = {
  search_studies: handleSearchStudies,
  get_study_details: handleGetStudyDetails,
  search_by_location: handleSearchByLocation,
  search_by_condition: handleSearchByCondition,
  get_trial_statistics: handleGetTrialStatistics,
  search_by_sponsor: handleSearchBySponsor,
  search_by_intervention: handleSearchByIntervention,
  get_recruiting_studies: handleGetRecruitingStudies,
  search_by_date_range: handleSearchByDateRange,
  get_studies_with_results: handleGetStudiesWithResults,
  search_rare_diseases: handleSearchRareDiseases,
  get_pediatric_studies: handleGetPediatricStudies,
  get_similar_studies: handleGetSimilarStudies,
  search_by_primary_outcome: handleSearchByPrimaryOutcome,
  search_by_eligibility_criteria: handleSearchByEligibilityCriteria,
  get_study_timeline: handleGetStudyTimeline,
  search_international_studies: handleSearchInternationalStudies,
};

/**
 * Advanced / specialised handler functions for ClinicalTrials.gov tools.
 *
 * Covers results, rare-disease, pediatric, similarity, outcome,
 * eligibility, timeline, and international study searches.
 */

import type { ToolHandler } from '../../../types.js';
import { fetchStudies, formatStudySummary } from '../client.js';

// ---------------------------------------------------------------------------
// get_studies_with_results
// ---------------------------------------------------------------------------

export const handleGetStudiesWithResults: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
    'filter.overallStatus': 'COMPLETED',
    'filter.hasResults': true,
  };

  if (args.condition) params['query.cond'] = args.condition;
  if (args.intervention) params['query.intr'] = args.intervention;
  if (args.completedAfter)
    params['filter.primaryCompletionDateFrom'] = args.completedAfter;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      status: 'COMPLETED',
      hasResults: true,
      condition: args.condition,
      intervention: args.intervention,
      completedAfter: args.completedAfter,
    },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      completionDate:
        study.protocolSection.statusModule.primaryCompletionDateStruct?.date,
      hasResults: true,
    })),
  };
};

// ---------------------------------------------------------------------------
// search_rare_diseases
// ---------------------------------------------------------------------------

export const handleSearchRareDiseases: ToolHandler = async (args) => {
  if (!args.rareDisease) {
    throw new Error('Rare disease parameter is required');
  }

  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
    'query.cond': args.rareDisease,
    'query.term': `${args.rareDisease} OR orphan OR rare`,
  };

  if (args.recruitmentStatus)
    params['filter.overallStatus'] = args.recruitmentStatus;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      rareDisease: args.rareDisease,
      recruitmentStatus: args.recruitmentStatus,
      searchNote: 'Includes orphan and rare disease designations',
    },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      conditions: study.protocolSection.conditionsModule?.conditions || [],
      eligibility: {
        sex: study.protocolSection.eligibilityModule?.sex || 'Unknown',
        minimumAge:
          study.protocolSection.eligibilityModule?.minimumAge || 'Not specified',
        maximumAge:
          study.protocolSection.eligibilityModule?.maximumAge || 'Not specified',
      },
    })),
  };
};

// ---------------------------------------------------------------------------
// get_pediatric_studies
// ---------------------------------------------------------------------------

export const handleGetPediatricStudies: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
    'filter.stdAge': 'CHILD',
  };

  if (args.condition) params['query.cond'] = args.condition;

  if (args.ageRange) {
    switch (args.ageRange) {
      case 'INFANT':
        params['filter.minimumAge'] = '0 Years';
        params['filter.maximumAge'] = '2 Years';
        break;
      case 'CHILD':
        params['filter.minimumAge'] = '2 Years';
        params['filter.maximumAge'] = '12 Years';
        break;
      case 'ADOLESCENT':
        params['filter.minimumAge'] = '12 Years';
        params['filter.maximumAge'] = '18 Years';
        break;
    }
  }

  if (args.recruitmentStatus)
    params['filter.overallStatus'] = args.recruitmentStatus;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      targetPopulation: 'PEDIATRIC',
      condition: args.condition,
      ageRange: args.ageRange,
      recruitmentStatus: args.recruitmentStatus,
    },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      conditions: study.protocolSection.conditionsModule?.conditions || [],
      eligibility: {
        sex: study.protocolSection.eligibilityModule?.sex || 'Unknown',
        minimumAge:
          study.protocolSection.eligibilityModule?.minimumAge || 'Not specified',
        maximumAge:
          study.protocolSection.eligibilityModule?.maximumAge || 'Not specified',
        healthyVolunteers:
          study.protocolSection.eligibilityModule?.healthyVolunteers || false,
      },
      locations:
        study.protocolSection.contactsLocationsModule?.locations?.slice(0, 2) ||
        [],
    })),
  };
};

// ---------------------------------------------------------------------------
// get_similar_studies
// ---------------------------------------------------------------------------

export const handleGetSimilarStudies: ToolHandler = async (args) => {
  const nctId = args.nctId as string;
  if (!nctId || !/^NCT\d{8}$/.test(nctId)) {
    throw new Error('Valid NCT ID is required (format: NCT########)');
  }

  // Fetch the reference study
  const refData = await fetchStudies({
    format: 'json',
    'query.term': nctId,
    pageSize: 1,
  });

  if (!refData.studies || refData.studies.length === 0) {
    throw new Error(`Reference study not found: ${nctId}`);
  }

  const referenceStudy = refData.studies[0];
  const similarityType = (args.similarityType as string) || 'CONDITION';

  const searchParams: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  switch (similarityType) {
    case 'CONDITION': {
      const condition =
        referenceStudy.protocolSection.conditionsModule?.conditions?.[0];
      if (condition) searchParams['query.cond'] = condition;
      break;
    }
    case 'INTERVENTION':
      // Intervention-based similarity uses general search
      searchParams['query.term'] =
        referenceStudy.protocolSection.identificationModule.briefTitle;
      break;
    case 'SPONSOR': {
      const sponsor =
        referenceStudy.protocolSection.sponsorCollaboratorsModule?.leadSponsor
          ?.name;
      if (sponsor) searchParams['query.spons'] = sponsor;
      break;
    }
    case 'PHASE': {
      const phase =
        referenceStudy.protocolSection.designModule?.phases?.[0];
      if (phase) searchParams['filter.phase'] = phase;
      break;
    }
  }

  const data = await fetchStudies(searchParams);
  const studies = data.studies || [];

  const results = studies
    .filter(
      (s) => s.protocolSection.identificationModule.nctId !== nctId,
    )
    .map(formatStudySummary);

  return {
    referenceStudy: {
      nctId,
      title: referenceStudy.protocolSection.identificationModule.briefTitle,
    },
    similarityType,
    totalCount: data.totalCount || 0,
    resultsShown: results.length,
    similarStudies: results,
  };
};

// ---------------------------------------------------------------------------
// search_by_primary_outcome
// ---------------------------------------------------------------------------

export const handleSearchByPrimaryOutcome: ToolHandler = async (args) => {
  if (!args.outcome) {
    throw new Error('Outcome parameter is required');
  }

  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
    'query.outc': args.outcome,
  };

  if (args.condition) params['query.cond'] = args.condition;
  if (args.phase) params['filter.phase'] = args.phase;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      primaryOutcome: args.outcome,
      condition: args.condition,
      phase: args.phase,
    },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map(formatStudySummary),
  };
};

// ---------------------------------------------------------------------------
// search_by_eligibility_criteria
// ---------------------------------------------------------------------------

export const handleSearchByEligibilityCriteria: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  if (args.minAge) params['filter.minimumAge'] = args.minAge;
  if (args.maxAge) params['filter.maximumAge'] = args.maxAge;
  if (args.sex) params['filter.sex'] = args.sex;
  if (args.healthyVolunteers !== undefined)
    params['filter.healthyVolunteers'] = args.healthyVolunteers;
  if (args.condition) params['query.cond'] = args.condition;
  if (args.inclusionKeywords)
    params['query.eligibility'] = args.inclusionKeywords;

  const data = await fetchStudies(params);
  let studies = data.studies || [];

  // Client-side exclusion keyword filtering
  if (args.exclusionKeywords) {
    const exclusionWords = (args.exclusionKeywords as string)
      .toLowerCase()
      .split(/\s+/);
    studies = studies.filter((study) => {
      const criteria =
        study.protocolSection.eligibilityModule?.eligibilityCriteria?.toLowerCase() ||
        '';
      return !exclusionWords.some((word) => criteria.includes(word));
    });
  }

  return {
    searchCriteria: {
      minAge: args.minAge,
      maxAge: args.maxAge,
      sex: args.sex,
      healthyVolunteers: args.healthyVolunteers,
      condition: args.condition,
      inclusionKeywords: args.inclusionKeywords,
      exclusionKeywords: args.exclusionKeywords,
    },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      eligibility: {
        sex: study.protocolSection.eligibilityModule?.sex || 'Unknown',
        minimumAge:
          study.protocolSection.eligibilityModule?.minimumAge || 'Not specified',
        maximumAge:
          study.protocolSection.eligibilityModule?.maximumAge || 'Not specified',
        healthyVolunteers:
          study.protocolSection.eligibilityModule?.healthyVolunteers || false,
        criteriaPreview:
          (study.protocolSection.eligibilityModule?.eligibilityCriteria?.substring(
            0,
            200,
          ) ?? 'Not available') + '...',
      },
    })),
  };
};

// ---------------------------------------------------------------------------
// get_study_timeline
// ---------------------------------------------------------------------------

export const handleGetStudyTimeline: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  if (args.condition) params['query.cond'] = args.condition;
  if (args.sponsor) params['query.spons'] = args.sponsor;
  if (args.phase) params['filter.phase'] = args.phase;

  const timelineType = (args.timelineType as string) || 'CURRENT';

  switch (timelineType) {
    case 'CURRENT':
      params['filter.overallStatus'] =
        'RECRUITING,NOT_YET_RECRUITING,ACTIVE_NOT_RECRUITING';
      break;
    case 'COMPLETED':
      params['filter.overallStatus'] = 'COMPLETED';
      break;
    case 'UPCOMING': {
      params['filter.overallStatus'] = 'NOT_YET_RECRUITING';
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      params['filter.studyStartDateFrom'] = futureDate
        .toISOString()
        .split('T')[0];
      break;
    }
  }

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      condition: args.condition,
      sponsor: args.sponsor,
      phase: args.phase,
      timelineType,
    },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      timeline: {
        startDate: study.protocolSection.statusModule.startDateStruct?.date,
        primaryCompletionDate:
          study.protocolSection.statusModule.primaryCompletionDateStruct?.date,
        status: study.protocolSection.statusModule.overallStatus,
        daysFromStart: study.protocolSection.statusModule.startDateStruct?.date
          ? Math.floor(
              (Date.now() -
                new Date(
                  study.protocolSection.statusModule.startDateStruct.date,
                ).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : null,
      },
    })),
  };
};

// ---------------------------------------------------------------------------
// search_international_studies
// ---------------------------------------------------------------------------

export const handleSearchInternationalStudies: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  if (args.condition) params['query.cond'] = args.condition;
  if (args.phase) params['filter.phase'] = args.phase;
  if (args.includeCountry) params['query.locn'] = args.includeCountry;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  // Filter for truly international (multi-country) studies
  const filtered = studies.filter((study) => {
    const locations =
      study.protocolSection.contactsLocationsModule?.locations || [];
    const countries = new Set(locations.map((loc) => loc.country));

    if (args.minCountries && countries.size < (args.minCountries as number)) {
      return false;
    }
    if (args.excludeCountry && countries.has(args.excludeCountry as string)) {
      return false;
    }
    return countries.size >= 2;
  });

  return {
    searchCriteria: {
      condition: args.condition,
      excludeCountry: args.excludeCountry,
      includeCountry: args.includeCountry,
      minCountries: args.minCountries,
      phase: args.phase,
      note: 'Only showing studies with 2+ countries',
    },
    totalCount: data.totalCount || 0,
    resultsShown: filtered.length,
    internationalStudies: filtered.map((study) => {
      const locations =
        study.protocolSection.contactsLocationsModule?.locations || [];
      const countries = [...new Set(locations.map((loc) => loc.country))];

      return {
        ...formatStudySummary(study),
        internationalDetails: {
          totalCountries: countries.length,
          countries,
          totalLocations: locations.length,
          sampleLocations: locations.slice(0, 3),
        },
      };
    }),
  };
};

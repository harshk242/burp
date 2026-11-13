import type { ToolHandler } from '../../../types.js';
import {
  fetchStudies,
  formatStudySummary,
  resultMeta,
  filteredResultMeta,
} from '../client.js';
import { ageOverlap, applyAdvancedFilter, area, areaText, range, sexEligible } from '../advanced-filter.js';

export const handleGetStudiesWithResults: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
    'filter.overallStatus': 'COMPLETED',
  };

  if (args.condition) params['query.cond'] = args.condition;
  if (args.intervention) params['query.intr'] = args.intervention;
  applyAdvancedFilter(params, [
    'AREA[HasResults]true',
    range('PrimaryCompletionDate', args.completedAfter),
  ]);

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
    ...resultMeta(data, studies.length),
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      completionDate:
        study.protocolSection.statusModule.primaryCompletionDateStruct?.date,
      hasResults: true,
    })),
  };
};

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
    ...resultMeta(data, studies.length),
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

const PEDIATRIC_AGE_RANGES: Record<string, [string, string]> = {
  INFANT: ['0 years', '2 years'],
  CHILD: ['2 years', '12 years'],
  ADOLESCENT: ['12 years', '18 years'],
};

export const handleGetPediatricStudies: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  if (args.condition) params['query.cond'] = args.condition;
  if (args.recruitmentStatus)
    params['filter.overallStatus'] = args.recruitmentStatus;

  const ageWindow = PEDIATRIC_AGE_RANGES[args.ageRange as string];
  applyAdvancedFilter(params, [
    'AREA[StdAge]CHILD',
    ageWindow ? ageOverlap(ageWindow[0], ageWindow[1]) : [],
  ]);

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      targetPopulation: 'PEDIATRIC',
      condition: args.condition,
      ageRange: args.ageRange,
      recruitmentStatus: args.recruitmentStatus,
    },
    ...resultMeta(data, studies.length),
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

export const handleGetSimilarStudies: ToolHandler = async (args) => {
  const nctId = args.nctId as string;
  if (!nctId || !/^NCT\d{8}$/.test(nctId)) {
    throw new Error('Valid NCT ID is required (format: NCT########)');
  }

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
    case 'INTERVENTION': {
      const names = referenceStudy.protocolSection.armsInterventionsModule?.interventions
        ?.map((intervention) => intervention.name?.trim())
        .filter((name): name is string => !!name);
      if (!names?.length) {
        throw new Error(`Reference study has no intervention names: ${nctId}`);
      }
      searchParams['query.intr'] = [...new Set(names)]
        .map((name) => `"${name.replaceAll('"', ' ')}"`)
        .join(' OR ');
      break;
    }
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
      applyAdvancedFilter(searchParams, [area('Phase', phase)]);
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
    ...filteredResultMeta(data, results.length, 'excluding the reference study'),
    similarStudies: results,
  };
};

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
  applyAdvancedFilter(params, [area('Phase', args.phase)]);

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      primaryOutcome: args.outcome,
      condition: args.condition,
      phase: args.phase,
    },
    ...resultMeta(data, studies.length),
    studies: studies.map(formatStudySummary),
  };
};

export const handleSearchByEligibilityCriteria: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  if (args.condition) params['query.cond'] = args.condition;
  applyAdvancedFilter(params, [
    ageOverlap(args.minAge, args.maxAge),
    sexEligible(args.sex),
    area('HealthyVolunteers', args.healthyVolunteers),
    areaText('EligibilityCriteria', args.inclusionKeywords),
  ]);

  const data = await fetchStudies(params);
  let studies = data.studies || [];

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
    ...(args.exclusionKeywords
      ? filteredResultMeta(data, studies.length, 'local exclusion-keyword filtering')
      : resultMeta(data, studies.length)),
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

export const handleGetStudyTimeline: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  if (args.condition) params['query.cond'] = args.condition;
  if (args.sponsor) params['query.spons'] = args.sponsor;

  const timelineType = (args.timelineType as string) || 'CURRENT';
  let startFrom: string | undefined;

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
      startFrom = futureDate.toISOString().split('T')[0];
      break;
    }
  }
  applyAdvancedFilter(params, [area('Phase', args.phase), range('StartDate', startFrom)]);

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      condition: args.condition,
      sponsor: args.sponsor,
      phase: args.phase,
      timelineType,
    },
    ...resultMeta(data, studies.length),
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

export const handleSearchInternationalStudies: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  if (args.condition) params['query.cond'] = args.condition;
  if (args.includeCountry) params['query.locn'] = args.includeCountry;
  applyAdvancedFilter(params, [area('Phase', args.phase)]);

  const data = await fetchStudies(params);
  const studies = data.studies || [];

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
    ...filteredResultMeta(data, filtered.length, 'local multi-country filtering'),
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

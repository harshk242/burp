/**
 * Open Targets Platform GraphQL API contract tests.
 * Validates structural stability of ~4 key query shapes.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import axios from 'axios';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';

const GRAPHQL_URL = 'https://api.platform.opentargets.org/api/v4/graphql';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function query(gql: string, variables: Record<string, unknown>): Promise<unknown> {
  const res = await axios.post(
    GRAPHQL_URL,
    { query: gql, variables },
    { headers: { 'Content-Type': 'application/json' }, timeout: 20_000 },
  );
  // Open Targets returns errors in res.data.errors even with HTTP 200
  if (res.data.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(res.data.errors)}`);
  }
  return res.data.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Open Targets GraphQL API Contracts', () => {
  // 1. Target info — most used query shape
  it('target(ensemblId) schema is stable (BRAF)', async () => {
    const data = await query(
      `query TargetInfo($ensemblId: String!) {
        target(ensemblId: $ensemblId) {
          id
          approvedSymbol
          approvedName
          biotype
          functionDescriptions
          subcellularLocations { termSL location }
          targetClass { id label }
        }
      }`,
      { ensemblId: 'ENSG00000157764' }, // BRAF
    );
    await assertSchemaStable('open-targets/target-info.schema.json', data);
  });

  // 2. Disease info — used by get_disease_info handler
  it('disease(efoId) schema is stable (cancer)', async () => {
    const data = await query(
      `query DiseaseInfo($efoId: String!) {
        disease(efoId: $efoId) {
          id
          name
          description
          synonyms { relation terms }
          therapeuticAreas { id name }
        }
      }`,
      { efoId: 'EFO_0000311' }, // cancer
    );
    await assertSchemaStable('open-targets/disease-info.schema.json', data);
  });

  // 3. Drug info — used by get_drug_info handler
  // Note: arg is 'chemblId', field is 'maximumClinicalStage' (not maximumClinicalTrialPhase)
  it('drug(chemblId) schema is stable (Aspirin)', async () => {
    const data = await query(
      `query DrugInfo($chemblId: String!) {
        drug(chemblId: $chemblId) {
          id
          name
          drugType
          maximumClinicalStage
          description
          tradeNames
        }
      }`,
      { chemblId: 'CHEMBL25' }, // Aspirin
    );
    await assertSchemaStable('open-targets/drug-info.schema.json', data);
  });

  // 4. Target–disease associations — used by get_target_associated_diseases
  it('target associatedDiseases schema is stable (BRAF)', async () => {
    const data = await query(
      `query TargetDiseases($ensemblId: String!) {
        target(ensemblId: $ensemblId) {
          id
          associatedDiseases(page: { index: 0, size: 3 }) {
            count
            rows {
              disease { id name }
              score
            }
          }
        }
      }`,
      { ensemblId: 'ENSG00000157764' }, // BRAF
    );
    await assertSchemaStable('open-targets/target-associated-diseases.schema.json', data);
  });

  // 5. Search — used by search_entities handler
  it('search schema is stable (BRCA2 query)', async () => {
    const data = await query(
      `query Search($queryString: String!) {
        search(queryString: $queryString, page: { index: 0, size: 3 }) {
          total
          hits {
            id
            entity
            name
            description
            score
          }
        }
      }`,
      { queryString: 'BRCA2' },
    );
    await assertSchemaStable('open-targets/search.schema.json', data);
  });
});

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
import {
  DRUG_CROSS_REFERENCES_OPERATION,
  DRUG_INFO_OPERATION,
} from '../tools/drug/operations.js';
import {
  DISEASE_INFO_OPERATION,
  DEFAULT_SEARCH_ENTITY_NAMES,
  SEARCH_ENTITIES_OPERATION,
} from '../tools/operations.js';
import {
  TARGET_ASSOCIATED_DISEASES_OPERATION,
  TARGET_INFO_OPERATION,
} from '../tools/target/operations.js';

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
  // 1. Target info — shared with get_target_info handler
  it('target(ensemblId) schema is stable (BRAF)', async () => {
    const data = await query(TARGET_INFO_OPERATION, { ensemblId: 'ENSG00000157764' }); // BRAF
    await assertSchemaStable('open-targets/target-info.schema.json', data);
  });

  // 2. Disease info — shared with get_disease_info handler
  it('disease(efoId) schema is stable (cancer)', async () => {
    const data = await query(DISEASE_INFO_OPERATION, { efoId: 'EFO_0000311' }); // cancer
    await assertSchemaStable('open-targets/disease-info.schema.json', data);
  });

  // 3. Drug info — shared with get_drug_info handler
  it('drug(chemblId) schema is stable (Aspirin)', async () => {
    const data = await query(DRUG_INFO_OPERATION, { chemblId: 'CHEMBL25' }); // Aspirin
    await assertSchemaStable('open-targets/drug-info.schema.json', data);
  });

  // 4. Drug cross references — shared with get_drug_cross_references handler
  it('drug crossReferences schema is stable (Aspirin)', async () => {
    const data = await query(DRUG_CROSS_REFERENCES_OPERATION, { chemblId: 'CHEMBL25' }); // Aspirin
    await assertSchemaStable('open-targets/drug-cross-references.schema.json', data);
  });

  // 5. Target–disease associations — shared with get_target_associated_diseases handler
  it('target associatedDiseases schema is stable (BRAF)', async () => {
    const data = await query(TARGET_ASSOCIATED_DISEASES_OPERATION, {
      ensemblId: 'ENSG00000157764', // BRAF
      pageIndex: 0,
      pageSize: 10,
    });
    await assertSchemaStable('open-targets/target-associated-diseases.schema.json', data);
  });

  // 6. Search — shared with search_entities handler
  it('search schema is stable (BRCA2 query)', async () => {
    const data = await query(SEARCH_ENTITIES_OPERATION, {
      queryString: 'BRCA2',
      entityNames: DEFAULT_SEARCH_ENTITY_NAMES,
      pageIndex: 0,
      pageSize: 10,
    });
    await assertSchemaStable('open-targets/search.schema.json', data);
  });
});

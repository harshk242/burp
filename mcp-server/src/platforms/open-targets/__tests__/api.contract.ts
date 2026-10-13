/**
 * Open Targets Platform GraphQL API contract tests.
 * Validates structural stability of ~4 key query shapes.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { beforeAll, describe, it } from 'vitest';
import type { GraphQLSchema } from 'graphql';
import {
  collectNullablePaths,
  fetchGraphQLSchema,
} from '../../__test-utils__/graphql-nullability.js';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { OPEN_TARGETS_POLICY, createOpenTargetsHttp } from '../client.js';
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

const OPEN_TARGETS_CONTRACT_TIMEOUT_MS = 150_000;

/** Contract tests ride out longer bad patches than production (same overrides as Ensembl). */
const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createOpenTargetsHttp({ policy: { ...OPEN_TARGETS_POLICY, ...CONTRACT_OVERRIDES } });

// ── Helpers ───────────────────────────────────────────────────────────────────

// Only the HTTP request is retried; GraphQL errors and schema assertions run once.
async function query(gql: string, variables: Record<string, unknown>): Promise<unknown> {
  const res = await http.post('', { query: gql, variables });
  // Open Targets returns errors in res.data.errors even with HTTP 200
  if (res.data.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(res.data.errors)}`);
  }
  return res.data.data;
}

let schema: GraphQLSchema | undefined;

/**
 * Nullable response paths for an operation, per the live GraphQL schema.
 * Without a schema the comparison stays strict (no null tolerance).
 */
function nullable(operation: string): { nullablePaths?: Set<string> } {
  return schema ? { nullablePaths: collectNullablePaths(schema, operation) } : {};
}

function openTargetsContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: OPEN_TARGETS_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Open Targets GraphQL API Contracts', () => {
  beforeAll(async () => {
    try {
      schema = await fetchGraphQLSchema(http);
    } catch (error) {
      console.warn(`[CONTRACT] Introspection unavailable, null drift will fail strictly: ${error}`);
    }
  }, OPEN_TARGETS_CONTRACT_TIMEOUT_MS);

  // 1. Target info — shared with get_target_info handler
  openTargetsContractTest('target(ensemblId) schema is stable (BRAF)', async () => {
    const data = await query(TARGET_INFO_OPERATION, { ensemblId: 'ENSG00000157764' }); // BRAF
    await assertSchemaStable(
      'open-targets/target-info.schema.json',
      data,
      nullable(TARGET_INFO_OPERATION),
    );
  });

  // 2. Disease info — shared with get_disease_info handler
  openTargetsContractTest('disease(efoId) schema is stable (cancer)', async () => {
    const data = await query(DISEASE_INFO_OPERATION, { efoId: 'EFO_0000311' }); // cancer
    await assertSchemaStable(
      'open-targets/disease-info.schema.json',
      data,
      nullable(DISEASE_INFO_OPERATION),
    );
  });

  // 3. Drug info — shared with get_drug_info handler
  openTargetsContractTest('drug(chemblId) schema is stable (Aspirin)', async () => {
    const data = await query(DRUG_INFO_OPERATION, { chemblId: 'CHEMBL25' }); // Aspirin
    await assertSchemaStable(
      'open-targets/drug-info.schema.json',
      data,
      nullable(DRUG_INFO_OPERATION),
    );
  });

  // 4. Drug cross references — shared with get_drug_cross_references handler
  openTargetsContractTest('drug crossReferences schema is stable (Aspirin)', async () => {
    const data = await query(DRUG_CROSS_REFERENCES_OPERATION, { chemblId: 'CHEMBL25' }); // Aspirin
    await assertSchemaStable(
      'open-targets/drug-cross-references.schema.json',
      data,
      nullable(DRUG_CROSS_REFERENCES_OPERATION),
    );
  });

  // 5. Target–disease associations — shared with get_target_associated_diseases handler
  openTargetsContractTest('target associatedDiseases schema is stable (BRAF)', async () => {
    const data = await query(TARGET_ASSOCIATED_DISEASES_OPERATION, {
      ensemblId: 'ENSG00000157764', // BRAF
      pageIndex: 0,
      pageSize: 10,
    });
    await assertSchemaStable(
      'open-targets/target-associated-diseases.schema.json',
      data,
      nullable(TARGET_ASSOCIATED_DISEASES_OPERATION),
    );
  });

  // 6. Search — shared with search_entities handler
  openTargetsContractTest('search schema is stable (BRCA2 query)', async () => {
    const data = await query(SEARCH_ENTITIES_OPERATION, {
      queryString: 'BRCA2',
      entityNames: DEFAULT_SEARCH_ENTITY_NAMES,
      pageIndex: 0,
      pageSize: 10,
    });
    await assertSchemaStable(
      'open-targets/search.schema.json',
      data,
      nullable(SEARCH_ENTITIES_OPERATION),
    );
  });
});

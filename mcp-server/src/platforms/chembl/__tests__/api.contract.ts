/**
 * ChEMBL REST API contract tests.
 * Validates structural stability of ~4 key endpoints.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import axios from 'axios';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';

const BASE = 'https://www.ebi.ac.uk/chembl/api/data';
const JSON_HEADERS = { Accept: 'application/json' };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url: string, params?: Record<string, string | number>): Promise<unknown> {
  const res = await axios.get(url, { params, headers: JSON_HEADERS, timeout: 20_000 });
  return res.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChEMBL REST API Contracts', () => {
  // 1. Molecule lookup — most critical, used by get_compound_info handler
  it('GET /molecule/{id} schema is stable (Aspirin, CHEMBL25)', async () => {
    const data = await fetchJson(`${BASE}/molecule/CHEMBL25.json`);
    await assertSchemaStable('chembl/molecule.schema.json', data);
  });

  // 2. Target lookup — used by get_target_info handler
  it('GET /target/{id} schema is stable (EGFR, CHEMBL203)', async () => {
    const data = await fetchJson(`${BASE}/target/CHEMBL203.json`);
    await assertSchemaStable('chembl/target.schema.json', data);
  });

  // 3. Activity search — used by search_activities handler
  it('GET /activity schema is stable (filter by molecule)', async () => {
    const data = await fetchJson(`${BASE}/activity.json`, {
      molecule_chembl_id: 'CHEMBL25',
      limit: 3,
    });
    await assertSchemaStable('chembl/activity-list.schema.json', data);
  });

  // 4. Drug mechanism of action — used by get_mechanism_of_action handler
  it('GET /mechanism schema is stable (filter by molecule)', async () => {
    const data = await fetchJson(`${BASE}/mechanism.json`, {
      molecule_chembl_id: 'CHEMBL25',
    });
    await assertSchemaStable('chembl/mechanism-list.schema.json', data);
  });

  // 5. Assay info — used by get_assay_info handler
  it('GET /assay/{id} schema is stable (CHEMBL655942)', async () => {
    const data = await fetchJson(`${BASE}/assay/CHEMBL655942.json`);
    await assertSchemaStable('chembl/assay.schema.json', data);
  });
});

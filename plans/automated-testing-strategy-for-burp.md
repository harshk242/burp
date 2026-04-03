# Automated Testing Strategy for BURP

## Context

BURP (Bio Unified Research Platform) integrates 10 biomedical databases (Ensembl, Open Targets, ChEMBL, PubChem, ClinicalTrials, Reactome, PubMed, ClinVar, ClinPGx, UniProt) via a unified MCP server with 210+ tools. **Zero automated tests exist today** -- no test files, no test framework, no CI/CD pipeline. The highest risk is upstream API changes breaking tool calls silently. The goal is to build a phased, automated test suite starting with external API contract testing and expanding to full-stack coverage.

### Decisions

- **Phase 1 scope**: All 10 platforms (Ensembl, Open Targets, ChEMBL, PubChem, ClinVar, Reactome, PubMed, ClinicalTrials, ClinPGx, UniProt) + infra + CI
- **CI/CD**: GitHub Actions from day one (unit tests on PR, contract tests weekly)
- **Test generator** (Phase 2): Auto-generate validation tests from `inputSchema`, happy-path stubs as TODOs
- **Delivery**: Phase 1 only now; Phase 2+ after validating the approach

---

## Testing Surfaces (Ordered by Risk Reduction)

| # | Surface | Priority | Phase | Rationale |
|---|---------|----------|-------|-----------|
| 1 | External API Schema Stability (Contract Tests) | **CRITICAL** | **1** | Upstream APIs are outside our control; 210+ tools depend on them |
| 2 | MCP Shared Utilities | HIGH | **1** | Pure functions (rate limiter, exceptions, XML parsers) -- easy wins |
| 3 | MCP Tool Handler Unit Tests | **CRITICAL** | 2 | Core logic: validation, transformation, error handling per handler |
| 4 | Backend Route Tests | HIGH | 3 | Hono test client available; Zod schemas already defined |
| 5 | Tool Registry + MCP Manager | MEDIUM | 3 | In-memory class, testable in isolation |
| 6 | Orchestration Logic | MEDIUM | 3 | Artifact store, noise reduction, policy resolution |
| 7 | Database Layer | MEDIUM | 3 | SQLite in-memory; test CRUD + rate limiting |
| 8 | Frontend (Stores + Components) | LOW | 4 | Defer; backend is where risk concentrates |
| 9 | E2E (Playwright) | LOW | 5 | Defer until unit/integration coverage exists |

---

## Tooling Decisions

| Workspace | Runner | Why |
|-----------|--------|-----|
| `mcp-server/` (Node.js) | **vitest** | ESM + TypeScript native; `"type": "module"` in package.json; built-in mocking + snapshots |
| `app/` (Bun) | **bun:test** | Matches runtime; convention from CLAUDE.md |
| `app/web/` (Next.js) | vitest + @testing-library/react | Standard for React component testing (Phase 4) |
| Contract tests | vitest (in mcp-server) | Real HTTP calls, schema comparison, fixture management |
| E2E | Playwright | Full browser-level testing (Phase 5) |

---

## Phase 1: Foundation + Contract Tests (THIS DELIVERY)

### 1A. Test Infrastructure Setup

**Files to create/modify:**

- `mcp-server/package.json` -- add `vitest` devDependency, add `"test"` and `"test:contracts"` scripts
- `mcp-server/vitest.config.ts` -- configure vitest for the MCP server workspace
- `app/package.json` -- add `"test": "bun test"` script
- Root `package.json` -- add `"test": "bun run --filter bio-mcp-unified test && cd app && bun test"` script
- `.github/workflows/test.yml` -- CI pipeline

**Directory structure:**

```
mcp-server/
  vitest.config.ts
  src/
    __tests__/                         # Server-level integration tests
      server.test.ts
    shared/
      __tests__/
        rate-limiter.test.ts
        exceptions.test.ts
    platforms/
      __test-utils__/                  # Shared test helpers
        schema-validator.ts            # Schema extraction + drift detection
        fixtures/                      # Golden response schemas per platform
          ensembl/*.schema.json
          chembl/*.schema.json
          open-targets/*.schema.json
          pubchem/*.schema.json
          clinvar/*.schema.json
        mock-axios.ts                  # Axios mock factory
      ensembl/__tests__/tools/*.contract.ts
      chembl/__tests__/tools/*.contract.ts
      open-targets/__tests__/tools/*.contract.ts
      pubchem/__tests__/tools/*.contract.ts
      clinvar/__tests__/tools/*.contract.ts

app/
  server/
    __tests__/                          # Placeholder structure for Phase 3
    __test-utils__/
```

### 1B. External API Contract Tests (All 10 Platforms)

**Platforms in scope:** All 10 platforms — Ensembl, Open Targets, ChEMBL, PubChem, ClinVar, Reactome, PubMed, ClinicalTrials, ClinPGx, UniProt (~50 contract tests)

**The core idea:** snapshot the *schema* (structural shape) of each external API response, not the values. Values change (counts, timestamps); structure changes indicate breaking API changes.

**How it works:**

1. **Schema extraction function** (`schema-validator.ts`) -- Recursively walks a JSON response and produces a structural schema:
   ```typescript
   interface SchemaNode {
     type: "string" | "number" | "boolean" | "null" | "object" | "array";
     path: string;
     properties?: Record<string, SchemaNode>;  // for objects
     items?: SchemaNode | null;                 // for arrays (schema of first element)
     optional?: boolean;                        // true if sometimes absent
   }
   ```
   - Objects: records keys and their types recursively
   - Arrays: records the schema of `items[0]` only (not length)
   - Primitives: records the type (`string`, `number`, `boolean`, `null`)
   - Naturally handles volatile values -- a timestamp is always `type: "string"`, regardless of its value

2. **Golden fixtures** -- One-time capture of schemas from canonical API calls, stored as `.schema.json` files committed to git. Canonical inputs use stable, well-known biological entities:
   - Ensembl: `ENSG00000139618` (BRCA2), `ENSG00000141510` (TP53)
   - ChEMBL: `CHEMBL25` (Aspirin), `CHEMBL59` (Dopamine)
   - Open Targets: `ENSG00000157764` (BRAF)
   - PubChem: CID `2244` (Aspirin)
   - ClinVar: `rs1042522` (TP53 variant)
   - Reactome: `R-HSA-68886` (Glycolysis), `R-HSA-199420` (PTEN entity)
   - PubMed: PMID `28485846`, term `CRISPR`
   - ClinicalTrials: NCT `NCT00000419`, condition `breast cancer`, term `aspirin`
   - ClinPGx: gene `CYP2D6`, drug `warfarin`, variant `rs1065852`
   - UniProt: `P04637` (TP53), `P69905` (HBA1), gene `BRCA1`

3. **Drift detection** -- Each test run calls the real API, extracts the schema, compares against the stored baseline:
   - **Removed keys** -> `ERROR` (breaking change -- field our handlers depend on may be gone)
   - **Type changed** -> `ERROR` (breaking change -- e.g. was string, now number)
   - **Added keys** -> `WARNING` (non-breaking, logged but test still passes)

4. **Update workflow** -- When a legitimate API change occurs:
   ```bash
   UPDATE_SNAPSHOTS=true npx vitest run contracts
   # Review the changes in git diff, then commit
   ```

5. **Coverage scope** -- Test per unique API *endpoint*, not per tool (many tools share endpoints). All 10 platforms:
   - Ensembl REST: ~8 endpoints (lookup, xrefs, sequence, overlap, homology, regulatory, info, map)
   - Open Targets GraphQL: ~10 query shapes (target, disease, drug, search, associations, evidence)
   - ChEMBL REST: ~8 endpoints (molecule, target, activity, assay, drug, mechanism)
   - PubChem REST: ~6 endpoints (compound, similarity, assay, xrefs, properties, synonyms)
   - ClinVar (NCBI E-utils): ~4 endpoints (esearch, efetch, esummary by gene/rsid/condition)
   - Reactome REST: ~5 endpoints (search, data/query, pathway events, participants, entity pathways)
   - PubMed (NCBI E-utils): ~3 endpoints (esearch, esummary, elink neighbor/citedin)
   - ClinicalTrials REST: ~1 endpoint with 5 query shapes (/studies)
   - ClinPGx/PharmGKB REST: ~6 endpoints (gene, chemical, variant, clinicalAnnotation, guidelineAnnotation, pathway)
   - UniProt REST: ~2 endpoints with 5 query shapes (entry lookup, search)

**Contract test pattern:**

```typescript
// ensembl/__tests__/tools/genes.contract.ts
import { describe, it, expect } from "vitest";
import { extractSchema, compareSchemas, loadFixture, saveFixture } from "../../__test-utils__/schema-validator";
import axios from "axios";

describe("Ensembl API Contracts", () => {
  it("GET /lookup/id/{id} schema is stable", async () => {
    const response = await axios.get(
      "https://rest.ensembl.org/lookup/id/ENSG00000139618",
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );

    const currentSchema = extractSchema(response.data);
    const baseline = loadFixture("ensembl/lookup-gene.schema.json");

    if (process.env.UPDATE_SNAPSHOTS) {
      saveFixture("ensembl/lookup-gene.schema.json", currentSchema);
      return;
    }

    const diff = compareSchemas(baseline, currentSchema);
    expect(diff.removedKeys).toEqual([]);     // No fields disappeared
    expect(diff.typeChanges).toEqual([]);      // No type mutations
    // Added keys are logged as warnings, not failures
    if (diff.addedKeys.length > 0) {
      console.warn(`[DRIFT WARNING] New keys: ${diff.addedKeys.join(", ")}`);
    }
  }, 30000);
});
```

**Bootstrap script:** `bun run scripts/capture-api-snapshots.ts` -- calls each canonical endpoint for the 5 platforms, extracts schema, writes `.schema.json` fixture files. Run once to initialize, commit the results.

### 1C. Shared Utilities Unit Tests

Pure-function tests requiring zero mocking:

- **Rate limiter** (`mcp-server/src/shared/rate-limiter.ts`): token acquisition, refill, burst behavior
- **Exception hierarchy** (`mcp-server/src/shared/exceptions.ts`): construction, `name`, custom properties (`statusCode`, `retryAfter`, `rawContent`)
- **Platform utils** where they exist: XML parsers (ClinVar, PubMed), GraphQL error handling (Open Targets)

### 1D. CI Pipeline

```yaml
# .github/workflows/test.yml
name: Tests
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'   # Contract tests: weekly Monday 06:00 UTC
  workflow_dispatch:

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - checkout, setup bun, setup node 20
      - bun install
      - cd mcp-server && npx vitest run
      - cd app && bun test

  contract-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    steps:
      - checkout, setup node 20
      - cd mcp-server && npm ci
      - npx vitest run --reporter=verbose contracts
      - Upload drift report artifact on failure
    env:
      NCBI_API_KEY: ${{ secrets.NCBI_API_KEY }}
```

**Execution schedule:**

| Trigger | What Runs |
|---------|-----------|
| Every PR | Unit tests (shared utils, handler tests) + typecheck |
| Push to main | Full unit + integration tests |
| Weekly (Monday) | Contract tests (real API calls) |
| Manual | Contract tests + E2E |

---

## Phase 2: MCP Tool Handler Unit Tests (Future)

> Contract tests for all 10 platforms are fully covered in Phase 1. Phase 2 focuses exclusively on handler unit tests (validation, transformation, error handling logic per tool).

### Auto-Generated Test Scaffolding -- How It Works

With 210+ tools following the same `PlatformModule` pattern, hand-writing tests for each is impractical. The generator exploits the fact that every tool has a structured `inputSchema` (JSON Schema) that explicitly declares `required` fields, `type` constraints, `enum` values, and `minimum`/`maximum` bounds.

**Command:**
```bash
bun run scripts/generate-tool-tests.ts [--platform ensembl] [--overwrite]
```

**What the generator does step by step:**

1. **Imports each platform module** and iterates over `platform.tools[]`
2. **Reads `inputSchema`** for each tool to understand its parameter contract
3. **Generates a `.test.ts` file** per tool source file (e.g., `genes.ts` -> `genes.test.ts`)

**What gets generated per tool:**

#### A. Validation tests (FULLY AUTOMATED -- no manual work)

The generator reads `inputSchema.required` and `inputSchema.properties` and produces test cases:

```typescript
// Auto-generated from inputSchema of "lookup_gene"
// inputSchema.required = ["gene_id"]
// inputSchema.properties.gene_id = { type: "string" }
// inputSchema.properties.species = { type: "string" }
// inputSchema.properties.expand = { type: "boolean" }
// inputSchema.properties.format = { type: "string", enum: ["json", "fasta", "gff"] }

describe("ensembl.lookup_gene validation", () => {
  // Test 1: Generated because "gene_id" is in `required`
  it("throws when required param 'gene_id' is missing", async () => {
    await expect(handlers.lookup_gene({})).rejects.toThrow();
  });

  // Test 2: Generated because gene_id.type = "string"
  it("throws when 'gene_id' is wrong type (number instead of string)", async () => {
    await expect(handlers.lookup_gene({ gene_id: 12345 })).rejects.toThrow();
  });

  // Test 3: Generated because format has enum constraint
  it("throws when 'format' is not in allowed enum values", async () => {
    await expect(handlers.lookup_gene({
      gene_id: "ENSG00000139618",
      format: "invalid_format"
    })).rejects.toThrow();
  });

  // Test 4: Generated for numeric params with min/max
  // (e.g., size: { type: "number", minimum: 1, maximum: 500 })
  it("throws when 'size' exceeds maximum of 500", async () => {
    await expect(handlers.some_tool({ query: "test", size: 999 })).rejects.toThrow();
  });
});
```

These tests are **runnable immediately** -- they verify that handlers properly reject invalid input.

#### B. Happy path test stubs (requires manual fill-in)

```typescript
describe("ensembl.lookup_gene behavior", () => {
  it("calls correct API endpoint and returns gene data", async () => {
    // Mock setup (auto-generated)
    const mockGet = vi.fn().mockResolvedValue({
      data: {} // TODO: fill in expected API response shape
    });
    vi.mocked(getClient).mockReturnValue({ get: mockGet } as any);

    const result = await handlers.lookup_gene({ gene_id: "ENSG00000139618" });

    // Auto-generated: verify the HTTP call was made
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining("ENSG00000139618"),
      expect.any(Object)
    );

    // TODO: add assertions about the return value shape
    expect(result).toBeDefined();
  });
});
```

#### C. Error handling stubs (semi-automated)

```typescript
describe("ensembl.lookup_gene error handling", () => {
  it("propagates 404 as meaningful error", async () => {
    const mockGet = vi.fn().mockRejectedValue(
      Object.assign(new Error("Not found"), { response: { status: 404 } })
    );
    vi.mocked(getClient).mockReturnValue({ get: mockGet } as any);

    await expect(handlers.lookup_gene({ gene_id: "INVALID" }))
      .rejects.toThrow();
  });

  // Similar stubs for 429, 500, timeout...
});
```

### Mocking Strategy

- **Simple client pattern** (Ensembl, ChEMBL, PubChem, UniProt, Reactome): Mock `getClient()` to return a mock Axios instance
- **Class-based clients** (Open Targets, ClinVar, ClinPGx, PubMed): Mock class methods; separately test retry/caching logic

### Priority Order for Manual Enrichment

1. **Always-loaded tools** (11 tools from `config.yaml`) -- most frequently called
2. **Tools with complex logic** (XML parsing, GraphQL, batch operations)
3. **Remaining tools** (generated scaffolds with validation-only tests are sufficient)

---

## Phase 3: Backend Tests (Weeks 5-6)

### 3A. Database Layer
- In-memory SQLite (`Database(":memory:")`) with schema.sql applied
- Test CRUD: users, sessions, messages, access requests
- Test rate limiting logic, daily usage increment
- Test FTS5 search queries
- Key file: `app/server/db/index.ts`

### 3B. Tool Registry
- Test register/get/search/count
- Test `toClaudeFormat()` respects always-loaded tools
- Test `toVercelCoreTools()` filtering
- Test `parseToolName()` valid/invalid formats
- Key file: `app/server/mcp/registry.ts`

### 3C. Hono Route Tests
- Use `app.request()` (Hono's built-in test client, no HTTP server needed)
- Test auth middleware (401 without token, 200 with dev bypass)
- Test tool discovery endpoints
- Test Zod schema validation on request bodies
- Key files: `app/server/routes/*.ts`

### 3D. Orchestration Logic
- Artifact store: TTL, LRU eviction, per-session cap
- Noise reduction: jq filter application, error handling
- Key files: `app/server/orchestration/tools/artifact-store.ts`, `noise-reduction.ts`

---

## Phase 4: Frontend Tests (Weeks 7-8)

- Vitest + @testing-library/react + jsdom
- Priority: Zustand stores (chatStore, sessionStore), SSE client (`sse.ts`), ToolCallCard, MessageBubble
- Low priority: thin Radix UI wrappers

---

## Phase 5: E2E Tests (Week 9+)

- Playwright
- 3-5 critical journeys: sign in -> chat -> tool call -> response display
- Mock MCP server in CI to avoid external API calls

---

## Key Technical Decisions

1. **Schema-only snapshots** (not value snapshots) for contract tests -- handles volatile fields naturally
2. **Test generator** for 210+ tools -- avoids hand-writing repetitive test boilerplate
3. **Two test runners** (vitest for Node.js MCP server, bun:test for Bun app) -- matches each workspace's runtime
4. **Contract tests on schedule** (weekly) not per-PR -- avoids rate limiting and flakiness from external APIs
5. **Per-endpoint contract tests** (not per-tool) -- many tools share endpoints; ~60-70 tests cover all unique API shapes

---

## Verification Plan (Phase 1)

How to verify Phase 1 is working correctly:

1. **Unit tests pass**: `cd mcp-server && npx vitest run` -- shared utility tests (rate limiter, exceptions) all green
2. **Contract tests pass**: `cd mcp-server && npx vitest run --config vitest.contracts.config.ts` -- all 10 platforms' API schemas match baselines (~50 tests)
3. **Drift detection works**: Manually edit a `.schema.json` fixture (remove a key) -> contract test should fail with "removed key" error
4. **Snapshot update works**: `UPDATE_SNAPSHOTS=true npx vitest run contracts` -> fixtures regenerated, `git diff` shows changes
5. **CI pipeline runs**: Push a branch, verify GitHub Actions runs unit tests on PR; trigger manual workflow dispatch for contract tests
6. **Server integration test**: `npx vitest run src/__tests__/server.test.ts` -- tool registration and dispatch verified

---

## Critical Files Reference

| File | Role in Testing |
|------|-----------------|
| `mcp-server/src/types.ts` | `PlatformModule` + `ToolHandler` interfaces -- the contract all test generators depend on |
| `mcp-server/src/server.ts` | `buildToolRegistry()` + `createServer()` -- integration test targets |
| `mcp-server/src/shared/exceptions.ts` | Exception hierarchy -- unit test targets (Phase 1C) |
| `mcp-server/src/platforms/*/tools/*.ts` | Tool definitions + handlers -- unit test targets (Phase 2) |
| `mcp-server/src/platforms/*/client.ts` | HTTP clients -- mocking targets |
| `app/server/mcp/registry.ts` | `ToolRegistry` class -- unit test target (Phase 3B) |
| `app/server/mcp/manager.ts` | MCP lifecycle + output guardrails -- integration test target |
| `app/server/db/index.ts` | All DB query functions -- test with in-memory SQLite (Phase 3A) |
| `app/server/db/schema.sql` | SQLite schema -- used to initialize test DBs |
| `app/server/routes/*.ts` | Hono routes -- test with `app.request()` (Phase 3C) |
| `app/server/schemas/index.ts` | Zod schemas -- used to validate route test assertions |
| `app/config.yaml` | Platform config, always-loaded tools, artifact policies -- test configuration source |

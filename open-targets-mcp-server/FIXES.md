# Open Targets MCP Server - Bug Fixes

## Summary of Issues Fixed

This document details the three issues that were identified and fixed in the Open Targets MCP server.

---

## Issue #1: search_entities - HTTP 400 Error

### Problem
The `search_entities` tool was experiencing HTTP 400 errors when searching for certain gene names like "EGFR", even though the same query worked with other genes like "BRAF".

### Root Cause
The function was attempting to re-search using an Ensembl ID (e.g., "ENSG00000146648") when `mapIds` returned a "better" match. However, this re-search could fail if:
1. The API didn't handle Ensembl IDs well in the search endpoint
2. The mapped result had a lower score than expected
3. The re-search returned empty results

### Fix
Modified `src/tools/search.ts:searchEntities()` to:
1. Only re-search if the mapped hit has a **perfect score (1.0)**, indicating it's a true canonical match
2. Wrap the re-search in a try-catch block to gracefully fall back to direct results if the re-search fails
3. Only use the canonical results if they actually returned data

**Code changes:**
```typescript
// Only re-search if:
// 1. We have a mapped hit with a different ID
// 2. The mapped hit has a perfect score (1.0)
// 3. The direct search returned results
if (bestMappedHit &&
    bestMappedHit.id !== directTopHitId &&
    bestMappedHit.score === 1.0 &&
    directResults?.search?.hits?.length) {
  try {
    const canonicalResults = await searchDirect(bestMappedHit.id, entityNames, pageIndex, pageSize);
    if (canonicalResults?.search?.hits?.length) {
      return canonicalResults;
    }
  } catch (error) {
    console.warn(`Failed to search with canonical ID, falling back to direct results:`, error);
  }
}
```

---

## Issue #2: search_suggestions - JavaScript Error

### Problem
The `search_suggestions` tool was throwing a JavaScript error: "Cannot read properties of undefined (reading 'length')"

### Root Cause
The fuzzball library import was incorrect. When using dynamic imports (`await import('fuzzball')`), the module object is returned, but the code wasn't handling the module structure correctly. The fuzzball library exports named exports (`extract`, `ratio`, etc.), not a default export.

### Fix
Modified `src/tools/search.ts` to properly import the fuzzball module:

**Code changes:**
```typescript
// Optional fuzzy matching support
let fuzzball: any = null;
try {
  // fuzzball exports named exports (extract, ratio, etc.), not a default export
  fuzzball = await import('fuzzball');
} catch {
  console.warn("'fuzzball' library not found. Suggestions will not work.");
}
```

The module is now correctly imported and `fuzzball.extract()` and `fuzzball.ratio()` work as expected.

---

## Issue #3: get_disease_associated_targets - HTTP 400 Error

### Problem
The `get_disease_associated_targets` tool was returning HTTP 400 errors when called with disease ID "EFO_0000249".

### Root Cause
This was **not a bug in the code**, but a **user error**:
- "EFO_0000249" is not a valid disease ID in the Open Targets database
- The correct ID for Alzheimer's disease is "MONDO_0004975"
- The API returned `null` for the invalid ID, which resulted in a 400 error

However, the error messaging was poor and the parameter naming was misleading.

### Fix
1. **Improved error handling**: All disease-related functions now check if the disease was found and throw a helpful error message if not:

```typescript
const result = await client.query(query, { efoId });

if (result && typeof result === 'object' && 'disease' in result && result.disease === null) {
  throw new Error(
    `Disease ID '${efoId}' not found. ` +
    `Please use the search_entities tool to find the correct disease ID. ` +
    `Example: search_entities({query_string: "disease name", entity_names: ["disease"]})`
  );
}
```

2. **Updated documentation**: Clarified that the `efo_id` parameter accepts disease IDs from **any ontology** (EFO, MONDO, Orphanet, etc.), not just EFO IDs:

**Updated functions in `src/tools/disease.ts`:**
- `getDiseaseInfo()`
- `getDiseaseAssociatedTargets()`
- `getDiseasePhenotypes()`
- `getDiseaseOtarProjects()`

**Updated tool descriptions in `src/server.ts`:**
```typescript
{
  name: 'get_disease_info',
  description: 'Retrieve core metadata for an Open Targets disease entity. Accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.). Use search_entities to find disease IDs.',
  inputSchema: {
    type: 'object',
    properties: {
      efo_id: {
        type: 'string',
        description: 'Disease identifier from any ontology (e.g., "MONDO_0004975" for Alzheimer\'s, "EFO_0003884" for asthma). Use search_entities with entity_names=["disease"] to find IDs.'
      },
    },
    required: ['efo_id'],
  },
}
```

---

## Testing

All fixes have been verified with the included test script (`test_fixes.js`):

```bash
node test_fixes.js
```

### Test Results:
- ✅ Test 1: `search_entities` with "EGFR" - **PASSED**
- ✅ Test 2: `search_suggestions` with "EGF" prefix - **PASSED**
- ✅ Test 3: `get_disease_associated_targets` with invalid ID - **PASSED** (throws helpful error)
- ✅ Test 4: `get_disease_associated_targets` with valid MONDO ID - **PASSED**

---

## Files Modified

1. `src/tools/search.ts` - Fixed search_entities and search_suggestions
2. `src/tools/disease.ts` - Added error handling and improved documentation
3. `src/server.ts` - Updated tool descriptions for disease tools

---

## Recommendations

### For Users:

1. **Always use `search_entities` first** to find the correct IDs for genes, diseases, drugs, etc.
   ```javascript
   // Find disease ID
   search_entities({
     query_string: "Alzheimer",
     entity_names: ["disease"]
   })
   ```

2. **Disease IDs** can be from various ontologies:
   - MONDO (e.g., "MONDO_0004975" for Alzheimer's disease)
   - EFO (e.g., "EFO_0003884" for asthma)
   - Orphanet (e.g., "Orphanet_558" for Marfan syndrome)
   - HP (e.g., "HP_0001250" for seizures)

3. **Gene IDs** should be Ensembl IDs:
   - Format: "ENSG" followed by 11 digits
   - Example: "ENSG00000146648" for EGFR

### For Developers:

1. The `efo_id` parameter name is kept for backward compatibility, but it accepts any disease ontology ID
2. Consider using the `search_entities` function programmatically before calling disease/target/drug functions to validate IDs
3. The improved error messages guide users to use `search_entities` when IDs are not found

---

## Version

These fixes were applied to version **0.2.0** of the Open Targets MCP server.

## Date

2026-01-23

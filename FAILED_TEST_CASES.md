# Failed Test Cases - Manual Verification Guide

**Generated:** 2026-01-24
**Purpose:** Document all failed API calls for manual debugging and verification
**Reference:** PLATFORM_CONNECTIONS_VERIFICATION_REPORT.md

---

## Table of Contents
1. [Missing Platforms](#missing-platforms)
2. [ClinPGx (PharmGKB) - All Tools Failing](#clinpgx-pharmgkb---all-tools-failing)
3. [Open Targets - Search Issues](#open-targets---search-issues)
4. [Ensembl - Tool Failures](#ensembl---tool-failures)
5. [PubChem - Incomplete Tools](#pubchem---incomplete-tools)
6. [Quick Test Script](#quick-test-script)

---

## Missing Platforms

### 1. ChEMBL - Platform Not Available

**Status:** No MCP tools found
**Impact:** Cannot perform compound-target mapping
**Priority:** HIGH

**Expected Tools:**
- `search_compounds`
- `get_compound_info`
- `get_compound_targets`
- `search_by_uniprot`
- `get_target_compounds`

**Manual Test:**
```bash
# Check if ChEMBL MCP server is configured
cat ~/.config/claude/claude_desktop_config.json | grep -i chembl

# Expected: Should see chembl MCP server configuration
# Actual: No chembl configuration found
```

**Investigation Steps:**
1. Check if ChEMBL MCP server exists in the ecosystem
2. Verify API endpoints: https://www.ebi.ac.uk/chembl/api/data/
3. Check if authentication/API key is required
4. Review MCP server implementation requirements

**Test Data for Future Verification:**
- Compound: Aspirin (ChEMBL ID: CHEMBL25)
- Target: TP53 (UniProt: P04637, ChEMBL: CHEMBL2093875)

---

### 2. UniProt - Platform Not Available

**Status:** No MCP tools found
**Impact:** Cannot query protein sequences, functions, or annotations
**Priority:** HIGH

**Expected Tools:**
- `search_proteins`
- `get_protein_info`
- `get_protein_sequences`
- `get_protein_pathways`
- `get_protein_interactions`

**Manual Test:**
```bash
# Check if UniProt MCP server is configured
cat ~/.config/claude/claude_desktop_config.json | grep -i uniprot

# Expected: Should see uniprot MCP server configuration
# Actual: No uniprot configuration found
```

**Investigation Steps:**
1. Check UniProt REST API: https://rest.uniprot.org/
2. Review UniProt API documentation
3. Check if MCP server implementation exists
4. Test direct API access

**Test Data for Future Verification:**
- Protein: TP53 (UniProt: P04637)
- Gene: TP53
- Expected: Protein sequence, domains, functions

**Direct API Test (curl):**
```bash
# Test UniProt REST API directly
curl "https://rest.uniprot.org/uniprotkb/P04637.json"

# Expected: JSON response with TP53 protein data
```

---

### 3. Reactome - Platform Not Available

**Status:** No MCP tools found
**Impact:** Limited pathway enrichment analysis
**Priority:** MEDIUM (Workaround: Ensembl xrefs provide Reactome IDs)

**Expected Tools:**
- `search_pathways`
- `get_pathway_info`
- `find_pathways_by_gene`
- `get_pathway_participants`
- `get_pathway_reactions`

**Manual Test:**
```bash
# Check if Reactome MCP server is configured
cat ~/.config/claude/claude_desktop_config.json | grep -i reactome

# Expected: Should see reactome MCP server configuration
# Actual: No reactome configuration found
```

**Investigation Steps:**
1. Check Reactome API: https://reactome.org/ContentService/
2. Review available endpoints
3. Test direct API access
4. Verify Ensembl xrefs as workaround

**Test Data for Future Verification:**
- Gene: TP53
- Pathway IDs (from Ensembl): R-HSA-3700989, R-HSA-5633008

**Direct API Test (curl):**
```bash
# Test Reactome API directly
curl "https://reactome.org/ContentService/data/query/TP53/pathways"

# Expected: JSON response with TP53 pathways
```

---

## ClinPGx (PharmGKB) - All Tools Failing

**Status:** Tools exist but ALL return HTTP 400 errors
**Impact:** Complete pharmacogenomics functionality unavailable
**Priority:** CRITICAL

### Test Case 1: search_genes

**Tool:** `mcp__clinpgx__search_genes`

**Parameters Used:**
```json
{
  "query": "CYP2D6",
  "maxResults": 3
}
```

**Expected Behavior:**
Return list of pharmacogenes matching "CYP2D6"

**Actual Error:**
```
Error: HTTP error 400: Request failed with status code 400
```

**Manual Verification:**
```bash
# Test with different queries
# Test 1: CYP2D6
# Test 2: TPMT
# Test 3: CYP2C19

# Check PharmGKB API directly
curl "https://api.pharmgkb.org/v1/data/gene?name=CYP2D6"
```

---

### Test Case 2: get_database_stats

**Tool:** `mcp__clinpgx__get_database_stats`

**Parameters Used:**
```json
{}
```

**Expected Behavior:**
Return statistics about PharmGKB database

**Actual Error:**
```
Error: HTTP error 400: Request failed with status code 400
```

**Manual Verification:**
```bash
# This should work without parameters
# Check if API endpoint changed or requires authentication

curl "https://api.pharmgkb.org/v1/data/stats"
```

---

### Test Case 3: search_drugs

**Tool:** `mcp__clinpgx__search_drugs`

**Parameters Used:**
```json
{
  "query": "Aspirin",
  "maxResults": 3
}
```

**Expected Behavior:**
Return drugs with pharmacogenomic information

**Actual Error:**
```
Error: HTTP error 400: Request failed with status code 400
```

**Manual Verification:**
```bash
curl "https://api.pharmgkb.org/v1/data/drug?name=Aspirin"
```

---

### Investigation Checklist for ClinPGx

- [ ] Check if PharmGKB API requires authentication
- [ ] Verify API endpoint URLs in MCP server configuration
- [ ] Test if API key/token is needed
- [ ] Check PharmGKB API version (v1 vs v2)
- [ ] Review PharmGKB terms of service
- [ ] Check rate limiting
- [ ] Verify request headers (Accept, Content-Type)
- [ ] Test with curl to isolate MCP vs API issue

**Configuration Location:**
```bash
# Check MCP server configuration
cat ~/.config/claude/claude_desktop_config.json | jq '.mcpServers.clinpgx'

# Look for:
# - API endpoint URL
# - Authentication settings
# - API key configuration
```

**All 16 ClinPGx Tools Affected:**
1. search_genes
2. get_gene_info
3. get_gene_pathways
4. search_drugs
5. get_drug_info
6. get_drug_labels
7. search_variants
8. get_variant_info
9. get_variant_annotations
10. get_star_alleles
11. get_clinical_annotations
12. get_drug_gene_interactions
13. get_annotations_by_evidence
14. get_dosing_guidelines
15. get_guidelines_for_pair
16. get_actionable_pairs
17. get_pathways
18. get_database_stats

---

## Open Targets - Search Issues

### Test Case 1: search_entities

**Tool:** `mcp__open-targets__search_entities`

**Parameters Used:**
```json
{
  "query": "TP53",
  "entity_types": ["target"],
  "page_size": 5
}
```

**Expected Behavior:**
Return list of targets matching "TP53"

**Actual Error:**
```
Error: HTTP error 400: Request failed with status code 400
```

**Manual Verification:**
```bash
# Test Open Targets GraphQL API directly
curl -X POST https://api.platform.opentargets.org/api/v4/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ search(queryString: \"TP53\", entityNames: [\"target\"]) { total hits { id name } } }"
  }'
```

**Workaround:**
Use `get_target_info` with known Ensembl ID: `ENSG00000141510`

---

### Test Case 2: get_target_associated_diseases

**Tool:** `mcp__open-targets__get_target_associated_diseases`

**Parameters Used:**
```json
{
  "ensembl_id": "ENSG00000141510",
  "page_size": 5
}
```

**Expected Behavior:**
Return diseases associated with TP53

**Actual Error:**
```
Error: HTTP error 400: Request failed with status code 400
```

**Manual Verification:**
```bash
# Test GraphQL query for disease associations
curl -X POST https://api.platform.opentargets.org/api/v4/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ target(ensemblId: \"ENSG00000141510\") { associatedDiseases { count rows { disease { id name } } } } }"
  }'
```

---

### Investigation Checklist for Open Targets

- [ ] Check if GraphQL query syntax changed
- [ ] Verify API version (v4 vs v5)
- [ ] Test parameter format (camelCase vs snake_case)
- [ ] Check if pagination parameters changed
- [ ] Review Open Targets API documentation
- [ ] Test with minimal parameters
- [ ] Check response format expectations

---

## Ensembl - Tool Failures

### Test Case 1: search_genes

**Tool:** `mcp__ensembl__search_genes`

**Parameters Used:**
```json
{
  "query": "TP53",
  "limit": 5
}
```

**Expected Behavior:**
Return list of genes matching "TP53"

**Actual Error:**
```
Error searching genes: page not found. Please check your uri and refer to our documentation https://rest.ensembl.org/
```

**Manual Verification:**
```bash
# Test Ensembl REST API directly
curl "https://rest.ensembl.org/lookup/symbol/homo_sapiens/TP53?content-type=application/json"

# Alternative search endpoint
curl "https://rest.ensembl.org/search/homo_sapiens/TP53?content-type=application/json"
```

**Workaround:**
Use `lookup_gene` with exact gene symbol:
```json
{
  "gene_id": "TP53"
}
```

**Note:** This works but requires knowing the exact gene symbol.

---

### Test Case 2: lookup_gene with gene symbol

**Tool:** `mcp__ensembl__lookup_gene`

**Parameters Used:**
```json
{
  "gene_id": "TP53",
  "expand": false
}
```

**Expected Behavior:**
Should work with gene symbol

**Actual Error:**
```
Error looking up gene: ID 'TP53' not found
```

**Working Alternative:**
```json
{
  "gene_id": "ENSG00000141510",
  "expand": false
}
```

**Issue:** Tool requires Ensembl ID, not gene symbol (contradicts documentation)

**Manual Verification:**
```bash
# Test both formats
curl "https://rest.ensembl.org/lookup/id/ENSG00000141510?content-type=application/json"
curl "https://rest.ensembl.org/lookup/symbol/homo_sapiens/TP53?content-type=application/json"
```

---

### Test Case 3: get_variants

**Tool:** `mcp__ensembl__get_variants`

**Parameters Used:**
```json
{
  "gene_id": "ENSG00000141510",
  "species": "homo_sapiens"
}
```

**Expected Behavior:**
Return list of variants for TP53 gene

**Actual Error:**
```
MCP error -32602: MCP error -32602: Invalid variant arguments
```

**Manual Verification:**
```bash
# Test Ensembl variant endpoint
curl "https://rest.ensembl.org/overlap/id/ENSG00000141510?feature=variation;content-type=application/json"
```

---

### Test Case 4: get_homologs

**Tool:** `mcp__ensembl__get_homologs`

**Parameters Used:**
```json
{
  "gene_id": "ENSG00000141510",
  "target_species": "mus_musculus"
}
```

**Expected Behavior:**
Return mouse ortholog of TP53

**Actual Result:**
```json
{
  "ortholog_search": {
    "result": "No ortholog found with same gene symbol"
  }
}
```

**Issue:** Known ortholog exists (Trp53) but tool cannot find it

**Manual Verification:**
```bash
# Test homology endpoint
curl "https://rest.ensembl.org/homology/id/ENSG00000141510?target_species=mus_musculus;content-type=application/json"
```

---

## PubChem - Incomplete Tools

### Test Case 1: get_external_references

**Tool:** `mcp__pubchem__get_external_references`

**Parameters Used:**
```json
{
  "cid": 2244
}
```

**Expected Behavior:**
Return external database references for Aspirin (ChEMBL, DrugBank, etc.)

**Actual Response:**
```json
{
  "message": "External references not yet implemented",
  "args": {
    "cid": 2244
  }
}
```

**Status:** Tool exists but not implemented

**Manual Verification:**
```bash
# Test PubChem API directly
curl "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/xrefs/RegistryID/JSON"
```

---

### Test Case 2: search_similar_compounds

**Tool:** `mcp__pubchem__search_similar_compounds`

**Parameters Used:**
```json
{
  "cid": 2244,
  "threshold": 95,
  "max_records": 3
}
```

**Expected Behavior:**
Return compounds similar to Aspirin

**Actual Error:**
```
Error executing tool search_similar_compounds: MCP error -32602: Invalid similarity search arguments
```

**Manual Verification:**
```bash
# Test PubChem similarity search
curl "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastsimilarity_2d/cid/2244/JSON?Threshold=95&MaxRecords=3"
```

---

## Quick Test Script

Save this as `test_failed_cases.sh`:

```bash
#!/bin/bash

echo "=========================================="
echo "Testing Failed API Cases"
echo "=========================================="
echo ""

# Test 1: ChEMBL availability
echo "1. Testing ChEMBL REST API..."
curl -s "https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL25.json" | jq -r '.molecule_chembl_id' 2>/dev/null
if [ $? -eq 0 ]; then
    echo "   ✓ ChEMBL API accessible"
else
    echo "   ✗ ChEMBL API failed"
fi
echo ""

# Test 2: UniProt availability
echo "2. Testing UniProt REST API..."
curl -s "https://rest.uniprot.org/uniprotkb/P04637.json" | jq -r '.primaryAccession' 2>/dev/null
if [ $? -eq 0 ]; then
    echo "   ✓ UniProt API accessible"
else
    echo "   ✗ UniProt API failed"
fi
echo ""

# Test 3: Reactome availability
echo "3. Testing Reactome REST API..."
curl -s "https://reactome.org/ContentService/data/query/TP53/pathways" | jq -r '.[0].displayName' 2>/dev/null
if [ $? -eq 0 ]; then
    echo "   ✓ Reactome API accessible"
else
    echo "   ✗ Reactome API failed"
fi
echo ""

# Test 4: PharmGKB availability
echo "4. Testing PharmGKB API..."
curl -s "https://api.pharmgkb.org/v1/data/gene?symbol=CYP2D6" 2>/dev/null | head -n 5
if [ $? -eq 0 ]; then
    echo "   ✓ PharmGKB API accessible"
else
    echo "   ✗ PharmGKB API failed or requires authentication"
fi
echo ""

# Test 5: Open Targets GraphQL
echo "5. Testing Open Targets GraphQL..."
curl -s -X POST https://api.platform.opentargets.org/api/v4/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ target(ensemblId: \"ENSG00000141510\") { approvedSymbol } }"}' | jq -r '.data.target.approvedSymbol' 2>/dev/null
if [ $? -eq 0 ]; then
    echo "   ✓ Open Targets API accessible"
else
    echo "   ✗ Open Targets API failed"
fi
echo ""

# Test 6: Ensembl REST API
echo "6. Testing Ensembl REST API..."
curl -s "https://rest.ensembl.org/lookup/id/ENSG00000141510?content-type=application/json" | jq -r '.display_name' 2>/dev/null
if [ $? -eq 0 ]; then
    echo "   ✓ Ensembl API accessible"
else
    echo "   ✗ Ensembl API failed"
fi
echo ""

# Test 7: PubChem external refs
echo "7. Testing PubChem external references..."
curl -s "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/xrefs/RegistryID/JSON" | jq -r '.InformationList.Information[0].CID' 2>/dev/null
if [ $? -eq 0 ]; then
    echo "   ✓ PubChem xrefs API accessible"
else
    echo "   ✗ PubChem xrefs API failed"
fi
echo ""

echo "=========================================="
echo "Test Complete"
echo "=========================================="
```

**Usage:**
```bash
chmod +x test_failed_cases.sh
./test_failed_cases.sh
```

---

## Python Test Script

Save this as `test_failed_cases.py`:

```python
#!/usr/bin/env python3
"""
Test script for failed API cases
Requires: requests, json
"""

import requests
import json
from typing import Dict, Any

def test_chembl():
    """Test ChEMBL REST API"""
    print("1. Testing ChEMBL REST API...")
    try:
        url = "https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL25.json"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            print(f"   ✓ ChEMBL API accessible: {data.get('molecule_chembl_id')}")
            return True
        else:
            print(f"   ✗ ChEMBL API failed: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"   ✗ ChEMBL API error: {e}")
        return False

def test_uniprot():
    """Test UniProt REST API"""
    print("2. Testing UniProt REST API...")
    try:
        url = "https://rest.uniprot.org/uniprotkb/P04637.json"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            print(f"   ✓ UniProt API accessible: {data.get('primaryAccession')}")
            return True
        else:
            print(f"   ✗ UniProt API failed: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"   ✗ UniProt API error: {e}")
        return False

def test_reactome():
    """Test Reactome REST API"""
    print("3. Testing Reactome REST API...")
    try:
        url = "https://reactome.org/ContentService/data/query/TP53/pathways"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data:
                print(f"   ✓ Reactome API accessible: {data[0].get('displayName')}")
                return True
        else:
            print(f"   ✗ Reactome API failed: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"   ✗ Reactome API error: {e}")
        return False

def test_pharmgkb():
    """Test PharmGKB API"""
    print("4. Testing PharmGKB API...")
    try:
        url = "https://api.pharmgkb.org/v1/data/gene?symbol=CYP2D6"
        response = requests.get(url, timeout=10)
        print(f"   Status: HTTP {response.status_code}")
        if response.status_code == 200:
            print(f"   ✓ PharmGKB API accessible")
            print(f"   Response preview: {response.text[:200]}")
            return True
        elif response.status_code == 401:
            print(f"   ⚠ PharmGKB requires authentication")
            return False
        else:
            print(f"   ✗ PharmGKB API failed: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"   ✗ PharmGKB API error: {e}")
        return False

def test_opentargets():
    """Test Open Targets GraphQL"""
    print("5. Testing Open Targets GraphQL...")
    try:
        url = "https://api.platform.opentargets.org/api/v4/graphql"
        query = {
            "query": '{ target(ensemblId: "ENSG00000141510") { approvedSymbol } }'
        }
        response = requests.post(url, json=query, timeout=10)
        if response.status_code == 200:
            data = response.json()
            symbol = data.get('data', {}).get('target', {}).get('approvedSymbol')
            print(f"   ✓ Open Targets API accessible: {symbol}")

            # Test search query
            search_query = {
                "query": '{ search(queryString: "TP53", entityNames: ["target"]) { total } }'
            }
            search_response = requests.post(url, json=search_query, timeout=10)
            if search_response.status_code == 200:
                print(f"   ✓ Search query works")
            else:
                print(f"   ✗ Search query failed: HTTP {search_response.status_code}")

            return True
        else:
            print(f"   ✗ Open Targets API failed: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"   ✗ Open Targets API error: {e}")
        return False

def test_ensembl():
    """Test Ensembl REST API"""
    print("6. Testing Ensembl REST API...")
    try:
        # Test with Ensembl ID
        url1 = "https://rest.ensembl.org/lookup/id/ENSG00000141510"
        headers = {"Content-Type": "application/json"}
        response1 = requests.get(url1, headers=headers, timeout=10)

        # Test with gene symbol
        url2 = "https://rest.ensembl.org/lookup/symbol/homo_sapiens/TP53"
        response2 = requests.get(url2, headers=headers, timeout=10)

        if response1.status_code == 200:
            data = response1.json()
            print(f"   ✓ Ensembl ID lookup: {data.get('display_name')}")

        if response2.status_code == 200:
            data = response2.json()
            print(f"   ✓ Ensembl symbol lookup: {data.get('display_name')}")

        # Test search endpoint
        url3 = "https://rest.ensembl.org/search/homo_sapiens/TP53"
        response3 = requests.get(url3, headers=headers, timeout=10)
        if response3.status_code == 200:
            print(f"   ✓ Ensembl search works")
        else:
            print(f"   ✗ Ensembl search failed: HTTP {response3.status_code}")

        return True
    except Exception as e:
        print(f"   ✗ Ensembl API error: {e}")
        return False

def test_pubchem():
    """Test PubChem API"""
    print("7. Testing PubChem external references...")
    try:
        url = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/xrefs/RegistryID/JSON"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            cid = data.get('InformationList', {}).get('Information', [{}])[0].get('CID')
            print(f"   ✓ PubChem xrefs API accessible: CID {cid}")

            # Test similarity search
            url2 = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastsimilarity_2d/cid/2244/cids/JSON?Threshold=95&MaxRecords=3"
            response2 = requests.get(url2, timeout=10)
            if response2.status_code == 200:
                print(f"   ✓ PubChem similarity search works")
            else:
                print(f"   ✗ PubChem similarity failed: HTTP {response2.status_code}")

            return True
        else:
            print(f"   ✗ PubChem API failed: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"   ✗ PubChem API error: {e}")
        return False

def main():
    print("=" * 50)
    print("Testing Failed API Cases")
    print("=" * 50)
    print()

    results = {
        "ChEMBL": test_chembl(),
        "UniProt": test_uniprot(),
        "Reactome": test_reactome(),
        "PharmGKB": test_pharmgkb(),
        "Open Targets": test_opentargets(),
        "Ensembl": test_ensembl(),
        "PubChem": test_pubchem()
    }

    print()
    print("=" * 50)
    print("Summary")
    print("=" * 50)
    for platform, success in results.items():
        status = "✓ PASS" if success else "✗ FAIL"
        print(f"{platform}: {status}")

    print()
    passed = sum(results.values())
    total = len(results)
    print(f"Total: {passed}/{total} platforms accessible")

if __name__ == "__main__":
    main()
```

**Usage:**
```bash
pip install requests
python3 test_failed_cases.py
```

---

## Next Steps

1. **Run test scripts** to verify which APIs are accessible
2. **Check MCP server configurations** in `~/.config/claude/claude_desktop_config.json`
3. **Review API documentation** for changed endpoints
4. **Test authentication requirements** for each platform
5. **Update MCP server implementations** based on findings
6. **Re-run verification** after fixes

---

## Notes

- All test cases use real production endpoints
- Test data is publicly accessible
- No authentication should be required for public APIs
- Focus on HTTP 400 errors - usually parameter/format issues
- Check API versioning carefully (v1 vs v4, etc.)

**Priority Order for Debugging:**
1. ClinPGx (all tools failing) - CRITICAL
2. ChEMBL (missing platform) - HIGH
3. UniProt (missing platform) - HIGH
4. Open Targets search - MEDIUM
5. Ensembl search/variants - MEDIUM
6. Reactome (missing platform) - LOW (workaround exists)

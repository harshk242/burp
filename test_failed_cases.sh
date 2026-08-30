#!/bin/bash
# Test Failed API Cases
# Usage: ./test_failed_cases.sh

echo "=========================================="
echo "Testing Failed API Cases"
echo "Date: $(date)"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: ChEMBL availability
echo "1. Testing ChEMBL REST API..."
result=$(curl -s "https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL25.json" 2>/dev/null)
if echo "$result" | jq -e '.molecule_chembl_id' > /dev/null 2>&1; then
    chembl_id=$(echo "$result" | jq -r '.molecule_chembl_id')
    echo -e "   ${GREEN}✓${NC} ChEMBL API accessible: $chembl_id"
    CHEMBL_STATUS="PASS"
else
    echo -e "   ${RED}✗${NC} ChEMBL API failed"
    CHEMBL_STATUS="FAIL"
fi
echo ""

# Test 2: UniProt availability
echo "2. Testing UniProt REST API..."
result=$(curl -s "https://rest.uniprot.org/uniprotkb/P04637.json" 2>/dev/null)
if echo "$result" | jq -e '.primaryAccession' > /dev/null 2>&1; then
    accession=$(echo "$result" | jq -r '.primaryAccession')
    echo -e "   ${GREEN}✓${NC} UniProt API accessible: $accession"
    UNIPROT_STATUS="PASS"
else
    echo -e "   ${RED}✗${NC} UniProt API failed"
    UNIPROT_STATUS="FAIL"
fi
echo ""

# Test 3: Reactome availability
echo "3. Testing Reactome REST API..."
result=$(curl -s "https://reactome.org/ContentService/data/query/TP53/pathways" 2>/dev/null)
if echo "$result" | jq -e '.[0].displayName' > /dev/null 2>&1; then
    pathway=$(echo "$result" | jq -r '.[0].displayName')
    echo -e "   ${GREEN}✓${NC} Reactome API accessible"
    echo "   First pathway: $pathway"
    REACTOME_STATUS="PASS"
else
    echo -e "   ${RED}✗${NC} Reactome API failed"
    REACTOME_STATUS="FAIL"
fi
echo ""

# Test 4: PharmGKB availability
echo "4. Testing PharmGKB API..."
result=$(curl -s -w "\n%{http_code}" "https://api.clinpgx.org/v1/data/gene?symbol=CYP2D6" 2>/dev/null)
http_code=$(echo "$result" | tail -n1)
body=$(echo "$result" | head -n-1)

if [ "$http_code" = "200" ]; then
    echo -e "   ${GREEN}✓${NC} PharmGKB API accessible (HTTP $http_code)"
    echo "   Response preview: ${body:0:100}..."
    PHARMGKB_STATUS="PASS"
elif [ "$http_code" = "401" ]; then
    echo -e "   ${YELLOW}⚠${NC} PharmGKB requires authentication (HTTP $http_code)"
    PHARMGKB_STATUS="AUTH_REQUIRED"
else
    echo -e "   ${RED}✗${NC} PharmGKB API failed (HTTP $http_code)"
    PHARMGKB_STATUS="FAIL"
fi
echo ""

# Test 5: Open Targets GraphQL
echo "5. Testing Open Targets GraphQL..."
result=$(curl -s -X POST https://api.platform.opentargets.org/api/v4/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ target(ensemblId: \"ENSG00000141510\") { approvedSymbol } }"}' 2>/dev/null)
if echo "$result" | jq -e '.data.target.approvedSymbol' > /dev/null 2>&1; then
    symbol=$(echo "$result" | jq -r '.data.target.approvedSymbol')
    echo -e "   ${GREEN}✓${NC} Open Targets API accessible: $symbol"

    # Test search query
    search_result=$(curl -s -X POST https://api.platform.opentargets.org/api/v4/graphql \
      -H "Content-Type: application/json" \
      -d '{"query":"{ search(queryString: \"TP53\", entityNames: [\"target\"]) { total } }"}' 2>/dev/null)
    if echo "$search_result" | jq -e '.data.search.total' > /dev/null 2>&1; then
        total=$(echo "$search_result" | jq -r '.data.search.total')
        echo -e "   ${GREEN}✓${NC} Search query works: $total results"
        OPENTARGETS_STATUS="PASS"
    else
        echo -e "   ${YELLOW}⚠${NC} Search query may have issues"
        OPENTARGETS_STATUS="PARTIAL"
    fi
else
    echo -e "   ${RED}✗${NC} Open Targets API failed"
    OPENTARGETS_STATUS="FAIL"
fi
echo ""

# Test 6: Ensembl REST API
echo "6. Testing Ensembl REST API..."
# Test with Ensembl ID
result1=$(curl -s "https://rest.ensembl.org/lookup/id/ENSG00000141510?content-type=application/json" 2>/dev/null)
# Test with gene symbol
result2=$(curl -s "https://rest.ensembl.org/lookup/symbol/homo_sapiens/TP53?content-type=application/json" 2>/dev/null)

if echo "$result1" | jq -e '.display_name' > /dev/null 2>&1; then
    display_name=$(echo "$result1" | jq -r '.display_name')
    echo -e "   ${GREEN}✓${NC} Ensembl ID lookup works: $display_name"
fi

if echo "$result2" | jq -e '.display_name' > /dev/null 2>&1; then
    echo -e "   ${GREEN}✓${NC} Ensembl symbol lookup works"
    ENSEMBL_STATUS="PASS"
else
    echo -e "   ${YELLOW}⚠${NC} Ensembl symbol lookup may have issues"
    ENSEMBL_STATUS="PARTIAL"
fi
echo ""

# Test 7: PubChem external refs
echo "7. Testing PubChem APIs..."
result=$(curl -s "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/xrefs/RegistryID/JSON" 2>/dev/null)
if echo "$result" | jq -e '.InformationList.Information[0].CID' > /dev/null 2>&1; then
    cid=$(echo "$result" | jq -r '.InformationList.Information[0].CID')
    echo -e "   ${GREEN}✓${NC} PubChem xrefs API accessible: CID $cid"

    # Test similarity search
    sim_result=$(curl -s "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastsimilarity_2d/cid/2244/cids/JSON?Threshold=95&MaxRecords=3" 2>/dev/null)
    if echo "$sim_result" | jq -e '.IdentifierList.CID' > /dev/null 2>&1; then
        echo -e "   ${GREEN}✓${NC} PubChem similarity search works"
        PUBCHEM_STATUS="PASS"
    else
        echo -e "   ${YELLOW}⚠${NC} PubChem similarity may have issues"
        PUBCHEM_STATUS="PARTIAL"
    fi
else
    echo -e "   ${RED}✗${NC} PubChem API failed"
    PUBCHEM_STATUS="FAIL"
fi
echo ""

# Summary
echo "=========================================="
echo "Summary"
echo "=========================================="
echo -e "ChEMBL:        $CHEMBL_STATUS"
echo -e "UniProt:       $UNIPROT_STATUS"
echo -e "Reactome:      $REACTOME_STATUS"
echo -e "PharmGKB:      $PHARMGKB_STATUS"
echo -e "Open Targets:  $OPENTARGETS_STATUS"
echo -e "Ensembl:       $ENSEMBL_STATUS"
echo -e "PubChem:       $PUBCHEM_STATUS"
echo "=========================================="
echo ""

# Count results
PASS_COUNT=0
[ "$CHEMBL_STATUS" = "PASS" ] && PASS_COUNT=$((PASS_COUNT+1))
[ "$UNIPROT_STATUS" = "PASS" ] && PASS_COUNT=$((PASS_COUNT+1))
[ "$REACTOME_STATUS" = "PASS" ] && PASS_COUNT=$((PASS_COUNT+1))
[ "$PHARMGKB_STATUS" = "PASS" ] && PASS_COUNT=$((PASS_COUNT+1))
[ "$OPENTARGETS_STATUS" = "PASS" ] && PASS_COUNT=$((PASS_COUNT+1))
[ "$ENSEMBL_STATUS" = "PASS" ] && PASS_COUNT=$((PASS_COUNT+1))
[ "$PUBCHEM_STATUS" = "PASS" ] && PASS_COUNT=$((PASS_COUNT+1))

echo "Total: $PASS_COUNT/7 platforms fully accessible"
echo ""

# Save results to file
REPORT_FILE="api_test_results_$(date +%Y%m%d_%H%M%S).txt"
{
    echo "API Test Results - $(date)"
    echo "================================"
    echo "ChEMBL: $CHEMBL_STATUS"
    echo "UniProt: $UNIPROT_STATUS"
    echo "Reactome: $REACTOME_STATUS"
    echo "PharmGKB: $PHARMGKB_STATUS"
    echo "Open Targets: $OPENTARGETS_STATUS"
    echo "Ensembl: $ENSEMBL_STATUS"
    echo "PubChem: $PUBCHEM_STATUS"
    echo ""
    echo "Total: $PASS_COUNT/7 platforms fully accessible"
} > "$REPORT_FILE"

echo "Results saved to: $REPORT_FILE"

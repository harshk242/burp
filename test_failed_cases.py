#!/usr/bin/env python3
"""
Test script for failed API cases
Requires: requests
Install: pip install requests
Usage: python3 test_failed_cases.py
"""

import requests
import json
from datetime import datetime
from typing import Dict, Tuple

# ANSI color codes
GREEN = '\033[0;32m'
RED = '\033[0;31m'
YELLOW = '\033[1;33m'
NC = '\033[0m'  # No Color

def print_status(success: bool, message: str, warning: bool = False):
    """Print colored status message"""
    if warning:
        print(f"   {YELLOW}⚠{NC} {message}")
    elif success:
        print(f"   {GREEN}✓{NC} {message}")
    else:
        print(f"   {RED}✗{NC} {message}")

def test_chembl() -> Tuple[str, str]:
    """Test ChEMBL REST API"""
    print("1. Testing ChEMBL REST API...")
    try:
        url = "https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL25.json"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            chembl_id = data.get('molecule_chembl_id', 'Unknown')
            print_status(True, f"ChEMBL API accessible: {chembl_id}")
            return "PASS", f"Accessible: {chembl_id}"
        else:
            print_status(False, f"ChEMBL API failed: HTTP {response.status_code}")
            return "FAIL", f"HTTP {response.status_code}"
    except Exception as e:
        print_status(False, f"ChEMBL API error: {str(e)[:50]}")
        return "FAIL", str(e)[:50]

def test_uniprot() -> Tuple[str, str]:
    """Test UniProt REST API"""
    print("\n2. Testing UniProt REST API...")
    try:
        url = "https://rest.uniprot.org/uniprotkb/P04637.json"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            accession = data.get('primaryAccession', 'Unknown')
            print_status(True, f"UniProt API accessible: {accession}")
            return "PASS", f"Accessible: {accession}"
        else:
            print_status(False, f"UniProt API failed: HTTP {response.status_code}")
            return "FAIL", f"HTTP {response.status_code}"
    except Exception as e:
        print_status(False, f"UniProt API error: {str(e)[:50]}")
        return "FAIL", str(e)[:50]

def test_reactome() -> Tuple[str, str]:
    """Test Reactome REST API"""
    print("\n3. Testing Reactome REST API...")
    try:
        url = "https://reactome.org/ContentService/data/query/TP53/pathways"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                pathway = data[0].get('displayName', 'Unknown')
                print_status(True, "Reactome API accessible")
                print(f"   First pathway: {pathway}")
                return "PASS", f"Found {len(data)} pathways"
            else:
                print_status(False, "Reactome returned empty data")
                return "FAIL", "Empty response"
        else:
            print_status(False, f"Reactome API failed: HTTP {response.status_code}")
            return "FAIL", f"HTTP {response.status_code}"
    except Exception as e:
        print_status(False, f"Reactome API error: {str(e)[:50]}")
        return "FAIL", str(e)[:50]

def test_pharmgkb() -> Tuple[str, str]:
    """Test PharmGKB API"""
    print("\n4. Testing PharmGKB API...")
    try:
        url = "https://api.pharmgkb.org/v1/data/gene?symbol=CYP2D6"
        response = requests.get(url, timeout=10)
        print(f"   Status: HTTP {response.status_code}")

        if response.status_code == 200:
            print_status(True, "PharmGKB API accessible")
            preview = response.text[:150] + "..." if len(response.text) > 150 else response.text
            print(f"   Response preview: {preview}")
            return "PASS", "Accessible"
        elif response.status_code == 401:
            print_status(False, "PharmGKB requires authentication", warning=True)
            return "AUTH_REQUIRED", "Authentication needed"
        else:
            print_status(False, f"PharmGKB API failed: HTTP {response.status_code}")
            return "FAIL", f"HTTP {response.status_code}"
    except Exception as e:
        print_status(False, f"PharmGKB API error: {str(e)[:50]}")
        return "FAIL", str(e)[:50]

def test_opentargets() -> Tuple[str, str]:
    """Test Open Targets GraphQL"""
    print("\n5. Testing Open Targets GraphQL...")
    try:
        url = "https://api.platform.opentargets.org/api/v4/graphql"

        # Test basic query
        query = {"query": '{ target(ensemblId: "ENSG00000141510") { approvedSymbol } }'}
        response = requests.post(url, json=query, timeout=10)

        if response.status_code == 200:
            data = response.json()
            symbol = data.get('data', {}).get('target', {}).get('approvedSymbol', 'Unknown')
            print_status(True, f"Open Targets API accessible: {symbol}")

            # Test search query
            search_query = {"query": '{ search(queryString: "TP53", entityNames: ["target"]) { total } }'}
            search_response = requests.post(url, json=search_query, timeout=10)

            if search_response.status_code == 200:
                search_data = search_response.json()
                total = search_data.get('data', {}).get('search', {}).get('total', 0)
                print_status(True, f"Search query works: {total} results")
                return "PASS", f"Symbol: {symbol}, Search: {total}"
            else:
                print_status(False, f"Search query failed: HTTP {search_response.status_code}", warning=True)
                return "PARTIAL", "Basic query works, search may have issues"
        else:
            print_status(False, f"Open Targets API failed: HTTP {response.status_code}")
            return "FAIL", f"HTTP {response.status_code}"
    except Exception as e:
        print_status(False, f"Open Targets API error: {str(e)[:50]}")
        return "FAIL", str(e)[:50]

def test_ensembl() -> Tuple[str, str]:
    """Test Ensembl REST API"""
    print("\n6. Testing Ensembl REST API...")
    try:
        headers = {"Content-Type": "application/json"}

        # Test with Ensembl ID
        url1 = "https://rest.ensembl.org/lookup/id/ENSG00000141510"
        response1 = requests.get(url1, headers=headers, timeout=10)

        # Test with gene symbol
        url2 = "https://rest.ensembl.org/lookup/symbol/homo_sapiens/TP53"
        response2 = requests.get(url2, headers=headers, timeout=10)

        results = []
        if response1.status_code == 200:
            data = response1.json()
            display_name = data.get('display_name', 'Unknown')
            print_status(True, f"Ensembl ID lookup works: {display_name}")
            results.append("ID lookup OK")

        if response2.status_code == 200:
            print_status(True, "Ensembl symbol lookup works")
            results.append("Symbol lookup OK")
        else:
            print_status(False, "Ensembl symbol lookup may have issues", warning=True)

        if results:
            return "PASS" if len(results) == 2 else "PARTIAL", ", ".join(results)
        else:
            return "FAIL", "Both lookups failed"

    except Exception as e:
        print_status(False, f"Ensembl API error: {str(e)[:50]}")
        return "FAIL", str(e)[:50]

def test_pubchem() -> Tuple[str, str]:
    """Test PubChem API"""
    print("\n7. Testing PubChem APIs...")
    try:
        # Test external references
        url = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/xrefs/RegistryID/JSON"
        response = requests.get(url, timeout=10)

        results = []
        if response.status_code == 200:
            data = response.json()
            cid = data.get('InformationList', {}).get('Information', [{}])[0].get('CID', 'Unknown')
            print_status(True, f"PubChem xrefs API accessible: CID {cid}")
            results.append("XRefs OK")

            # Test similarity search
            url2 = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastsimilarity_2d/cid/2244/cids/JSON?Threshold=95&MaxRecords=3"
            response2 = requests.get(url2, timeout=10)

            if response2.status_code == 200:
                print_status(True, "PubChem similarity search works")
                results.append("Similarity OK")
            else:
                print_status(False, f"PubChem similarity failed: HTTP {response2.status_code}", warning=True)
                results.append("Similarity failed")
        else:
            print_status(False, f"PubChem API failed: HTTP {response.status_code}")
            return "FAIL", f"HTTP {response.status_code}"

        if len(results) == 2 and "failed" not in results[1]:
            return "PASS", ", ".join(results)
        else:
            return "PARTIAL", ", ".join(results)

    except Exception as e:
        print_status(False, f"PubChem API error: {str(e)[:50]}")
        return "FAIL", str(e)[:50]

def main():
    """Main test runner"""
    print("=" * 60)
    print("Testing Failed API Cases")
    print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # Run all tests
    results = {
        "ChEMBL": test_chembl(),
        "UniProt": test_uniprot(),
        "Reactome": test_reactome(),
        "PharmGKB": test_pharmgkb(),
        "Open Targets": test_opentargets(),
        "Ensembl": test_ensembl(),
        "PubChem": test_pubchem()
    }

    # Print summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)

    for platform, (status, detail) in results.items():
        print(f"{platform:15} {status:15} {detail}")

    # Count results
    passed = sum(1 for status, _ in results.values() if status == "PASS")
    partial = sum(1 for status, _ in results.values() if status == "PARTIAL")
    total = len(results)

    print("=" * 60)
    print(f"Total: {passed}/{total} platforms fully accessible")
    if partial > 0:
        print(f"       {partial}/{total} platforms partially accessible")

    # Save results to file
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    report_file = f"api_test_results_{timestamp}.txt"

    with open(report_file, 'w') as f:
        f.write(f"API Test Results - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("=" * 60 + "\n\n")

        for platform, (status, detail) in results.items():
            f.write(f"{platform:15} {status:15} {detail}\n")

        f.write("\n")
        f.write(f"Total: {passed}/{total} platforms fully accessible\n")
        if partial > 0:
            f.write(f"       {partial}/{total} platforms partially accessible\n")

    print(f"\nResults saved to: {report_file}")

if __name__ == "__main__":
    main()

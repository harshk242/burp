# Testing Failed Cases - Quick Start Guide

This directory contains comprehensive test cases and scripts to manually verify failed API connections.

## Files Created

1. **FAILED_TEST_CASES.md** - Detailed documentation of all failed test cases
2. **test_failed_cases.sh** - Bash script for quick API testing
3. **test_failed_cases.py** - Python script with detailed testing
4. **PLATFORM_CONNECTIONS_VERIFICATION_REPORT.md** - Full verification report

---

## Quick Start

### Option 1: Bash Script (Fastest)

```bash
# Run the bash test script
./test_failed_cases.sh

# Output will show:
# - ✓ for working APIs
# - ✗ for failed APIs
# - ⚠ for APIs needing authentication
# - Results saved to timestamped file
```

**Requirements:**
- `curl` (usually pre-installed)
- `jq` (install: `sudo apt install jq` or `brew install jq`)

---

### Option 2: Python Script (More Detailed)

```bash
# Install requirements
pip install requests

# Run the python test script
python3 test_failed_cases.py

# Output will show:
# - Colored status for each platform
# - Detailed error messages
# - Summary with pass/fail counts
# - Results saved to timestamped file
```

---

## What Gets Tested

### ✅ Platforms That Should Work
1. **ChEMBL** - Compound/target database
2. **UniProt** - Protein sequences and annotations
3. **Reactome** - Pathway database
4. **Open Targets** - Integrated target-disease-drug associations
5. **Ensembl** - Genomic annotations
6. **PubChem** - Chemical compound database

### ⚠️ Known Issues
1. **PharmGKB** - May require authentication (all tools return HTTP 400)
2. **Open Targets search** - Some search endpoints fail
3. **PubChem similarity** - Some endpoints may need different parameters

---

## Interpreting Results

### Status Codes

- **PASS** - API is fully accessible and working
- **PARTIAL** - API accessible but some functions fail
- **FAIL** - API completely inaccessible or returning errors
- **AUTH_REQUIRED** - API requires authentication/API key

### Example Output

```
========================================
Summary
========================================
ChEMBL:        PASS
UniProt:       PASS
Reactome:      PASS
PharmGKB:      AUTH_REQUIRED
Open Targets:  PARTIAL
Ensembl:       PASS
PubChem:       PARTIAL
========================================
Total: 4/7 platforms fully accessible
```

---

## Detailed Investigation

For detailed investigation of specific failures, see **FAILED_TEST_CASES.md** which includes:

- Exact API calls that failed
- Expected vs actual behavior
- Manual verification commands
- curl examples for direct testing
- Investigation checklists

---

## Manual Testing Examples

### Test ChEMBL Directly

```bash
# Get Aspirin data
curl "https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL25.json" | jq

# Should return molecule_chembl_id: "CHEMBL25"
```

### Test UniProt Directly

```bash
# Get TP53 protein data
curl "https://rest.uniprot.org/uniprotkb/P04637.json" | jq

# Should return primaryAccession: "P04637"
```

### Test PharmGKB Directly

```bash
# Test gene query
curl "https://api.pharmgkb.org/v1/data/gene?symbol=CYP2D6"

# If returns 401, authentication is required
# If returns 400, check parameter format
```

### Test Open Targets GraphQL

```bash
# Test target query
curl -X POST https://api.platform.opentargets.org/api/v4/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ target(ensemblId: \"ENSG00000141510\") { approvedSymbol } }"}'

# Should return: {"data":{"target":{"approvedSymbol":"TP53"}}}
```

---

## Common Issues and Solutions

### Issue 1: jq command not found

**Solution:**
```bash
# Ubuntu/Debian
sudo apt-get install jq

# macOS
brew install jq

# Or use Python script instead (doesn't need jq)
```

### Issue 2: Connection timeout

**Solution:**
- Check internet connection
- Try increasing timeout in scripts
- Some APIs may be slow, wait and retry

### Issue 3: HTTP 400 errors

**Causes:**
- Wrong parameter format
- API version changed
- Missing required parameters
- Authentication required

**Debug:**
```bash
# Add verbose flag to see full request/response
curl -v "https://api.example.com/endpoint"
```

### Issue 4: HTTP 401/403 errors

**Causes:**
- Authentication required
- API key needed
- Rate limiting

**Solution:**
- Check API documentation for auth requirements
- Register for API key if needed
- Wait if rate limited

---

## Next Steps After Testing

### If APIs are accessible but MCP tools fail:

1. **Check MCP server configuration**
   ```bash
   cat ~/.config/claude/claude_desktop_config.json | jq '.mcpServers'
   ```

2. **Verify MCP server is running**
   ```bash
   # Check for MCP server processes
   ps aux | grep mcp
   ```

3. **Check MCP server logs**
   - Look in Claude desktop logs
   - Check for connection errors
   - Verify endpoint URLs match

4. **Update MCP server configuration**
   - Fix API endpoints
   - Add authentication if needed
   - Update API versions

### If APIs are not accessible:

1. **ChEMBL, UniProt, Reactome** - These should be publicly accessible
   - If failing, check network/firewall
   - Try from different network
   - Contact API provider

2. **PharmGKB** - Likely needs authentication
   - Register at https://www.pharmgkb.org/
   - Get API key
   - Add to MCP configuration

---

## Priority Fixes

Based on the verification report, prioritize fixes in this order:

### 🔴 CRITICAL (Fix First)
1. **PharmGKB (ClinPGx)** - All 16 tools failing with HTTP 400
   - Investigate authentication requirements
   - Check API endpoint URLs
   - Test with API key if needed

### 🟠 HIGH (Fix Soon)
2. **ChEMBL** - Platform missing entirely
   - Implement ChEMBL MCP server
   - Affects 8+ documented connections

3. **UniProt** - Platform missing entirely
   - Implement UniProt MCP server
   - Affects 9+ documented connections

### 🟡 MEDIUM (Fix When Possible)
4. **Open Targets Search** - search_entities failing
   - Debug GraphQL query format
   - Check API version compatibility

5. **Ensembl** - Some tools failing
   - Fix search_genes endpoint
   - Fix get_variants parameters

### 🟢 LOW (Nice to Have)
6. **Reactome** - Platform missing
   - Workaround exists via Ensembl xrefs
   - Implement when other priorities complete

---

## Getting Help

If you encounter issues:

1. Check **FAILED_TEST_CASES.md** for detailed debugging steps
2. Review **PLATFORM_CONNECTIONS_VERIFICATION_REPORT.md** for context
3. Test APIs directly with curl to isolate MCP vs API issues
4. Check API documentation for changes
5. Verify MCP server configuration

---

## Files Generated by Tests

Both scripts save timestamped results:
- `api_test_results_YYYYMMDD_HHMMSS.txt`

These files contain:
- Test timestamp
- Status for each platform
- Brief details about failures
- Overall pass/fail counts

Keep these for tracking progress as you fix issues.

---

## Example Complete Test Session

```bash
# 1. Run quick bash test
./test_failed_cases.sh

# 2. Review output for failures
# 3. Run detailed Python test for more info
python3 test_failed_cases.py

# 4. Check specific failure in detail
cat FAILED_TEST_CASES.md | grep -A 20 "ClinPGx"

# 5. Test problematic API directly
curl -v "https://api.pharmgkb.org/v1/data/gene?symbol=CYP2D6"

# 6. Fix MCP configuration based on findings
vim ~/.config/claude/claude_desktop_config.json

# 7. Restart Claude desktop and re-test
# 8. Run tests again to verify fixes
```

---

**Last Updated:** 2026-01-24
**Related Files:** PLATFORM_CONNECTIONS_VERIFICATION_REPORT.md, FAILED_TEST_CASES.md

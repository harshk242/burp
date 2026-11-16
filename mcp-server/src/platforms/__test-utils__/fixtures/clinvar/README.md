fields.json contains the name/fullname projection of the live NCBI einfo
fieldlist for db=clinvar, fetched 2026-11-13:
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?db=clinvar&retmode=json

Retain duplicate names (ACCN has two full names). Counts, timestamps and database
build metadata are omitted because they change without altering the search
contract. The live handler contract compares the complete projected list,
including additions. Refresh with the same projection after reviewing drift.

ESearch currently uses no sort parameter; the offline allowlist deliberately
rejects any added sort until its values are explicitly validated.

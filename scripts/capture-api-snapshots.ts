#!/usr/bin/env bun

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

interface SchemaNode {
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'unknown';
  path: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode | null;
}

function extractSchema(value: unknown, path = '$'): SchemaNode {
  if (value === null) return { type: 'null', path };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      path,
      items: value.length > 0 ? extractSchema(value[0], `${path}[]`) : null,
    };
  }
  if (typeof value === 'object') {
    const node: SchemaNode = { type: 'object', path, properties: {} };
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      node.properties![k] = extractSchema(v, `${path}.${k}`);
    }
    return node;
  }
  if (typeof value === 'string') return { type: 'string', path };
  if (typeof value === 'number') return { type: 'number', path };
  if (typeof value === 'boolean') return { type: 'boolean', path };
  return { type: 'unknown', path };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(
  __dirname,
  '../mcp-server/src/platforms/__test-utils__/fixtures',
);

function save(fixturePath: string, schema: SchemaNode): void {
  const fullPath = path.join(FIXTURES_DIR, fixturePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(schema, null, 2) + '\n');
  console.log(`  ✔  ${fixturePath}`);
}

const NCBI_API_KEY = process.env.NCBI_API_KEY;

async function getJson(url: string, params?: Record<string, string | number>): Promise<unknown> {
  const res = await axios.get(url, {
    params,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: 25_000,
  });
  return res.data;
}

async function graphql(
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const res = await axios.post(
    url,
    { query, variables },
    { headers: { 'Content-Type': 'application/json' }, timeout: 25_000 },
  );
  if (res.data.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(res.data.errors)}`);
  }
  return res.data.data;
}

async function ncbiGet(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<unknown> {
  return getJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${endpoint}`, {
    db: 'clinvar',
    retmode: 'json',
    ...params,
    ...(NCBI_API_KEY ? { api_key: NCBI_API_KEY } : {}),
  });
}

async function captureEnsembl(): Promise<void> {
  console.log('\n📋  Ensembl REST');

  save('ensembl/lookup-gene.schema.json',
    extractSchema(await getJson('https://rest.ensembl.org/lookup/id/ENSG00000139618')));

  save('ensembl/xrefs-gene.schema.json',
    extractSchema(await getJson('https://rest.ensembl.org/xrefs/id/ENSG00000139618')));

  save('ensembl/sequence-cds.schema.json',
    extractSchema(await getJson('https://rest.ensembl.org/sequence/id/ENST00000380152', { type: 'cds' })));

  save('ensembl/variation-rsid.schema.json',
    extractSchema(await getJson('https://rest.ensembl.org/variation/homo_sapiens/rs6025')));

  save('ensembl/info-assembly.schema.json',
    extractSchema(await getJson('https://rest.ensembl.org/info/assembly/homo_sapiens')));

  save('ensembl/homology-gene.schema.json',
    extractSchema(await getJson('https://rest.ensembl.org/homology/symbol/human/TP53', {
      type: 'orthologues',
      target_species: 'mus_musculus',
    })));
}

async function captureOpenTargets(): Promise<void> {
  console.log('\n📋  Open Targets GraphQL');
  const GQL = 'https://api.platform.opentargets.org/api/v4/graphql';

  save('open-targets/target-info.schema.json',
    extractSchema(await graphql(GQL,
      `query T($ensemblId:String!){target(ensemblId:$ensemblId){id approvedSymbol approvedName biotype functionDescriptions subcellularLocations{termSL location}targetClass{id label}}}`,
      { ensemblId: 'ENSG00000157764' })));

  save('open-targets/disease-info.schema.json',
    extractSchema(await graphql(GQL,
      `query D($efoId:String!){disease(efoId:$efoId){id name description synonyms{relation terms}therapeuticAreas{id name}}}`,
      { efoId: 'EFO_0000311' })));

  save('open-targets/drug-info.schema.json',
    extractSchema(await graphql(GQL,
      `query Dr($chemblId:String!){drug(chemblId:$chemblId){id name drugType maximumClinicalStage description tradeNames}}`,
      { chemblId: 'CHEMBL25' })));

  save('open-targets/target-associated-diseases.schema.json',
    extractSchema(await graphql(GQL,
      `query TAD($ensemblId:String!){target(ensemblId:$ensemblId){id associatedDiseases(page:{index:0,size:3}){count rows{disease{id name}score}}}}`,
      { ensemblId: 'ENSG00000157764' })));

  save('open-targets/search.schema.json',
    extractSchema(await graphql(GQL,
      `query S($queryString:String!){search(queryString:$queryString,page:{index:0,size:3}){total hits{id entity name description score}}}`,
      { queryString: 'BRCA2' })));
}

async function captureChembl(): Promise<void> {
  console.log('\n📋  ChEMBL REST');
  const BASE = 'https://www.ebi.ac.uk/chembl/api/data';

  save('chembl/molecule.schema.json',
    extractSchema(await getJson(`${BASE}/molecule/CHEMBL25.json`)));

  save('chembl/target.schema.json',
    extractSchema(await getJson(`${BASE}/target/CHEMBL203.json`)));

  save('chembl/activity-list.schema.json',
    extractSchema(await getJson(`${BASE}/activity.json`, { molecule_chembl_id: 'CHEMBL25', limit: 3 })));

  save('chembl/mechanism-list.schema.json',
    extractSchema(await getJson(`${BASE}/mechanism.json`, { molecule_chembl_id: 'CHEMBL25' })));

  save('chembl/assay.schema.json',
    extractSchema(await getJson(`${BASE}/assay/CHEMBL655942.json`)));
}

async function capturePubchem(): Promise<void> {
  console.log('\n📋  PubChem REST');
  const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
  const PROPS = 'MolecularFormula,MolecularWeight,CanonicalSMILES,InChI,InChIKey,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount';

  save('pubchem/compound-full.schema.json',
    extractSchema(await getJson(`${BASE}/compound/cid/2244/JSON`)));

  save('pubchem/compound-properties.schema.json',
    extractSchema(await getJson(`${BASE}/compound/cid/2244/property/${PROPS}/JSON`)));

  save('pubchem/compound-synonyms.schema.json',
    extractSchema(await getJson(`${BASE}/compound/cid/2244/synonyms/JSON`)));

  save('pubchem/compound-by-name.schema.json',
    extractSchema(await getJson(`${BASE}/compound/name/aspirin/JSON`)));

  save('pubchem/compound-description.schema.json',
    extractSchema(await getJson(`${BASE}/compound/cid/2244/description/JSON`)));
}

async function captureClinvar(): Promise<void> {
  console.log('\n📋  ClinVar (NCBI E-utilities)');

  save('clinvar/esearch-rsid.schema.json',
    extractSchema(await ncbiGet('esearch.fcgi', { term: 'rs1042522', retmax: 5 })));

  save('clinvar/esearch-gene.schema.json',
    extractSchema(await ncbiGet('esearch.fcgi', { term: 'TP53[gene]', retmax: 5 })));

  save('clinvar/esearch-condition.schema.json',
    extractSchema(await ncbiGet('esearch.fcgi', { term: 'Lynch syndrome[dis]', retmax: 5 })));

  save('clinvar/esummary-variants.schema.json',
    extractSchema(await ncbiGet('esummary.fcgi', { id: '7105,7106' })));
}

async function main(): Promise<void> {
  console.log('🔬  Capturing API schema snapshots for Phase-1 contract tests');
  console.log(`    Fixtures → ${FIXTURES_DIR}\n`);

  const platforms = [
    { name: 'Ensembl', fn: captureEnsembl },
    { name: 'Open Targets', fn: captureOpenTargets },
    { name: 'ChEMBL', fn: captureChembl },
    { name: 'PubChem', fn: capturePubchem },
    { name: 'ClinVar', fn: captureClinvar },
  ];

  const failed: string[] = [];

  for (const { name, fn } of platforms) {
    try {
      await fn();
    } catch (err) {
      console.error(`\n❌  ${name} failed:`, (err as Error).message);
      failed.push(name);
    }
  }

  console.log('\n─────────────────────────────────────────────────────────────');
  if (failed.length === 0) {
    console.log('✅  All fixtures captured. Review with: git diff --stat');
    console.log('    Then commit: git add mcp-server/src/platforms/__test-utils__/fixtures');
  } else {
    console.log(`⚠️   Completed with errors. Failed: ${failed.join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

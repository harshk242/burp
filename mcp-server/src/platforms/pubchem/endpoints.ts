export const PUBCHEM_PUG_REST_BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

type Cid = number | string;

const encodeCid = (cid: Cid): string => encodeURIComponent(String(cid));

export const compoundRecord = (cid: Cid, format = 'JSON'): string =>
  `${PUBCHEM_PUG_REST_BASE_URL}/compound/cid/${encodeCid(cid)}/${format}`;

/** Build the content-negotiated PubChem PUG REST URL for compound descriptions. */
export const compoundDescriptions = (cid: Cid): string =>
  `${PUBCHEM_PUG_REST_BASE_URL}/compound/cid/${encodeCid(cid)}/description/`;

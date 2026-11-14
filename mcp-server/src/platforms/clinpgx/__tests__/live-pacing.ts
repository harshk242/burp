import axios, { type AxiosAdapter } from 'axios';
import { pace } from '../../__test-utils__/tool-requests.js';

// Serialize transport starts across both contract files, including concurrent
// handler requests and retries, to respect https://api.clinpgx.org/ (2 req/s).
let queue = Promise.resolve();
export function turn() {
  const next = queue.then(() => pace(550));
  queue = next.catch(() => {});
  return next;
}
const transport = axios.getAdapter(axios.defaults.adapter);
export const pacedTransport: AxiosAdapter = async config => {
  await turn();
  return transport(config);
};

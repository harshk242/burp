#!/usr/bin/env bun
// Drives the MCP server over stdio the way the app does and fails if stdout ever carries anything
// but newline-delimited JSON-RPC. In-process tests cannot catch a stray stdout write; only a real
// child process can. Self-contained (Bun APIs only) so it also runs inside the production image.
//
// Default (offline): serves a stub Open Targets API that steers search_entities("KLK3") into the
// canonical-resolve branch, then requires the call to succeed and the server to keep answering.
// --live: real APIs, one cheap call per platform. Tool-level failures (isError, slow upstreams)
// are reported but tolerated; only protocol violations and JSON-RPC errors fail.
//
// Usage: bun stdio-probe.ts [--live] -- <server command...>
//   bun scripts/stdio-probe.ts -- bun src/index.ts
//   bun /tmp/stdio-probe.ts -- node /app/mcp-server/dist/index.js

const CANONICAL_ID = 'ENSG00000142515';
const CALL_TIMEOUT_MS = { stub: 15_000, live: 120_000 };

type Call = { name: string; arguments: Record<string, unknown> };

const LIVE_CALLS: Call[] = [
  { name: 'open-targets__search_entities', arguments: { query_string: 'KLK3' } },
  { name: 'open-targets__search_suggestions', arguments: { query_prefix: 'BRAF' } },
  { name: 'ensembl__lookup_gene', arguments: { gene_id: 'ENSG00000139618' } },
  { name: 'uniprot__search_by_gene', arguments: { gene: 'BRCA1', size: 3 } },
  { name: 'clinvar__search_variants_by_gene', arguments: { gene: 'BRCA1', max_results: 3 } },
  { name: 'pubmed__search_pubmed', arguments: { query: 'KLK3 prostate', max_results: 3 } },
  { name: 'chembl__search_targets', arguments: { query: 'EGFR', limit: 3 } },
  { name: 'reactome__find_pathways_by_gene', arguments: { gene: 'TP53' } },
  { name: 'pubchem__search_compounds', arguments: { query: 'aspirin' } },
  { name: 'clinicaltrials__search_studies', arguments: { condition: 'prostate cancer' } },
  { name: 'clinpgx__search_genes', arguments: { query: 'CYP2D6' } },
];

// Probe flags come first; everything from the first non-flag argument is the server command.
// (Bun may or may not pass a literal `--` through, so it is accepted and skipped.)
const argv = process.argv.slice(2);
let i = 0;
let live = false;
for (; i < argv.length && argv[i].startsWith('--'); i++) {
  if (argv[i] === '--live') live = true;
  else if (argv[i] !== '--') { console.error(`unknown flag ${argv[i]}`); process.exit(2); }
}
const command = argv.slice(i);
if (command.length === 0) {
  console.error('usage: bun stdio-probe.ts [--live] -- <server command...>');
  process.exit(2);
}

const failures: string[] = [];
const fail = (msg: string) => { failures.push(msg); console.error(`  FAIL ${msg}`); };
const ok = (msg: string) => console.error(`  ok   ${msg}`);

function startStub() {
  const searchedFor: string[] = [];
  const hit = (id: string, name: string, score: number) => ({
    id, name, entity: 'target', description: null, score, highlights: [],
    object: { __typename: 'Target', id, approvedSymbol: name, approvedName: name, biotype: 'protein_coding' },
  });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const { query, variables } = (await req.json()) as { query: string; variables: Record<string, unknown> };
      if (query.includes('mapIds(')) {
        return Response.json({ data: { mapIds: { total: 1, mappings: [{
          term: 'KLK3',
          hits: [{ ...hit(CANONICAL_ID, 'KLK3', 1.0), category: 'target', multiplier: 1, prefixes: [] }],
        }] } } });
      }
      if (query.includes('search(')) {
        const q = String(variables.queryString);
        searchedFor.push(q);
        // The direct text search ranks a different target first, so the server resolves to the
        // exact mapIds match and searches again by its canonical ID.
        const hits = q === CANONICAL_ID
          ? [hit(CANONICAL_ID, 'KLK3', 10)]
          : [hit('ENSG00000167751', 'KLK2', 12), hit(CANONICAL_ID, 'KLK3', 9)];
        return Response.json({ data: { search: { total: hits.length, hits } } });
      }
      return Response.json({ errors: [{ message: `stub: unhandled query ${query.slice(0, 80)}` }] });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/`, searchedFor, stop: () => server.stop(true) };
}

const stub = live ? null : startStub();
const env: Record<string, string | undefined> = { ...process.env };
if (stub) {
  env.ENABLED_PLATFORMS = 'open-targets';
  env.OPEN_TARGETS_API_URL = stub.url;
}

const proc = Bun.spawn(command, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env });
let stderrTail = '';
void (async () => {
  for await (const chunk of proc.stderr) stderrTail = (stderrTail + new TextDecoder().decode(chunk)).slice(-4000);
})();

type Pending = { resolve: (msg: any) => void; reject: (err: Error) => void };
const pending = new Map<number, Pending>();
const violations: string[] = [];

void (async () => {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of proc.stdout) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) > -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        violations.push(line);
        continue;
      }
      if (msg?.jsonrpc !== '2.0') { violations.push(line); continue; }
      if (typeof msg.id === 'number' && pending.has(msg.id) && !('method' in msg)) {
        pending.get(msg.id)!.resolve(msg);
        pending.delete(msg.id);
      }
    }
  }
  if (buffer.trim()) violations.push(buffer);
})();

let nextId = 1;
function send(payload: Record<string, unknown>) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...payload }) + '\n');
  proc.stdin.flush();
}
function request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (msg) => { clearTimeout(timer); resolve(msg); },
      reject,
    });
    send({ id, method, params });
  });
}

function resultText(msg: any): string {
  return (msg?.result?.content ?? []).map((c: any) => c?.text ?? '').join('');
}

async function main() {
  const timeout = live ? CALL_TIMEOUT_MS.live : CALL_TIMEOUT_MS.stub;
  console.error(`stdio probe (${live ? 'live' : 'stub'}): ${command.join(' ')}`);

  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'stdio-probe', version: '1.0.0' },
  }, 30_000);
  if (init.error) return fail(`initialize: ${JSON.stringify(init.error)}`);
  send({ method: 'notifications/initialized' });
  ok('initialize');

  const list = await request('tools/list', {}, 30_000);
  const names = new Set<string>((list.result?.tools ?? []).map((t: { name: string }) => t.name));
  if (names.size === 0) return fail('tools/list returned no tools');
  ok(`tools/list: ${names.size} tools`);

  const calls = live ? LIVE_CALLS : [LIVE_CALLS[0]];
  await Promise.all(calls.map(async (call) => {
    if (!names.has(call.name)) return fail(`${call.name} is not registered`);
    try {
      const res = await request('tools/call', call, timeout);
      if (res.error) return fail(`${call.name}: JSON-RPC error ${JSON.stringify(res.error)}`);
      if (res.result?.isError) {
        const msg = `${call.name} returned isError: ${resultText(res).slice(0, 200)}`;
        return live ? console.error(`  warn ${msg}`) : fail(msg);
      }
      if (!live && !resultText(res).includes(CANONICAL_ID)) return fail(`${call.name}: canonical ID missing from result`);
      ok(call.name);
    } catch (error) {
      const msg = `${call.name}: ${(error as Error).message}`;
      if (live) console.error(`  warn ${msg}`);
      else fail(msg);
    }
  }));

  if (stub) {
    if (stub.searchedFor.includes(CANONICAL_ID)) ok('canonical-resolve branch exercised');
    else fail(`canonical-resolve branch not reached (searched: ${stub.searchedFor.join(', ')})`);
  }

  // The server must still answer after the calls (a corrupted stream or crash would not).
  const again = await request('tools/list', {}, 30_000).catch((e: Error) => ({ error: e.message }));
  if (again.error) fail(`server stopped answering: ${JSON.stringify(again.error)}`);
  else ok('server still answering');
}

try {
  await main();
} catch (error) {
  fail((error as Error).message);
}

// Let any trailing stdout bytes arrive before judging the stream.
await Bun.sleep(100);
if (violations.length > 0) {
  fail(`${violations.length} non-JSON-RPC line(s) on stdout:\n${violations.slice(0, 5).map((l) => `      > ${l.slice(0, 300)}`).join('\n')}`);
} else {
  ok('stdout carried only JSON-RPC');
}

proc.kill();
stub?.stop();

if (failures.length > 0) {
  console.error(`\nstdio probe FAILED (${failures.length})\n--- server stderr (tail) ---\n${stderrTail}`);
  process.exit(1);
}
console.error('\nstdio probe passed');
process.exit(0);

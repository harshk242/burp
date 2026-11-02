import { logger } from "../logger";

interface ConfigPage {
  data: { id: string; name: string; isArchived: boolean }[];
  meta: { totalPages: number };
}

export interface ScoreConfigSource {
  api: { scoreConfigs: { get(request: { page: number; limit: number }): Promise<ConfigPage> } };
}

let ids = new Map<string, string>();
const warned = new Set<string>();
let loading: Promise<void> | null = null;
let loaded = false;
let source: ScoreConfigSource | null = null;
let failures = 0;
let retryAt = 0;
export const SCORE_CONFIG_RETRY_BASE_MS = 1000;

export function loadScoreConfigIds(client: ScoreConfigSource | null, now = Date.now()): Promise<void> {
  source = client;
  if (!client || loaded || now < retryAt) return Promise.resolve();
  loading ??= fetchAll(client, now).finally(() => { loading = null; });
  return loading;
}

async function fetchAll(client: ScoreConfigSource, now: number): Promise<void> {
  const complete = new Map<string, string>();
  try {
    for (let page = 1; ; page++) {
      const res = await client.api.scoreConfigs.get({ page, limit: 100 });
      for (const config of res.data) if (!config.isArchived) complete.set(config.name, config.id);
      if (page >= res.meta.totalPages || res.data.length === 0) break;
    }
    ids = complete;
    loaded = true;
    failures = 0;
    retryAt = 0;
    warned.clear();
    logger.info("TRACE", "score_configs_loaded", { data: { count: ids.size } });
  } catch (error) {
    failures++;
    retryAt = now + Math.min(SCORE_CONFIG_RETRY_BASE_MS * 2 ** (failures - 1), 60_000);
    logger.warn("TRACE", "score_configs_load_failed", { error: error instanceof Error ? error : String(error) });
  }
}

export function scoreConfigId(name: string): string | undefined {
  if (!loaded && source) void loadScoreConfigIds(source);
  const id = ids.get(name);
  if (!id && !warned.has(name)) {
    warned.add(name);
    logger.warn("TRACE", "score_config_missing", { data: { name, hint: "run `bun run eval:sync --apply`" } });
  }
  return id;
}

export function setScoreConfigIdsForTests(entries: Record<string, string>): void {
  ids.clear();
  warned.clear();
  loaded = true;
  loading = null;
  for (const [name, id] of Object.entries(entries)) ids.set(name, id);
}

export function resetScoreConfigIdsForTests(): void {
  ids.clear();
  warned.clear();
  loading = null;
  loaded = false;
  source = null;
  failures = 0;
  retryAt = 0;
}

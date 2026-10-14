import { logger } from "../logger";

interface ConfigPage {
  data: { id: string; name: string; isArchived: boolean }[];
  meta: { totalPages: number };
}

export interface ScoreConfigSource {
  api: { scoreConfigs: { get(request: { page: number; limit: number }): Promise<ConfigPage> } };
}

const ids = new Map<string, string>();
const warned = new Set<string>();
let loading: Promise<void> | null = null;

export function loadScoreConfigIds(client: ScoreConfigSource | null): Promise<void> {
  if (!client) return Promise.resolve();
  loading ??= fetchAll(client);
  return loading;
}

async function fetchAll(client: ScoreConfigSource): Promise<void> {
  try {
    for (let page = 1; ; page++) {
      const res = await client.api.scoreConfigs.get({ page, limit: 100 });
      for (const config of res.data) if (!config.isArchived) ids.set(config.name, config.id);
      if (page >= res.meta.totalPages || res.data.length === 0) break;
    }
    logger.info("TRACE", "score_configs_loaded", { data: { count: ids.size } });
  } catch (error) {
    logger.warn("TRACE", "score_configs_load_failed", { error: error instanceof Error ? error : String(error) });
  }
}

export function scoreConfigId(name: string): string | undefined {
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
  loading = Promise.resolve();
  for (const [name, id] of Object.entries(entries)) ids.set(name, id);
}

export function resetScoreConfigIdsForTests(): void {
  ids.clear();
  warned.clear();
  loading = null;
}

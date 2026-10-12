/**
 * Sync planner + apply against an in-memory Langfuse: first apply writes everything, a second
 * apply is a no-op, removed items are archived (never deleted), changed metric definitions conflict.
 */
import { describe, expect, it } from "bun:test";
import type {
  DatasetBody,
  DatasetItemBody,
  LangfuseApi,
  RemoteDataset,
  RemoteDatasetItem,
  RemoteScoreConfig,
} from "../lib/langfuse-api";
import { loadEvalHome, type EvalHome } from "../lib/load";
import { localDatasetHash, planSync, remoteContentHash, type GitInfo } from "../lib/plan";
import { applyActions, fetchRemoteState } from "../sync";

class FakeLangfuse implements LangfuseApi {
  configs: RemoteScoreConfig[] = [];
  datasets = new Map<string, RemoteDataset>();
  items = new Map<string, RemoteDatasetItem>();
  writes = 0;

  async listScoreConfigs() {
    return structuredClone(this.configs);
  }
  async createScoreConfig(body: Omit<RemoteScoreConfig, "id" | "isArchived">) {
    if (this.configs.some((c) => c.name === body.name)) throw new Error(`duplicate config ${body.name}`);
    this.writes++;
    const config = { ...structuredClone(body), id: `cfg-${this.configs.length}`, isArchived: false };
    this.configs.push(config);
    return config;
  }
  async getDataset(name: string) {
    return structuredClone(this.datasets.get(name) ?? null);
  }
  async upsertDataset(body: DatasetBody) {
    this.writes++;
    const dataset = { ...structuredClone(body), id: this.datasets.get(body.name)?.id ?? `ds-${body.name}` };
    this.datasets.set(body.name, dataset);
    return dataset;
  }
  async listItems(datasetName: string) {
    return structuredClone([...this.items.values()].filter((i) => i.datasetName === datasetName));
  }
  async getItem(id: string) {
    return structuredClone(this.items.get(id) ?? null);
  }
  async upsertItem(body: DatasetItemBody) {
    if (!this.datasets.has(body.datasetName)) throw new Error(`dataset ${body.datasetName} not found`);
    const existing = this.items.get(body.id);
    if (existing && existing.datasetName !== body.datasetName) throw new Error(`item ${body.id} in another dataset`);
    this.writes++;
    // Round-trip through JSON like the real API does.
    const item = JSON.parse(JSON.stringify(body)) as RemoteDatasetItem;
    this.items.set(body.id, item);
    return item;
  }
  async deleteItem(id: string) {
    this.items.delete(id);
  }
}

const git: GitInfo = { sha: "abc1234", dirty: false };

async function sync(api: FakeLangfuse, home: EvalHome, gitInfo = git) {
  const plan = planSync(home, await fetchRemoteState(api, home), gitInfo);
  if (plan.conflicts.length === 0) await applyActions(api, plan.actions);
  return plan;
}

describe("eval sync", () => {
  it("first apply creates active configs, datasets and items; second apply is a no-op", async () => {
    const home = loadEvalHome();
    const api = new FakeLangfuse();
    const first = await sync(api, home);

    expect(first.conflicts).toEqual([]);
    const active = home.metrics.filter((m) => m.status === "active").map((m) => m.name);
    expect(api.configs.map((c) => c.name).sort()).toEqual(active.sort());
    expect(api.configs.find((c) => c.name === "user_feedback")).toBeUndefined();
    const outcome = api.configs.find((c) => c.name === "turn_outcome")!;
    expect(outcome.dataType).toBe("CATEGORICAL");
    expect(outcome.categories?.[0]).toEqual({ label: "ok", value: 0 });
    expect(api.configs.find((c) => c.name === "id_grounding")).toMatchObject({ minValue: 0, maxValue: 1 });

    for (const { dataset, file } of home.datasets) {
      const remote = api.datasets.get(dataset.name)!;
      expect(remote.metadata).toMatchObject({
        file: `app/evals/${file}`,
        git_sha: "abc1234",
        dataset_hash: localDatasetHash(dataset),
      });
      const items = await api.listItems(dataset.name);
      expect(items.length).toBe(dataset.items.length);
      for (const item of items) {
        expect(item.status).toBe("ACTIVE");
        expect(item.metadata?.content_hash).toBe(remoteContentHash(item));
      }
    }

    const writes = api.writes;
    const second = await sync(api, home, { sha: "def5678", dirty: true });
    expect(second.actions).toEqual([]);
    expect(api.writes).toBe(writes);
  });

  it("archives items removed from YAML and restores them when they come back", async () => {
    const home = loadEvalHome();
    const api = new FakeLangfuse();
    await sync(api, home);

    const smoke = home.datasets.find((d) => d.dataset.name === "smoke")!;
    const removed = smoke.dataset.items[0]!;
    const trimmed: EvalHome = {
      ...home,
      datasets: home.datasets.map((d) =>
        d === smoke ? { ...d, dataset: { ...d.dataset, items: d.dataset.items.slice(1) } } : d,
      ),
    };
    const plan = await sync(api, trimmed);
    expect(plan.actions.map((a) => a.kind).sort()).toEqual(["archive-item", "upsert-dataset"]);
    const archived = api.items.get(removed.id)!;
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.input).toEqual(removed.input);
    expect((await sync(api, trimmed)).actions).toEqual([]);

    const restored = await sync(api, home);
    expect(restored.actions.find((a) => a.kind === "upsert-item")).toMatchObject({ reason: "unarchive" });
    expect(api.items.get(removed.id)!.status).toBe("ACTIVE");
  });

  it("re-upserts an item edited in Langfuse (stored hashes are never trusted)", async () => {
    const home = loadEvalHome();
    const api = new FakeLangfuse();
    await sync(api, home);
    const id = home.datasets[0]!.dataset.items[0]!.id;
    api.items.get(id)!.input = { turns: ["edited in the UI"] };

    const plan = await sync(api, home);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ kind: "upsert-item", reason: "changed", changed: ["input"] });
  });

  it("refuses to edit a synced config whose definition changed", async () => {
    const home = loadEvalHome();
    const api = new FakeLangfuse();
    await sync(api, home);

    const changed: EvalHome = {
      ...home,
      metrics: home.metrics.map((m) => (m.name === "tool_error_count" ? { ...m, max: 50 } : m)),
    };
    const writes = api.writes;
    const plan = await sync(api, changed);
    expect(plan.conflicts.length).toBe(1);
    expect(plan.conflicts[0]).toContain("tool_error_count");
    expect(plan.conflicts[0]).toContain("new metric name");
    expect(api.writes).toBe(writes);
  });

  it("warns, without writing, when only a config description differs", async () => {
    const home = loadEvalHome();
    const api = new FakeLangfuse();
    await sync(api, home);
    api.configs[0]!.description = "edited";

    const plan = await sync(api, home);
    expect(plan.actions).toEqual([]);
    expect(plan.warnings.join("\n")).toContain("description differs");
  });
});

import { EvalLoadError, loadEvalHome, EVALS_DIR, type EvalHome } from "./lib/load";
import { langfuseApiFromEnv, type LangfuseApi } from "./lib/langfuse-api";
import { orderActions, planSync, type GitInfo, type RemoteState, type SyncAction } from "./lib/plan";

function git(args: string[]): string | null {
  const res = Bun.spawnSync(["git", ...args], { cwd: EVALS_DIR, stdout: "pipe", stderr: "pipe" });
  return res.exitCode === 0 ? res.stdout.toString().trim() : null;
}

function gitInfo(): GitInfo {
  const sha = process.env.GIT_SHA || git(["rev-parse", "--short", "HEAD"]) || "unknown";
  const status = git(["status", "--porcelain", "--", "."]);
  return { sha, dirty: status === null ? true : status.length > 0 };
}

export async function fetchRemoteState(api: LangfuseApi, home: EvalHome): Promise<RemoteState> {
  const datasets: RemoteState["datasets"] = new Map();
  const configs = await api.listScoreConfigs();
  for (const { dataset } of home.datasets) {
    const remote = await api.getDataset(dataset.name);
    datasets.set(dataset.name, { dataset: remote, items: remote ? await api.listItems(dataset.name) : [] });
  }
  return { configs, datasets };
}

export function describeAction(action: SyncAction): string {
  switch (action.kind) {
    case "create-config":
      return `create score config ${action.body.name}`;
    case "upsert-dataset":
      return `${action.reason === "new" ? "create" : "update"} dataset ${action.body.name}`;
    case "upsert-item":
      return `upsert item ${action.body.datasetName}/${action.body.id} (${action.reason})`;
    case "archive-item":
      return `archive item ${action.body.datasetName}/${action.body.id}`;
  }
}

async function applyOne(api: LangfuseApi, action: SyncAction): Promise<void> {
  switch (action.kind) {
    case "create-config":
      await api.createScoreConfig(action.body);
      return;
    case "upsert-dataset":
      await api.upsertDataset(action.body);
      return;
    case "upsert-item":
    case "archive-item":
      await api.upsertItem(action.body);
      return;
  }
}

export async function applyActions(
  api: LangfuseApi,
  actions: SyncAction[],
  log: (line: string) => void = () => {},
): Promise<void> {
  for (const action of orderActions(actions)) {
    await applyOne(api, action);
    log(`  ✓ ${describeAction(action)}`);
  }
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: bun run eval:sync [--apply]");
    return 0;
  }
  const unknown = argv.filter((a) => a !== "--apply");
  if (unknown.length) {
    console.error(`unknown argument(s): ${unknown.join(" ")}\nusage: bun run eval:sync [--apply]`);
    return 2;
  }
  const doApply = argv.includes("--apply");

  let home: EvalHome;
  try {
    home = loadEvalHome();
  } catch (err) {
    if (err instanceof EvalLoadError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
  const items = home.datasets.reduce((n, d) => n + d.dataset.items.length, 0);
  console.log(`loaded ${home.datasets.length} dataset(s), ${items} item(s), ${home.metrics.length} metric(s)`);

  const api = langfuseApiFromEnv();
  const git = gitInfo();
  const plan = planSync(home, await fetchRemoteState(api, home), git);

  console.log(`\n${plan.report.join("\n")}`);
  for (const w of plan.warnings) console.log(`warning: ${w}`);
  for (const c of plan.conflicts) console.error(`conflict: ${c}`);
  if (plan.conflicts.length) {
    console.error("\nresolve the conflicts above before syncing (nothing was written)");
    return 1;
  }
  if (plan.actions.length === 0) {
    console.log("\nin sync: nothing to do");
    return 0;
  }
  if (!doApply) {
    console.log(`\ndry run: ${plan.actions.length} change(s) pending; re-run with --apply to write`);
    return 0;
  }
  if (git.dirty) console.log("note: app/evals has uncommitted changes; dataset metadata records git_dirty: true");

  console.log("");
  await applyActions(api, plan.actions, (line) => console.log(line));

  const verify = planSync(home, await fetchRemoteState(api, home), git);
  if (verify.actions.length || verify.conflicts.length) {
    console.error(`\nverification: ${verify.actions.length} change(s) still pending after apply:`);
    for (const a of verify.actions) console.error(`  - ${describeAction(a)}`);
    return 1;
  }
  console.log(`\napplied ${plan.actions.length} change(s); verified in sync`);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}

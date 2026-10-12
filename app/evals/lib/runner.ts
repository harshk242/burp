/**
 * The experiment runner behind `bun run eval` (plan 2.1). Loaded by run.ts
 * after DATABASE_URL points at the run's own DB, because server modules read
 * config at import.
 *
 * Order: own DB + eval user → tracing (with async context for the task span)
 * → pinned dataset fetched and verified against the local YAML → tools booted
 * through the production path, search indexed and probed → N experiments
 * sharing one cost budget → report. Cleanup is signal-safe (lifecycle.ts).
 */
import { randomUUID } from "node:crypto";
import type { LangfuseClient } from "@langfuse/client";
import { initializeTools, toolsReport, type ToolsBoot } from "../../server/boot/tools";
import { runMigrations, sqlite, userQueries } from "../../server/db";
import { chatProviderOptions, loadLLMConfig } from "../../server/llm";
import { mcpManager } from "../../server/mcp/manager";
import { getScoreClient, initTracing, scoreConfigsReady, shutdownTracing } from "../../server/observability/langfuse";
import { contextVersion } from "../../server/orchestration/context/transcript";
import { SYSTEM_PROMPT } from "../../server/orchestration/context/system-prompt";
import { SharedCostBudget } from "../../server/orchestration/cost-budget";
import { hybridSearch } from "../../server/search";
import { assertPricingConfigured } from "../../server/usage";
import { DEFAULT_CONCURRENCY, DEFAULT_MAX_COST_USD, type RunArgs } from "./args";
import { varianceReport } from "./aggregate";
import { runExperiment, type ExperimentOutcome, type FetchedItem } from "./experiment";
import { RunLifecycle } from "./lifecycle";
import { loadEvalHome } from "./load";
import { printOutcome, printVariance } from "./report";
import { assertSearchReady, PROBE_QUERY, RunAbort } from "./search-check";
import { experimentName, gitState, runMetadata, scoringHashes, type SearchState } from "./run-meta";
import type { DatasetFile } from "./schema";
import { checkDataset, datasetMatches, driftMessage } from "./verify-dataset";

export interface RunEnv {
  runId: string;
  /** Repo-relative DB path (DATABASE_URL). */
  dbPath: string;
  /** Where the variance report goes. */
  outDir: string;
}

const log = (line: string) => console.log(line);

async function fetchVerifiedItems(client: LangfuseClient, args: RunArgs, dataset: DatasetFile) {
  const version = args.datasetVersion ?? new Date().toISOString();
  const fetched = await client.dataset.get(args.dataset, { version });
  const check = checkDataset(dataset, fetched.items);
  if (args.datasetVersion) {
    log(`dataset ${args.dataset} pinned to ${version} (--dataset-version: local YAML check skipped)`);
  } else if (!datasetMatches(check)) {
    throw new RunAbort(driftMessage(args.dataset, check));
  }
  const active = fetched.items.filter((i) => i.status !== "ARCHIVED");
  let items: FetchedItem[] = active;
  if (args.items) {
    const unknown = args.items.filter((id) => !active.some((i) => i.id === id));
    if (unknown.length) throw new RunAbort(`unknown item id(s) for ${args.dataset}: ${unknown.join(", ")}`);
    items = active.filter((i) => args.items!.includes(i.id));
  }
  log(`dataset ${args.dataset} @ ${version}: ${active.length} active item(s), dataset_hash ${check.datasetHash.slice(0, 12)}; running ${items.length}`);
  return { version, items, datasetHash: check.datasetHash };
}

/** Boots tools like the server, waits for the embedding sync, and checks search works. */
async function bootTools(boot: ToolsBoot): Promise<SearchState> {
  await boot.ready;
  await boot.embeddingSync?.idle();
  const { search, probeHits } = await assertSearchReady(toolsReport(boot.embedder), (q) => hybridSearch.search(q));
  log(`tools: ${search.tools_available} available, search ${search.search_mode}${search.embedder ? ` (${search.embedder})` : ""}; probe "${PROBE_QUERY}" → ${probeHits} hit(s)`);
  return search;
}

export async function runEval(args: RunArgs, env: RunEnv): Promise<number> {
  let tools: ToolsBoot | null = null;
  const lifecycle = new RunLifecycle({
    shutdownTracing: () => shutdownTracing(),
    stopMcp: () => mcpManager.stopAll(),
    stopBackground: () => tools?.embeddingSync?.stop(),
  });
  const removeHandlers = lifecycle.installSignalHandlers();
  try {
    runMigrations(sqlite);
    const userId = randomUUID();
    userQueries.create(userId, `eval-runner-${env.runId}`, "eval-runner@localhost", "eval-runner", null, "user", null, null);
    log(`run ${env.runId}: db ${env.dbPath}`);

    if (!initTracing({ registerGlobal: true })) {
      throw new RunAbort("Langfuse tracing is off: set LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY (app/.env) and observability.langfuse.enabled");
    }
    const client = getScoreClient()!;
    const llm = loadLLMConfig();
    assertPricingConfigured(llm.provider, llm.chatModel);

    const home = loadEvalHome();
    const loaded = home.datasets.find((d) => d.dataset.name === args.dataset);
    if (!loaded) throw new RunAbort(`unknown dataset "${args.dataset}" (have: ${home.datasets.map((d) => d.dataset.name).join(", ")})`);
    const dataset = loaded.dataset;
    const pinned = await fetchVerifiedItems(client, args, dataset);
    if (pinned.items.length === 0) throw new RunAbort("no items to run");

    tools = initializeTools();
    const search = await bootTools(tools);
    await scoreConfigsReady();

    const concurrency = args.concurrency ?? dataset.run_defaults?.concurrency ?? DEFAULT_CONCURRENCY;
    const maxCostUsd = args.maxCostUsd ?? dataset.run_defaults?.max_cost_usd ?? DEFAULT_MAX_COST_USD;
    const budget = SharedCostBudget.usd(maxCostUsd);
    const git = gitState();
    const repeatGroup = randomUUID();
    const rubrics = home.metrics.flatMap((m) => (m.status === "active" && m.rubric ? [m.rubric] : []));
    const localItems = new Map(dataset.items.map((i) => [i.id, i]));
    const outcomes: ExperimentOutcome[] = [];
    log(`model ${llm.chatModel} (effort ${llm.effort}), concurrency ${concurrency}, budget $${maxCostUsd} (overshoot ≤ ~1 call per concurrent item)`);

    for (let r = 1; r <= args.repeat; r++) {
      if (lifecycle.stopping) break;
      if (budget.exhausted) {
        log(`budget exhausted: skipping repeat(s) ${r}..${args.repeat}`);
        break;
      }
      const name = experimentName({ dataset: args.dataset, gitSha: git.sha, model: llm.chatModel, note: args.note, repeatIndex: r, repeatCount: args.repeat });
      log(`\n▶ ${name}`);
      const outcome = await runExperiment(client, {
        name,
        description: `${dataset.description} (run ${env.runId})`,
        metadata: runMetadata({
          model: llm.chatModel,
          provider: llm.provider,
          effort: llm.effort,
          contextVersion: contextVersion(SYSTEM_PROMPT, chatProviderOptions(llm)),
          git,
          datasetName: args.dataset,
          datasetVersion: pinned.version,
          datasetHash: pinned.datasetHash,
          datasetVersionPinned: args.datasetVersion !== null,
          scoring: scoringHashes(rubrics),
          search,
          runId: env.runId,
          repeatGroup,
          repeatIndex: r,
          repeatCount: args.repeat,
          maxCostUsd,
          concurrency,
          items: args.items,
        }),
        items: pinned.items,
        localItems,
        datasetVersion: pinned.version,
        concurrency,
        task: { userId, provider: llm.provider, budget, lifecycle, log },
      });
      outcomes.push(outcome);
      printOutcome(outcome, log);
    }
    log(`\nspent $${budget.spentUsd.toFixed(4)} of $${maxCostUsd}`);

    if (args.repeat > 1 && outcomes.length > 1) {
      const path = `${env.outDir}/${repeatGroup}.json`;
      const report = varianceReport(outcomes.map((o) => o.itemRuns));
      await Bun.write(path, `${JSON.stringify({ repeat_group: repeatGroup, run_id: env.runId, experiments: outcomes.map((o) => o.runName), items: report }, null, 2)}\n`);
      printVariance(report, log);
      log(`variance report: ${path}`);
    }
    if (lifecycle.signalExitCode !== null) return lifecycle.signalExitCode;
    return outcomes.some((o) => o.missing.length > 0) ? 1 : 0;
  } catch (error) {
    if (lifecycle.signalExitCode !== null) return lifecycle.signalExitCode;
    console.error(error instanceof RunAbort ? `eval aborted: ${error.message}` : error);
    return 1;
  } finally {
    await lifecycle.cleanup();
    removeHandlers();
  }
}

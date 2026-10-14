import { randomUUID } from "node:crypto";
import type { LangfuseClient } from "@langfuse/client";
import { initializeTools, toolsReport, type ToolsBoot } from "../../server/boot/tools";
import { runMigrations, userQueries } from "../../server/db";
import { resolveDbPath } from "../../server/db/paths";
import { chatProviderOptions, effectiveLLMConfig, type LLMConfig } from "../../server/llm";
import { mcpManager } from "../../server/mcp/manager";
import { getScoreClient, initTracing, scoreConfigsReady, shutdownTracing } from "../../server/observability/langfuse";
import { contextVersion } from "../../server/orchestration/context/transcript";
import { SYSTEM_PROMPT } from "../../server/orchestration/context/system-prompt";
import { SharedCostBudget } from "../../server/orchestration/cost-budget";
import { hybridSearch } from "../../server/search";
import { DEFAULT_CONCURRENCY, DEFAULT_MAX_COST_USD, type RunArgs } from "./args";
import { varianceReport } from "./aggregate";
import { armEstimates, prepareArms } from "./arm-setup";
import type { ResolvedArm } from "./arms";
import { buildComparison, saveItemRun, type SavedComparison } from "./compare";
import { comparisonMarkdown, printComparison } from "./compare-render";
import { runArms, type ArmRunResult } from "./matrix";
import { runExperiment, type ExperimentOutcome, type FetchedItem } from "./experiment";
import type { RunDependencies } from "./bootstrap";
import { RunLifecycle } from "./lifecycle";
import { loadEvalHome } from "./load";
import { pinnedEvalItems, PinnedItemError } from "./pinned-items";
import { printOutcome, printVariance } from "./report";
import { assertSearchReady, PROBE_QUERY, RunAbort } from "./search-check";
import { experimentName, gitState, runMetadata, scoringHashes, type SearchState } from "./run-meta";
import type { DatasetFile } from "./schema";
import { checkDataset, datasetMatches, driftMessage } from "./verify-dataset";

export interface RunEnv {
  runId: string;
  dbPath: string;
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
  let evalItems;
  try {
    evalItems = pinnedEvalItems(items);
  } catch (error) {
    if (error instanceof PinnedItemError) throw new RunAbort(`${args.dataset} @ ${version}: ${error.message}`);
    throw error;
  }
  log(`dataset ${args.dataset} @ ${version}: ${active.length} active item(s), dataset_hash ${check.datasetHash.slice(0, 12)}; running ${items.length}`);
  return { version, items, evalItems, datasetHash: check.datasetHash };
}

async function bootTools(boot: ToolsBoot): Promise<SearchState> {
  await boot.ready;
  await boot.embeddingSync?.idle();
  const { search, probeHits } = await assertSearchReady(toolsReport(boot.embedder), (q) => hybridSearch.search(q));
  log(`tools: ${search.tools_available} available, search ${search.search_mode}${search.embedder ? ` (${search.embedder})` : ""}; probe "${PROBE_QUERY}" → ${probeHits} hit(s)`);
  return search;
}

function armContextVersion(arm: ResolvedArm, config: LLMConfig): string {
  return contextVersion(SYSTEM_PROMPT, chatProviderOptions(effectiveLLMConfig(config, arm.override)));
}

async function writeVariance(outDir: string, runId: string, arm: ResolvedArm, repeatGroup: string, outcomes: ExperimentOutcome[]): Promise<void> {
  const path = `${outDir}/${repeatGroup}.json`;
  const report = varianceReport(outcomes.map((o) => o.itemRuns));
  await Bun.write(path, `${JSON.stringify({ repeat_group: repeatGroup, run_id: runId, arm: arm.label, experiments: outcomes.map((o) => o.runName), items: report }, null, 2)}\n`);
  printVariance(report, log);
  log(`variance report (${arm.label}): ${path}`);
}

export async function runEval(args: RunArgs, env: RunEnv, deps: RunDependencies): Promise<number> {
  let tools: ToolsBoot | null = null;
  const lifecycle = new RunLifecycle({
    shutdownTracing: () => shutdownTracing(),
    stopMcp: () => mcpManager.stopAll(),
    stopBackground: () => tools?.embeddingSync?.stop(),
  });
  const removeHandlers = lifecycle.installSignalHandlers();
  try {
    if (deps.dbPath !== resolveDbPath(env.dbPath)) throw new RunAbort("initialized database does not match RunEnv.dbPath");
    const { config, sqlite } = deps;
    const { arms, comparing } = await prepareArms(args, config, {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
    });

    runMigrations(sqlite);
    const userId = randomUUID();
    userQueries.create(userId, `eval-runner-${env.runId}`, "eval-runner@localhost", "eval-runner", null, "user", null, null);
    log(`run ${env.runId}: db ${env.dbPath}`);

    if (!initTracing({ registerGlobal: true })) {
      throw new RunAbort("Langfuse tracing is off: set LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY (app/.env) and observability.langfuse.enabled");
    }
    const client = getScoreClient()!;

    const home = loadEvalHome();
    const loaded = home.datasets.find((d) => d.dataset.name === args.dataset);
    if (!loaded) throw new RunAbort(`unknown dataset "${args.dataset}" (have: ${home.datasets.map((d) => d.dataset.name).join(", ")})`);
    const dataset = loaded.dataset;
    const pinned = await fetchVerifiedItems(client, args, dataset);
    if (pinned.items.length === 0) throw new RunAbort("no items to run");

    const concurrency = args.concurrency ?? dataset.run_defaults?.concurrency ?? DEFAULT_CONCURRENCY;
    const maxCostUsd = args.maxCostUsd ?? dataset.run_defaults?.max_cost_usd ?? DEFAULT_MAX_COST_USD;
    const estimates = armEstimates(arms, pinned.items.map((i) => ({ turns: (i.input as { turns?: unknown[] } | undefined)?.turns?.length ?? 1 })), args.repeat);
    log(`budget $${maxCostUsd} shared by ${arms.length} arm(s) × ${args.repeat} repeat(s) (overshoot ≤ ~1 call per concurrent item), concurrency ${concurrency}`);
    arms.forEach((arm, i) => {
      log(`  arm ${arm.label}: max_output_tokens ${arm.maxOutputTokens} (${arm.maxOutputTokensSource}), max_context_tokens ${arm.maxContextTokens}; rough estimate $${estimates[i]!.totalUsd.toFixed(2)} ($${estimates[i]!.perItemUsd.toFixed(3)}/item)`);
    });
    const estimatedTotal = estimates.reduce((s, e) => s + e.totalUsd, 0);
    if (estimatedTotal > maxCostUsd) log(`  note: rough estimate $${estimatedTotal.toFixed(2)} exceeds the budget; later arms may be skipped_budget`);

    tools = initializeTools();
    const search = await bootTools(tools);
    await scoreConfigsReady();

    const budget = SharedCostBudget.usd(maxCostUsd);
    const git = gitState();
    const comparisonGroup = randomUUID();
    const rubrics = home.metrics.flatMap((m) => (m.status === "active" && m.rubric ? [m.rubric] : []));
    const repeatGroups = new Map(arms.map((arm) => [arm, randomUUID()]));
    if (comparing) log(`comparison_group ${comparisonGroup}`);

    const results: ArmRunResult<ResolvedArm, ExperimentOutcome>[] = await runArms({
      arms,
      repeat: args.repeat,
      shared: { datasetVersion: pinned.version, budget },
      isStopping: () => lifecycle.stopping,
      interruption: (o) => {
        if (o.missing.length) return lifecycle.stopping ? "stopped" : "failed";
        return o.itemRuns.some((i) => i.output.skipped === "budget") ? "budget" : null;
      },
      log,
      runOne: async (arm, r, shared) => {
        const name = experimentName({ dataset: args.dataset, gitSha: git.sha, model: arm.model, effort: arm.effort, armNote: arm.note, note: args.note, repeatIndex: r, repeatCount: args.repeat });
        log(`\n▶ ${name}`);
        const outcome = await runExperiment(client, {
          name,
          description: `${dataset.description} (run ${env.runId})`,
          metadata: runMetadata({
            model: arm.model,
            provider: arm.provider,
            effort: arm.effort,
            thinkingDisplay: arm.thinkingDisplay,
            maxOutputTokens: arm.maxOutputTokens,
            maxOutputTokensSource: arm.maxOutputTokensSource,
            maxContextTokens: arm.maxContextTokens,
            comparisonGroup,
            arm: arm.label,
            armIndex: arms.indexOf(arm) + 1,
            armCount: arms.length,
            contextVersion: armContextVersion(arm, config),
            git,
            datasetName: args.dataset,
            datasetVersion: shared.datasetVersion,
            datasetHash: pinned.datasetHash,
            datasetVersionPinned: args.datasetVersion !== null,
            scoring: scoringHashes(rubrics),
            search,
            runId: env.runId,
            repeatGroup: repeatGroups.get(arm)!,
            repeatIndex: r,
            repeatCount: args.repeat,
            maxCostUsd,
            concurrency,
            items: args.items,
          }),
          items: pinned.items,
          evalItems: pinned.evalItems,
          datasetVersion: shared.datasetVersion,
          concurrency,
          task: { userId, provider: arm.provider, llm: arm.override ?? { model: config.chatModel, effort: config.effort, max_output_tokens: config.maxOutputTokens }, budget: shared.budget, lifecycle, log },
        });
        printOutcome(outcome, log);
        return outcome;
      },
    });
    log(`\nspent $${budget.spentUsd.toFixed(4)} of $${maxCostUsd}`);

    for (const { arm, outcomes } of results) {
      if (args.repeat > 1 && outcomes.length > 1) await writeVariance(env.outDir, env.runId, arm, repeatGroups.get(arm)!, outcomes);
    }
    if (comparing) {
      const saved: SavedComparison = {
        comparison_group: comparisonGroup,
        run_id: env.runId,
        dataset: args.dataset,
        dataset_version: pinned.version,
        git_sha: git.sha,
        repeat: args.repeat,
        max_cost_usd: maxCostUsd,
        spent_usd: budget.spentUsd,
        arms: results.map(({ arm, status, outcomes }, i) => ({
          label: arm.label,
          provider: arm.provider,
          model: arm.model,
          effort: arm.effort,
          max_output_tokens: arm.maxOutputTokens,
          max_context_tokens: arm.maxContextTokens,
          status,
          estimate_usd: Number(estimates[i]!.totalUsd.toFixed(4)),
          experiments: outcomes.map((o, r) => ({ name: o.name, run_name: o.runName, url: o.datasetRunUrl ?? null, repeat_index: r + 1, items: o.itemRuns.map(saveItemRun), missing: [...o.missing].sort() })),
        })),
      };
      const report = buildComparison(saved);
      const base = `${env.outDir}/${comparisonGroup}`;
      await Bun.write(`${base}.json`, `${JSON.stringify({ report, runs: saved }, null, 2)}\n`);
      await Bun.write(`${base}.md`, comparisonMarkdown(report));
      printComparison(report, log);
      log(`comparison report: ${base}.{json,md}`);
    }
    if (lifecycle.signalExitCode !== null) return lifecycle.signalExitCode;
    return results.some((r) => r.outcomes.some((o) => o.missing.length > 0)) ? 1 : 0;
  } catch (error) {
    if (lifecycle.signalExitCode !== null) return lifecycle.signalExitCode;
    console.error(error instanceof RunAbort ? `eval aborted: ${error.message}` : error);
    return 1;
  } finally {
    try {
      await lifecycle.cleanup();
    } finally {
      removeHandlers();
    }
  }
}

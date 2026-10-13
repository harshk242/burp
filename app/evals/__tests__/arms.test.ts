/**
 * Comparison arms (plan 2.4): `--arm` / `--matrix` parsing, matrix files, the
 * Models API capability check (stubbed fetch), the preflight order (pricing and
 * capabilities fail before any spend), the per-arm estimate and the sequential
 * arm loop sharing one dataset version and one budget.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLLMConfig } from "../../server/llm";
import { ArgsError, parseRunArgs } from "../lib/args";
import { armEstimates, prepareArms } from "../lib/arm-setup";
import { ArmsError, combineArms, configArm, DEFAULT_ARM_MAX_OUTPUT_TOKENS, EFFORT_LEVELS, loadMatrix, matrixNames, parseArmFlag, resolveArm } from "../lib/arms";
import { armProblems, CapabilityError, checkCapabilities, type ModelInfo } from "../lib/capabilities";
import { runArms } from "../lib/matrix";
import { RunAbort } from "../lib/search-check";

const config = loadLLMConfig();

/** A Models API model object: adaptive thinking and the given effort levels. */
function modelInfo(id: string, levels: readonly string[] = EFFORT_LEVELS, adaptive = true): ModelInfo {
  return {
    id,
    max_input_tokens: 1_000_000,
    max_tokens: 128_000,
    capabilities: {
      thinking: { types: { adaptive: { supported: adaptive } } },
      effort: { supported: true, ...Object.fromEntries(EFFORT_LEVELS.map((l) => [l, { supported: levels.includes(l) }])) },
    },
  };
}

/** Stub Models API: known models by id, 404 otherwise; records requested URLs and headers. */
function modelsApi(models: ModelInfo[]) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, headers: init?.headers as Record<string, string> });
    const id = decodeURIComponent(url.split("/").pop()!);
    const found = models.find((m) => m.id === id);
    return found
      ? new Response(JSON.stringify(found), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ type: "error", error: { type: "not_found_error" } }), { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests, opts: { apiKey: "test-key", baseUrl: "https://models.test/v1", fetch } };
}

const tmp = mkdtempSync(join(tmpdir(), "eval-matrix-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("--arm / --matrix parsing", () => {
  it("parses <model>:<effort>[:<max_output_tokens>], repeatable, after the matrix", () => {
    const args = parseRunArgs(["--dataset", "smoke", "--matrix", "sonnet-effort", "--arm", "claude-sonnet-5-5:high", "--arm=claude-haiku-5-5:low:32000"])!;
    expect(args.matrix).toBe("sonnet-effort");
    expect(args.arms).toEqual([
      { model: "claude-sonnet-5-5", effort: "high" },
      { model: "claude-haiku-5-5", effort: "low", max_output_tokens: 32000 },
    ]);
    expect(parseRunArgs(["--dataset", "smoke"])!.arms).toEqual([]);
  });

  it("bad model, level or shape fail with a clear message", () => {
    expect(() => parseRunArgs(["--dataset", "smoke", "--arm", "claude-sonnet-5-5:extreme"])).toThrow('effort must be one of low, medium, high, xhigh, max, got "extreme"');
    expect(() => parseRunArgs(["--dataset", "smoke", "--arm", "Claude Sonnet:high"])).toThrow("is not a model id");
    expect(() => parseRunArgs(["--dataset", "smoke", "--arm", "claude-sonnet-5-5"])).toThrow(ArgsError);
    expect(() => parseArmFlag("claude-sonnet-5-5:high:0")).toThrow("max_output_tokens must be a positive integer");
    expect(() => parseRunArgs(["--dataset", "smoke", "--matrix", "../x"])).toThrow("matrix name");
  });

  it("two arms with the same model and effort are rejected (experiment names would collide)", () => {
    const arm = { model: "claude-sonnet-5-5", effort: "high" } as const;
    expect(() => combineArms([arm], [arm])).toThrow(ArmsError);
    expect(combineArms([arm], [{ ...arm, note: "out32k", max_output_tokens: 32000 }])).toHaveLength(2);
  });
});

describe("matrix files", () => {
  it("the tracked matrices load", () => {
    expect(matrixNames()).toEqual(expect.arrayContaining(["haiku-effort", "models-high", "sonnet-effort"]));
    expect(loadMatrix("sonnet-effort").map((a) => a.effort)).toEqual([...EFFORT_LEVELS]);
    expect(loadMatrix("models-high").map((a) => a.model)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"]);
  });

  it("an unknown matrix lists the ones there are", () => {
    expect(() => loadMatrix("nope")).toThrow(/unknown matrix "nope" \(have: .*sonnet-effort/);
  });

  it("a bad arm is reported with file:line", () => {
    writeFileSync(join(tmp, "bad.yaml"), "arms:\n  - { model: claude-sonnet-5-5, effort: high }\n  - { model: claude-sonnet-5-5, effort: turbo }\n");
    expect(() => loadMatrix("bad", tmp)).toThrow(/bad\.yaml:3:\d+: arms\.1\.effort/);
  });
});

describe("arm resolution", () => {
  it("no override for the config arm; arms get the raised default, capped at the model limit", () => {
    expect(configArm(config)).toMatchObject({ model: config.chatModel, maxOutputTokens: config.maxOutputTokens, maxOutputTokensSource: "config" });
    expect(configArm(config).override).toBeUndefined();
    const arm = resolveArm({ model: "claude-haiku-5-5", effort: "max" }, config, 128_000);
    expect(arm.override).toEqual({ model: "claude-haiku-5-5", effort: "max", max_output_tokens: DEFAULT_ARM_MAX_OUTPUT_TOKENS });
    expect(DEFAULT_ARM_MAX_OUTPUT_TOKENS).toBeGreaterThan(config.maxOutputTokens);
    expect(resolveArm({ model: "m", effort: "low" }, config, 8_000).maxOutputTokens).toBe(8_000);
    expect(resolveArm({ model: "m", effort: "low", max_output_tokens: 20_000 }, config, 128_000)).toMatchObject({ maxOutputTokens: 20_000, maxOutputTokensSource: "arm" });
    // History budget never differs between arms.
    expect(arm.maxContextTokens).toBe(config.maxContextTokens);
  });
});

describe("capability check (Models API)", () => {
  it("passes known models with the level; one request per model with the API headers", async () => {
    const api = modelsApi([modelInfo("claude-sonnet-5-5")]);
    const infos = await checkCapabilities([{ model: "claude-sonnet-5-5", effort: "low" }, { model: "claude-sonnet-5-5", effort: "max" }], 180_000, api.opts);
    expect(infos.get("claude-sonnet-5-5")?.max_tokens).toBe(128_000);
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]!.url).toBe("https://models.test/v1/models/claude-sonnet-5-5");
    expect(api.requests[0]!.headers).toMatchObject({ "x-api-key": "test-key", "anthropic-version": "2023-06-01" });
  });

  it("unknown model and unsupported effort fail, listing every problem", async () => {
    const api = modelsApi([modelInfo("claude-haiku-5-5", ["low", "medium", "high"])]);
    const run = checkCapabilities([{ model: "claude-nope-9", effort: "high" }, { model: "claude-haiku-5-5", effort: "xhigh" }], 180_000, api.opts);
    await expect(run).rejects.toThrow(CapabilityError);
    await expect(run).rejects.toThrow(/claude-nope-9: unknown model \(Models API 404\)[\s\S]*claude-haiku-5-5:xhigh: model does not support effort level "xhigh"/);
  });

  it("no adaptive thinking, too small a context window or too much output fail", () => {
    const info = { ...modelInfo("m", EFFORT_LEVELS, false), max_input_tokens: 100_000 };
    expect(armProblems({ model: "m", effort: "high", max_output_tokens: 200_000 }, info, 180_000)).toEqual([
      "m:high: model does not support adaptive thinking",
      "m:high: context window 100000 is below max_context_tokens 180000",
      "m:high: max_output_tokens 200000 exceeds the model's limit 128000",
    ]);
    expect(armProblems({ model: "m", effort: "high" }, { id: "m", capabilities: { thinking: { types: { adaptive: { supported: true } } } } }, 1)).toEqual([
      "m:high: model does not support effort",
    ]);
  });

  it("no API key fails before any request", async () => {
    const api = modelsApi([]);
    await expect(checkCapabilities([{ model: "claude-sonnet-5-5", effort: "high" }], 1, { ...api.opts, apiKey: undefined })).rejects.toThrow("ANTHROPIC_API_KEY");
    expect(api.requests).toHaveLength(0);
  });
});

describe("preflight (before any spend)", () => {
  const all = modelsApi(["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"].map((id) => modelInfo(id)));

  it("missing pricing fails before the Models API is called", async () => {
    const api = modelsApi([modelInfo("claude-unpriced-1")]);
    const run = prepareArms({ matrix: null, arms: [{ model: "claude-unpriced-1", effort: "high" }] }, config, api.opts);
    await expect(run).rejects.toThrow(RunAbort);
    await expect(run).rejects.toThrow("no pricing for anthropic/claude-unpriced-1");
    expect(api.requests).toHaveLength(0);
  });

  it("an unknown model or level aborts the run", async () => {
    const api = modelsApi([modelInfo("claude-sonnet-5-5", ["low"])]);
    await expect(prepareArms({ matrix: null, arms: [{ model: "claude-sonnet-5-5", effort: "max" }] }, config, api.opts)).rejects.toThrow(/does not support effort level "max"/);
    await expect(prepareArms({ matrix: "nope", arms: [] }, config, api.opts)).rejects.toThrow(/unknown matrix/);
  });

  it("no arm = the production config, no Models API call", async () => {
    const api = modelsApi([]);
    const prepared = await prepareArms({ matrix: null, arms: [] }, config, api.opts);
    expect(prepared.comparing).toBe(false);
    expect(prepared.arms).toEqual([configArm(config)]);
    expect(api.requests).toHaveLength(0);
  });

  it("a matrix resolves every arm (Opus 5.5 priced)", async () => {
    const prepared = await prepareArms({ matrix: "models-high", arms: [{ model: "claude-sonnet-5-5", effort: "low" }] }, config, all.opts);
    expect(prepared.comparing).toBe(true);
    expect(prepared.arms.map((a) => a.label)).toEqual(["claude-sonnet-5-5-high", "claude-haiku-5-5-high", "claude-opus-5-5-high", "claude-sonnet-5-5-low"]);
  });
});

describe("per-arm estimate", () => {
  it("scales with dataset size and repeats, grows with effort and model price", async () => {
    const arms = (await prepareArms({ matrix: "sonnet-effort", arms: [{ model: "claude-opus-5-5", effort: "max" }] }, config, modelsApi(["claude-sonnet-5-5", "claude-opus-5-5"].map((id) => modelInfo(id))).opts)).arms;
    const one = armEstimates(arms, [{ turns: 1 }, { turns: 2 }], 1);
    const two = armEstimates(arms, [{ turns: 1 }, { turns: 2 }], 2);
    expect(two[0]!.totalUsd).toBeCloseTo(one[0]!.totalUsd * 2, 10);
    expect(one[0]!.perItemUsd).toBeCloseTo(one[0]!.totalUsd / 2, 10);
    const sonnet = one.slice(0, 5).map((e) => e.totalUsd);
    expect([...sonnet].sort((a, b) => a - b)).toEqual(sonnet);
    expect(one[5]!.totalUsd).toBeGreaterThan(one[4]!.totalUsd);
  });
});

describe("arm loop", () => {
  /** Budget that runs out after `limit` charges. */
  const budget = (limit: number) => ({ spent: 0, get exhausted() { return this.spent >= limit; } });

  it("arms run sequentially on one dataset version and one budget, each repeated", async () => {
    const b = budget(Infinity);
    const seen: { arm: string; r: number; shared: unknown }[] = [];
    let running = 0;
    const results = await runArms({
      arms: ["a", "b", "c"],
      repeat: 2,
      shared: { datasetVersion: "2026-10-12T00:00:00.000Z", budget: b },
      isStopping: () => false,
      interruption: () => null,
      runOne: async (arm, r, shared) => {
        expect(++running).toBe(1);
        await Bun.sleep(1);
        running--;
        seen.push({ arm, r, shared });
        return `${arm}${r}`;
      },
    });
    expect(seen.map((s) => `${s.arm}${s.r}`)).toEqual(["a1", "a2", "b1", "b2", "c1", "c2"]);
    expect(new Set(seen.map((s) => s.shared)).size).toBe(1);
    expect((seen[0]!.shared as { budget: unknown }).budget).toBe(b);
    expect(results.map((r) => r.status)).toEqual(["complete", "complete", "complete"]);
  });

  it("hitting the budget mid-matrix: the rest of the arm and the remaining arms are skipped_budget", async () => {
    const b = budget(3);
    const results = await runArms({
      arms: ["a", "b", "c"],
      repeat: 2,
      shared: { datasetVersion: "v", budget: b },
      isStopping: () => false,
      interruption: () => null,
      runOne: async (arm, r) => {
        b.spent++;
        return `${arm}${r}`;
      },
    });
    expect(results.map((r) => [r.arm, r.status, r.outcomes])).toEqual([
      ["a", "complete", ["a1", "a2"]],
      ["b", "partial_budget", ["b1"]],
      ["c", "skipped_budget", []],
    ]);
  });

  it("a stopped run starts nothing more", async () => {
    let stopping = false;
    const results = await runArms({
      arms: ["a", "b"],
      repeat: 1,
      shared: { datasetVersion: "v", budget: budget(Infinity) },
      isStopping: () => stopping,
      interruption: () => null,
      runOne: async (arm) => {
        stopping = true;
        return arm;
      },
    });
    expect(results.map((r) => r.status)).toEqual(["complete", "stopped"]);
  });

  /** Outcome of one repeat: which items ran, were budget-skipped, or never produced a result. */
  type Repeat = { label: string; skipped: number; missing: number };
  const cutBy = (o: Repeat) => (o.missing ? "stopped" : o.skipped ? "budget" : null);

  it("budget exhausted inside an arm's experiment: the arm is partial_budget, not complete", async () => {
    // 3 items per repeat, budget of 2 item charges: arm a's first repeat skips its last item.
    const b = budget(2);
    const log: string[] = [];
    const results = await runArms<string, Repeat, typeof b>({
      arms: ["a", "b"],
      repeat: 2,
      shared: { datasetVersion: "v", budget: b },
      isStopping: () => false,
      interruption: cutBy,
      log: (line) => log.push(line),
      runOne: async (arm, r) => {
        let skipped = 0;
        for (let i = 0; i < 3; i++) b.exhausted ? skipped++ : b.spent++;
        return { label: `${arm}${r}`, skipped, missing: 0 };
      },
    });
    expect(results.map((r) => [r.arm, r.status, r.outcomes.map((o) => o.label)])).toEqual([
      ["a", "partial_budget", ["a1"]],
      ["b", "skipped_budget", []],
    ]);
    expect(log).toContain("budget exhausted: skipping repeat(s) 2..2");
  });

  it("a budget cut in the last repeat still marks the arm partial_budget", async () => {
    const b = budget(5);
    const results = await runArms<string, Repeat, typeof b>({
      arms: ["a"],
      repeat: 2,
      shared: { datasetVersion: "v", budget: b },
      isStopping: () => false,
      interruption: cutBy,
      runOne: async (arm, r) => {
        let skipped = 0;
        for (let i = 0; i < 3; i++) b.exhausted ? skipped++ : b.spent++;
        return { label: `${arm}${r}`, skipped, missing: 0 };
      },
    });
    expect(results.map((r) => [r.status, r.outcomes.map((o) => o.skipped)])).toEqual([["partial_budget", [0, 1]]]);
  });

  it("items left unrun by a stop make the arm stopped; failed items make it incomplete but later repeats still run", async () => {
    const stopped = await runArms<string, Repeat, ReturnType<typeof budget>>({
      arms: ["a", "b"],
      repeat: 2,
      shared: { datasetVersion: "v", budget: budget(Infinity) },
      isStopping: () => false,
      interruption: cutBy,
      runOne: async (arm, r) => ({ label: `${arm}${r}`, skipped: 0, missing: arm === "a" ? 1 : 0 }),
    });
    expect(stopped.map((r) => [r.arm, r.status, r.outcomes.length])).toEqual([
      ["a", "stopped", 1],
      ["b", "complete", 2],
    ]);
    const failed = await runArms<string, Repeat, ReturnType<typeof budget>>({
      arms: ["a"],
      repeat: 2,
      shared: { datasetVersion: "v", budget: budget(Infinity) },
      isStopping: () => false,
      interruption: (o) => (o.missing ? "failed" : null),
      runOne: async (arm, r) => ({ label: `${arm}${r}`, skipped: 0, missing: r === 1 ? 1 : 0 }),
    });
    expect(failed.map((r) => [r.status, r.outcomes.length])).toEqual([["incomplete", 2]]);
  });
});

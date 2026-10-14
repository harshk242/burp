import { afterEach, expect, it, spyOn } from "bun:test";
import { loadScoreConfigIds, resetScoreConfigIdsForTests, scoreConfigId, type ScoreConfigSource } from "../score-configs";

afterEach(resetScoreConfigIdsForTests);
it("publishes all pages atomically and retries failed loads after backoff", async () => {
  resetScoreConfigIdsForTests();
  let attempts = 0;
  let fail = true;
  const source: ScoreConfigSource = { api: { scoreConfigs: { async get({ page }) {
    attempts++;
    if (page === 2 && fail) throw new Error("unavailable");
    return { data: [{ id: `id-${page}`, name: `name-${page}`, isArchived: false }], meta: { totalPages: 2 } };
  } } } };
  const time = spyOn(Date, "now").mockReturnValue(1000);
  try {
    await loadScoreConfigIds(source, 1000);
    expect(attempts).toBe(2);
    expect(scoreConfigId("name-1")).toBeUndefined();
    await loadScoreConfigIds(source, 1500);
    expect(attempts).toBe(2);
    fail = false;
    const first = loadScoreConfigIds(source, 2000);
    expect(loadScoreConfigIds(source, 2000)).toBe(first);
    expect(scoreConfigId("name-1")).toBeUndefined();
    await first;
    expect(attempts).toBe(4);
    expect(scoreConfigId("name-1")).toBe("id-1");
    expect(scoreConfigId("name-2")).toBe("id-2");
    await loadScoreConfigIds(source, 10_000);
    expect(attempts).toBe(4);
  } finally { time.mockRestore(); }
});

it("lookups trigger one non-blocking reload after startup failure and backoff", async () => {
  resetScoreConfigIdsForTests();
  const time = spyOn(Date, "now").mockReturnValue(1000);
  let attempts = 0;
  let finish!: (page: { data: { id: string; name: string; isArchived: boolean }[]; meta: { totalPages: number } }) => void;
  const source: ScoreConfigSource = { api: { scoreConfigs: { get() {
    attempts++;
    if (attempts === 1) return Promise.reject(new Error("startup unavailable"));
    return new Promise((resolve) => { finish = resolve; });
  } } } };
  try {
    await loadScoreConfigIds(source);
    time.mockReturnValue(1999);
    expect(scoreConfigId("feedback")).toBeUndefined();
    expect(attempts).toBe(1);
    time.mockReturnValue(2000);
    expect(scoreConfigId("feedback")).toBeUndefined();
    expect(scoreConfigId("feedback")).toBeUndefined();
    expect(attempts).toBe(2);
    finish({ data: [{ id: "config", name: "feedback", isArchived: false }], meta: { totalPages: 1 } });
    await loadScoreConfigIds(source);
    expect(scoreConfigId("feedback")).toBe("config");
    expect(attempts).toBe(2);
  } finally { time.mockRestore(); }
});

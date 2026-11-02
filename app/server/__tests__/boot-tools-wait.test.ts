import { describe, expect, it } from "bun:test";
import { settlesWithin, waitForTools } from "../boot/tools";

describe("settlesWithin", () => {
  it("is true when the work resolves in time", async () => {
    expect(await settlesWithin(Bun.sleep(5), 1000)).toBe(true);
  });

  it("is true when the work rejects in time", async () => {
    expect(await settlesWithin(Promise.reject(new Error("boom")), 1000)).toBe(true);
  });

  it("is false on timeout", async () => {
    expect(await settlesWithin(new Promise(() => {}), 10)).toBe(false);
  });

  it("is false when the signal aborts", async () => {
    const abort = new AbortController();
    const waiting = settlesWithin(new Promise(() => {}), 10_000, abort.signal);
    abort.abort();
    expect(await waiting).toBe(false);
  });

  it("is false for an already-aborted signal", async () => {
    expect(await settlesWithin(new Promise(() => {}), 10_000, AbortSignal.abort())).toBe(false);
  });
});

describe("waitForTools", () => {
  it("does not block when tool boot never started", async () => {
    expect(await waitForTools(10)).toBe(true);
  });
});

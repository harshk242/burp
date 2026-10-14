import { describe, expect, it, spyOn } from "bun:test";
import childProcess, { type ChildProcess } from "node:child_process";
import { executeJq, parseJqOutput, validateJqFilter } from "../orchestration/tools/jq-engine";

const data = {
  studies: [
    { nctId: "NCT1", title: 'A "quoted" title' },
    { nctId: "NCT2", title: "B" },
    { nctId: "NCT3", title: "C" },
  ],
};

describe("executeJq", () => {
  it("returns a single value as-is", async () => {
    const r = await executeJq(data, ".studies[0]");
    expect(r).toEqual({ result: data.studies[0], truncated: false });
  });

  it("returns a stream of values as an array", async () => {
    const r = await executeJq(data, ".studies[] | {nctId}");
    expect(r.result).toEqual([
      { nctId: "NCT1" },
      { nctId: "NCT2" },
      { nctId: "NCT3" },
    ]);
    expect(r.truncated).toBe(false);
  });

  it("returns an empty array when the filter emits nothing", async () => {
    const r = await executeJq(data, '.studies[] | select(.nctId == "X")');
    expect(r).toEqual({ result: [], truncated: false });
  });

  it("truncates a stream at value boundaries", async () => {
    const r = await executeJq(data, ".studies[]", { maxOutputChars: 90 });
    expect(r.truncated).toBe(true);
    expect(r.result).toEqual([data.studies[0], data.studies[1]]);
  });

  it("errors when a single value exceeds the size cap", async () => {
    const r = await executeJq(data, ".studies", { maxOutputChars: 40 });
    expect(r.result).toBeNull();
    expect(r.truncated).toBe(true);
    expect(r.error).toContain("exceeds 40 chars");
  });

  it("reports jq errors", async () => {
    const r = await executeJq(data, ".studies | keys_unsorted(");
    expect(r.result).toBeNull();
    expect(r.error).toStartWith("jq error:");
  });

  it("kills and reaps a timed-out child before resolving", async () => {
    const spawn = spyOn(childProcess, "spawn");
    try {
      const r = await executeJq(null, "def f: f; f", { timeoutMs: 30 });
      expect(r.error).toContain("timed out after 30ms");
      const child = spawn.mock.results[0].value as ChildProcess;
      expect(child.pid).toBeGreaterThan(0);
      expect(() => process.kill(child.pid!, 0)).toThrow();
      expect(child.signalCode).toBe("SIGKILL");
    } finally {
      spawn.mockRestore();
    }
  });

  it("bounds a huge stream and keeps only complete values", async () => {
    const r = await executeJq(null, "range(1e10)", {
      maxOutputChars: 20, timeoutMs: 2000,
    });
    expect(r).toEqual({ result: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], truncated: true });
  });

  it("bounds a single huge value with the existing size error", async () => {
    const r = await executeJq(null, '"x" * 1000000', {
      maxOutputChars: 20, timeoutMs: 2000,
    });
    expect(r.truncated).toBe(true);
    expect(r.error).toContain("exceeds 20 chars in a single value");
  });

  it("preserves character limits for multibyte values", async () => {
    const r = await executeJq(null, 'range(100000) | "😀"', {
      maxOutputChars: 9, timeoutMs: 2000,
    });
    expect(r).toEqual({ result: ["😀", "😀"], truncated: true });
  });

  it("pipes large input through stdin", async () => {
    const r = await executeJq({ text: "a".repeat(2_000_000) }, ".text | length");
    expect(r).toEqual({ result: 2_000_000, truncated: false });
  });

  it("handles early stdin closure and reports jq stderr", async () => {
    const r = await executeJq("a".repeat(2_000_000), 'error("specific failure")');
    expect(r.result).toBeNull();
    expect(r.truncated).toBe(false);
    expect(r.error).toContain("jq error: jq: error");
    expect(r.error).toContain("specific failure");
    const invalid = await executeJq("a".repeat(2_000_000), "(");
    expect(invalid.error).toContain("syntax error");
    const early = await executeJq("a".repeat(2_000_000), "halt");
    expect(early).toEqual({ result: [], truncated: false });
  });

  it("bounds stderr and reaps the child", async () => {
    const spawn = spyOn(childProcess, "spawn");
    try {
      const r = await executeJq(null, 'error("x" * 1000000)', { timeoutMs: 2000 });
      expect(r.error).toStartWith("jq error: jq: error");
      expect(Buffer.byteLength(r.error!)).toBeLessThanOrEqual(65536 + 10);
      const child = spawn.mock.results[0].value as ChildProcess;
      expect(() => process.kill(child.pid!, 0)).toThrow();
    } finally {
      spawn.mockRestore();
    }
  });

  it("kills and reaps an aborted child", async () => {
    const controller = new AbortController();
    const spawn = spyOn(childProcess, "spawn");
    try {
      const pending = executeJq(null, "def f: f; f", { signal: controller.signal });
      controller.abort();
      expect((await pending).error).toContain("aborted");
      const child = spawn.mock.results[0].value as ChildProcess;
      expect(() => process.kill(child.pid!, 0)).toThrow();
    } finally {
      spawn.mockRestore();
    }
  });

  it("does not spawn for an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const spawn = spyOn(childProcess, "spawn");
    try {
      expect((await executeJq(null, ".", { signal: controller.signal })).error).toBeDefined();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      spawn.mockRestore();
    }
  });
});

describe("validateJqFilter", () => {
  it("rejects syntax errors", async () => {
    expect((await validateJqFilter(".foo | (")).valid).toBe(false);
  });

  it("accepts filters that fail at runtime on null", async () => {
    expect(await validateJqFilter(".foo | keys")).toEqual({ valid: true });
  });

  it("does not evaluate costly filters or trailing comments", async () => {
    expect(await validateJqFilter("def f: f; f # comment")).toEqual({ valid: true });
  });
});

describe("parseJqOutput", () => {
  it("keeps a truncated stream as an array even if one value fits", () => {
    const r = parseJqOutput('{"a":1}\n{"a":2}\n', 10);
    expect(r).toEqual({ result: [{ a: 1 }], truncated: true });
  });

  it("parses scalar output", () => {
    expect(parseJqOutput("3\n").result).toBe(3);
    expect(parseJqOutput('"x"\n"y"\n').result).toEqual(["x", "y"]);
  });
});

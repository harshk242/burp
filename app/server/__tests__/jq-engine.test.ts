import { describe, expect, it } from "bun:test";
import { executeJq, parseJqOutput } from "../orchestration/tools/jq-engine";

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

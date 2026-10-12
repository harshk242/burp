import { describe, expect, it } from "bun:test";
import { canonicalJson, contentHash, datasetHash, sha256Hex } from "../lib/hash";

describe("canonicalJson", () => {
  it("sorts keys at every depth, without whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("drops undefined members and keeps null", () => {
    expect(canonicalJson({ a: undefined, b: null, c: [undefined, null] })).toBe('{"b":null,"c":[null,null]}');
  });

  it("matches JSON.parse(JSON.stringify(x)) round-trips", () => {
    const value = { s: "é ü – \"q\" \n", n: 1.5, i: 10, neg: -0.25, t: true, e: [], o: {} };
    expect(canonicalJson(JSON.parse(JSON.stringify(value)))).toBe(canonicalJson(value));
  });

  it("rejects values JSON can't represent faithfully", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow("non-finite");
    expect(() => canonicalJson({ d: new Date(0) })).toThrow("unsupported object");
  });
});

describe("hashes", () => {
  const item = { input: { turns: ["q"] }, expected_output: { checkpoints: [] }, metadata: { notes: "" } };

  it("content_hash ignores a stored content_hash and key order", () => {
    const stored = { ...item, metadata: { content_hash: "stale", notes: "" } };
    const reordered = { metadata: { notes: "" }, expected_output: { checkpoints: [] }, input: { turns: ["q"] } };
    expect(contentHash(stored)).toBe(contentHash(item));
    expect(contentHash(reordered)).toBe(contentHash(item));
    expect(contentHash(item)).toBe(
      sha256Hex('{"expected_output":{"checkpoints":[]},"input":{"turns":["q"]},"metadata":{"notes":""}}'),
    );
  });

  it("content_hash changes with any field", () => {
    expect(contentHash({ ...item, metadata: { notes: "x" } })).not.toBe(contentHash(item));
  });

  it("dataset_hash is order-independent and sensitive to ids and hashes", () => {
    const pairs = [
      { id: "b", contentHash: "2" },
      { id: "a", contentHash: "1" },
    ];
    expect(datasetHash(pairs)).toBe(datasetHash([...pairs].reverse()));
    expect(datasetHash(pairs)).toBe(sha256Hex('[["a","1"],["b","2"]]'));
    expect(datasetHash([{ id: "a", contentHash: "1" }])).not.toBe(datasetHash(pairs));
  });
});

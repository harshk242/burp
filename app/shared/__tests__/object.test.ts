import { describe, expect, it } from "bun:test";
import { omitUndefined } from "../object";

describe("omitUndefined", () => {
  it("drops undefined-valued keys and keeps falsy values", () => {
    const out = omitUndefined({ a: 1, b: undefined, c: null, d: 0, e: "", f: false });
    expect(out).toEqual({ a: 1, c: null, d: 0, e: "", f: false });
    expect(Object.hasOwn(out, "b")).toBe(false);
  });

  it("types undefined-admitting keys as optional and keeps required ones required", () => {
    const apiKey: string | undefined = undefined;
    const out: { model: string; apiKey?: string } = omitUndefined({ model: "m", apiKey });
    expect(out).toEqual({ model: "m" });
  });
});

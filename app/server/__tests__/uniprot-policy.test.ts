import { describe, expect, it } from "bun:test";
import { appConfig } from "../config";
import { ALWAYS_LOADED_TOOLS } from "../mcp/platforms.config";
import { applyNoiseReduction } from "../orchestration/tools/noise-reduction";
import { validatePolicies } from "../orchestration/tools/policy-resolver";

describe("enabled UniProt output policy", () => {
  it("validates all configured jq filters", async () => {
    expect(await validatePolicies()).toEqual({ valid: true, errors: [] });
    expect(appConfig.platforms.uniprot.enabled).toBe(true);
    expect(ALWAYS_LOADED_TOOLS.has("uniprot__search_by_gene")).toBe(true);
    expect(ALWAYS_LOADED_TOOLS.has("uniprot__get_external_references")).toBe(false);
  });

  it("preserves requested summary counts and long sequences while removing evidence", async () => {
    const data = {
      results: Array.from({ length: 25 }, (_, i) => ({ accession: `P${i}`, reviewed: true })),
      sequence: { value: "M".repeat(35_000), length: 35_000 },
      comments: [{ texts: [{ value: "function", evidences: [{ evidenceCode: "ECO:0000269" }] }] }],
    };
    const result = await applyNoiseReduction("uniprot__get_protein_sequence", data);
    expect(result.filtersSkipped).toBe(0);
    expect(result.data).toEqual({ ...data, comments: [{ texts: [{ value: "function" }] }] });
  });
});

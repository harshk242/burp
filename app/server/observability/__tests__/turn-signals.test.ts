import { describe, expect, it } from "bun:test";
import { TURN_OUTCOMES, turnSignals, writeTurnScores, type TurnSignalRow } from "../turn-signals";
import { tracingEnvironment } from "../langfuse";

const row = (over: Partial<TurnSignalRow>): TurnSignalRow => ({
  status: "ok",
  error_code: null,
  final_finish_reason: "stop",
  tool_error_count: 0,
  ...over,
});

describe("turnSignals", () => {
  it("ok turn", () => {
    expect(turnSignals(row({ tool_error_count: 3 }))).toEqual({ turn_outcome: "ok", answer_truncated: false, tool_error_count: 3 });
  });

  it("a truncated answer stays ok", () => {
    expect(turnSignals(row({ final_finish_reason: "length" }))).toMatchObject({ turn_outcome: "ok", answer_truncated: true });
  });

  it("failed turns report their error code", () => {
    for (const code of TURN_OUTCOMES.filter((o) => o !== "ok" && o !== "aborted")) {
      expect(turnSignals(row({ status: "error", error_code: code })).turn_outcome).toBe(code);
    }
  });

  it("aborted and closed turns are aborted; unknown codes are internal_error", () => {
    expect(turnSignals(row({ status: "aborted", error_code: "aborted" })).turn_outcome).toBe("aborted");
    expect(turnSignals(row({ status: "aborted", error_code: "closed" })).turn_outcome).toBe("aborted");
    expect(turnSignals(row({ status: "error", error_code: "mystery" })).turn_outcome).toBe("internal_error");
    expect(turnSignals(row({ status: "error", error_code: null, final_finish_reason: null })).answer_truncated).toBe(false);
  });
});

describe("writeTurnScores", () => {
  it("writes three typed scores to the trace in the tracing environment", () => {
    const created: Record<string, unknown>[] = [];
    const client = { score: { create: (body: Record<string, unknown>) => created.push(body) } };
    writeTurnScores("t1", { turn_outcome: "refusal", answer_truncated: true, tool_error_count: 2 }, {}, client as never);
    expect(created).toEqual([
      { traceId: "t1", environment: tracingEnvironment, id: "t1-turn_outcome", name: "turn_outcome", value: "refusal", dataType: "CATEGORICAL" },
      { traceId: "t1", environment: tracingEnvironment, id: "t1-answer_truncated", name: "answer_truncated", value: 1, dataType: "BOOLEAN" },
      { traceId: "t1", environment: tracingEnvironment, id: "t1-tool_error_count", name: "tool_error_count", value: 2, dataType: "NUMERIC" },
    ]);
  });

  it("never throws and is a no-op without a client", () => {
    const client = { score: { create: () => { throw new Error("boom"); } } };
    expect(() => writeTurnScores("t1", { turn_outcome: "ok", answer_truncated: false, tool_error_count: 0 }, {}, client as never)).not.toThrow();
    expect(() => writeTurnScores("t1", { turn_outcome: "ok", answer_truncated: false, tool_error_count: 0 }, {}, null)).not.toThrow();
  });
});

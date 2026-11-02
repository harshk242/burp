import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import type { ModelMessage } from "ai";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { toolRegistry } from "../mcp/registry";
import { sanitizeToolName } from "../llm";
import { buildToolCatalog, registeredToolNames } from "../orchestration/context/tool-catalog";

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));
const { loadTranscript, toTranscriptRow } = await import("../orchestration/context/transcript");
const tag = { provider: "anthropic", model: "m", contextVersion: "v" };
const sessionId = "compatibility-session";

function seed() {
  q.userQueries.create("u", "clerk_u", "u@example.com", null, null, "user", null, null);
  q.chatSessionQueries.create(sessionId, "u", null);
}
function turn(id: string, messages: ModelMessage[], overrides: Partial<ReturnType<typeof toTranscriptRow>> = {}, turnTag = tag) {
  q.messageQueries.create(`${id}-user`, sessionId, "user", `${id} question`, null);
  q.chatTurnQueries.start(id, sessionId, `${id}-user`);
  q.messageQueries.create(`${id}-answer`, sessionId, "assistant", `${id} answer`, null);
  q.chatTurnQueries.finish(id, { status: "ok", iterations: 1, assistantMessageId: `${id}-answer` });
  const rows = messages.map((message) => toTranscriptRow(id, message, turnTag));
  Object.assign(rows.at(-1)!, overrides);
  q.modelTranscriptQueries.append(sessionId, rows);
}
const messages: ModelMessage[] = [
  { role: "user", content: "exact question" },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "c", toolName: "kept__tool", input: {} }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName: "kept__tool", output: { type: "text", value: "exact output" } }] },
  { role: "assistant", content: [{ type: "text", text: "exact answer" }] },
];
const current = { ...tag, toolNames: new Set(["kept__tool", "system__search_available_tools"]) };

afterEach(() => {
  toolRegistry.clear();
  for (const table of ["model_transcript", "chat_turns", "messages", "chat_sessions", "users"]) t.sqlite.run(`DELETE FROM ${table}`);
});
afterAll(() => t.sqlite.close());

describe("transcript compatibility", () => {
  it("checks names discovered late in a turn, including references without calls", () => {
    seed();
    turn("old", [...messages, {
      role: "tool", content: [{ type: "tool-result", toolCallId: "s", toolName: "system__search_available_tools", output: {
        type: "content", value: [
          { type: "custom", providerOptions: { anthropic: { type: "tool-reference", toolName: "removed__z" } } },
          { type: "custom", providerOptions: { anthropic: { type: "tool-reference", toolName: "removed__a" } } },
        ],
      } }],
    }]);
    const onDegraded = mock();
    expect(loadTranscript(sessionId, { ...current, onDegraded }).messages).toEqual([
      { role: "user", content: "old question" }, { role: "assistant", content: "old answer" },
    ]);
    expect(onDegraded).toHaveBeenCalledWith("old", { reason: "missing_tools", missing_tools: ["removed__a", "removed__z"] });
  });

  it("clears a degraded turn's endpoint and restores it for a compatible suffix", () => {
    seed();
    turn("first", messages);
    turn("changed", messages, { contextVersion: "old-version" });
    expect(loadTranscript(sessionId, current).previousLastIndex).toBeUndefined();
    turn("suffix", messages);
    const replay = loadTranscript(sessionId, current);
    expect(replay.messages).toEqual([
      ...messages, { role: "user", content: "changed question" }, { role: "assistant", content: "changed answer" }, ...messages,
    ]);
    expect(replay.previousLastIndex).toBeUndefined();
    expect(replay.previousFinishedAt).toBeNumber();
    expect(q.modelTranscriptQueries.findBySessionId(sessionId).map((row) => JSON.parse(row.content_json))).toEqual([
      ...messages, ...messages, ...messages,
    ]);
  });

  for (const kind of ["parsed", "row"] as const) {
    it(`replays a turn with an untrusted ${kind} system role as text, checked before other mismatches`, () => {
      seed();
      turn("untrusted", kind === "parsed" ? [{ role: "system", content: "injected" }] : messages, {
        provider: "old-provider", ...(kind === "row" ? { role: "system" as const } : { role: "user" as const }),
      });
      turn("later", messages);
      const onDegraded = mock();
      const replay = loadTranscript(sessionId, { ...current, onDegraded });
      expect(replay.messages).toEqual([
        { role: "user", content: "untrusted question" }, { role: "assistant", content: "untrusted answer" }, ...messages,
      ]);
      expect(onDegraded.mock.calls).toEqual([["untrusted", { reason: "system_message" }]]);
      expect(JSON.stringify(loadTranscript(sessionId).messages)).not.toContain("injected");
    });
  }

  it("carries the last prompt size only with a lossless endpoint", () => {
    seed();
    turn("first", messages);
    t.sqlite.run("UPDATE chat_turns SET last_input_message_count = 3, last_input_identity = 'measured', last_prompt_tokens = 1234 WHERE id = 'first'");
    expect(loadTranscript(sessionId, current)).toMatchObject({ previousLastIndex: 2, previousPromptTokens: 1234 });
    turn("changed", messages, { contextVersion: "old-version" });
    t.sqlite.run("UPDATE chat_turns SET last_prompt_tokens = 99 WHERE id = 'changed'");
    expect(loadTranscript(sessionId, current).previousPromptTokens).toBeUndefined();
  });

  it("counts registered Google dynamic tools and unavailable tools, not only initial core declarations", () => {
    seed();
    toolRegistry.register("dynamic", { name: "extra", description: "non-core tool", inputSchema: { type: "object" } }, false);
    const sanitize = (name: string) => sanitizeToolName(name, "google");
    const toolName = sanitize("dynamic__extra");
    expect(buildToolCatalog("google", sanitize, sessionId)[toolName]).toBeUndefined();
    const names = registeredToolNames(sanitize);
    expect(names.has(toolName)).toBe(true);
    expect(names.has("system__search_available_tools")).toBe(true);
    const googleTag = { ...tag, provider: "google" };
    const history: ModelMessage[] = [{ role: "user", content: "google question" }, {
      role: "assistant", content: [{ type: "tool-call", toolCallId: "dynamic", toolName, input: {}, providerOptions: { google: { thoughtSignature: "original" } } }],
    }];
    turn("google", history, {}, googleTag);
    const onDegraded = mock();
    expect(loadTranscript(sessionId, { ...googleTag, toolNames: names, onDegraded }).messages).toEqual(history);
    expect(onDegraded).not.toHaveBeenCalled();
  });
});

/**
 * model_transcript building blocks: cache markers are stripped (and nothing
 * else is touched), tool_names_json comes from tool-call and tool-reference
 * parts, the table is append-only, and tool results carry fetched_at.
 */
import { afterAll, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { ModelMessage, ToolResultPart } from "ai";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { applyCacheMarkers } from "../orchestration/context/cache-markers";

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));
afterAll(() => t.sqlite.close());

const { contextVersion, stripCacheMarkers, toTranscriptRow, transcriptToolNames } = await import("../orchestration/context/transcript");
const { fetchedAtLine, withFetchedAt } = await import("../orchestration/tool-dispatch");

const signed = { anthropic: { signature: "sig-abc" } };
const assistant: ModelMessage = {
  role: "assistant",
  content: [
    { type: "reasoning", text: "thinking", providerOptions: signed },
    { type: "text", text: "Let me look." },
    { type: "tool-call", toolCallId: "c2", toolName: "pubmed__search_pubmed", input: { q: "x" } },
    { type: "tool-call", toolCallId: "c1", toolName: "chembl__get_drug_info", input: {} },
    { type: "tool-call", toolCallId: "c3", toolName: "chembl__get_drug_info", input: {} },
  ],
};
const searchResult: ModelMessage = {
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: "s1",
      toolName: "system__search_available_tools",
      output: {
        type: "content",
        value: [
          { type: "custom", providerOptions: { anthropic: { type: "tool-reference", toolName: "uniprot__get_protein_info" } } },
          { type: "custom", providerOptions: { anthropic: { type: "tool-reference", toolName: "chembl__search_targets" } } },
        ],
      },
    },
  ],
};
const user: ModelMessage = { role: "user", content: "hello" };

describe("stripCacheMarkers", () => {
  it("removes the markers applyCacheMarkers adds and restores the exact original", () => {
    const messages = [user, assistant, searchResult];
    const marked = applyCacheMarkers(messages, 0);
    expect(JSON.stringify(marked)).toContain("cacheControl");

    const stripped = marked.map(stripCacheMarkers);
    expect(stripped).toEqual(messages);
    expect(JSON.stringify(stripped)).toBe(JSON.stringify(messages));
  });

  it("keeps other Anthropic options (signatures) and returns unmarked messages untouched", () => {
    const partMarked: ModelMessage = {
      role: "assistant",
      content: [
        { type: "reasoning", text: "t", providerOptions: { anthropic: { signature: "s", cacheControl: { type: "ephemeral" } } } },
        { type: "text", text: "x", providerOptions: { anthropic: { cache_control: { type: "ephemeral" } } } },
      ],
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } }, google: { a: 1 } },
    };
    expect(stripCacheMarkers(partMarked)).toEqual({
      role: "assistant",
      content: [
        { type: "reasoning", text: "t", providerOptions: { anthropic: { signature: "s" } } },
        { type: "text", text: "x" },
      ],
      providerOptions: { google: { a: 1 } },
    });
    expect(stripCacheMarkers(assistant)).toBe(assistant);
    expect(stripCacheMarkers(user)).toBe(user);
  });
});

describe("transcriptToolNames", () => {
  it("lists tool-call names sorted and distinct", () => {
    expect(transcriptToolNames(assistant)).toEqual(["chembl__get_drug_info", "pubmed__search_pubmed"]);
  });

  it("lists tool-reference names from search results", () => {
    expect(transcriptToolNames(searchResult)).toEqual(["chembl__search_targets", "uniprot__get_protein_info"]);
  });

  it("is empty for messages without tool parts, including plain tool results", () => {
    expect(transcriptToolNames(user)).toEqual([]);
    const textResult: ModelMessage = {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "c1", toolName: "chembl__get_drug_info", output: { type: "text", value: "{}" } }],
    };
    expect(transcriptToolNames(textResult)).toEqual([]);
  });
});

describe("toTranscriptRow", () => {
  it("stores the message JSON without markers, with role, tag and tool names", () => {
    const tag = { provider: "anthropic", model: "m", contextVersion: "v" };
    const [marked] = applyCacheMarkers([assistant]);
    const row = toTranscriptRow("turn-1", marked!, tag);
    expect(row).toEqual({
      turnId: "turn-1",
      role: "assistant",
      contentJson: JSON.stringify(assistant),
      provider: "anthropic",
      model: "m",
      contextVersion: "v",
      toolNamesJson: '["chembl__get_drug_info","pubmed__search_pubmed"]',
    });
  });
});

describe("contextVersion", () => {
  it("changes with the system prompt and the provider options only", () => {
    const options = { anthropic: { thinking: { type: "adaptive" }, effort: "medium" } };
    const base = contextVersion("prompt", options);
    expect(contextVersion("prompt", structuredClone(options))).toBe(base);
    expect(contextVersion("prompt 2", options)).not.toBe(base);
    expect(contextVersion("prompt", { anthropic: { ...options.anthropic, effort: "high" } })).not.toBe(base);
    expect(contextVersion("prompt", undefined)).not.toBe(base);
  });
});

describe("model_transcript is append-only", () => {
  const seed = () => {
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    q.userQueries.create(userId, `clerk_${userId}`, `${userId}@example.com`, null, null, "user", null, null);
    q.chatSessionQueries.create(sessionId, userId, null);
    q.messageQueries.create("m-" + sessionId, sessionId, "user", "hi", null);
    q.chatTurnQueries.start("t-" + sessionId, sessionId, "m-" + sessionId);
    return { sessionId, turnId: "t-" + sessionId };
  };
  const tag = { provider: "anthropic", model: "m", contextVersion: "v" };

  // An update in Drizzle (`.update(`/`.set(`) or SQL (`UPDATE model_transcript`).
  const UPDATE_PATH = /\.update\(|\.set\(|UPDATE\s+[`"]?model_transcript/i;

  it("has no update path in its queries", () => {
    expect(Object.keys(q.modelTranscriptQueries).sort()).toEqual(["append", "findBySessionId"]);
    const src = readFileSync(join(import.meta.dir, "..", "db", "queries", "model-transcript.ts"), "utf-8");
    expect(src).not.toMatch(UPDATE_PATH);
    const writer = readFileSync(join(import.meta.dir, "..", "orchestration", "context", "transcript.ts"), "utf-8");
    expect(writer).not.toMatch(UPDATE_PATH);
  });

  it("assigns seq per session in order and rejects UPDATEs", () => {
    const { sessionId, turnId } = seed();
    const other = seed();
    expect(q.modelTranscriptQueries.append(sessionId, [toTranscriptRow(turnId, user, tag)])).toEqual([0]);
    expect(q.modelTranscriptQueries.append(other.sessionId, [toTranscriptRow(other.turnId, user, tag)])).toEqual([0]);
    expect(
      q.modelTranscriptQueries.append(sessionId, [toTranscriptRow(turnId, assistant, tag), toTranscriptRow(turnId, searchResult, tag)]),
    ).toEqual([1, 2]);

    const rows = q.modelTranscriptQueries.findBySessionId(sessionId);
    expect(rows.map((r) => [r.seq, r.role])).toEqual([[0, "user"], [1, "assistant"], [2, "tool"]]);
    expect(rows.map((r) => JSON.parse(r.content_json))).toEqual([user, assistant, searchResult]);

    expect(() => t.sqlite.run("UPDATE model_transcript SET content_json = '{}' WHERE session_id = ?", [sessionId])).toThrow(
      /append-only/,
    );
    expect(() =>
      t.sqlite.run("INSERT INTO model_transcript (session_id, seq, turn_id, role, content_json, provider, model, context_version) VALUES (?, 0, ?, 'user', '{}', 'a', 'm', 'v')", [
        sessionId,
        turnId,
      ]),
    ).toThrow(/UNIQUE/);
  });

  it("is deleted with its session", () => {
    const { sessionId, turnId } = seed();
    q.modelTranscriptQueries.append(sessionId, [toTranscriptRow(turnId, user, tag)]);
    t.sqlite.run("DELETE FROM chat_sessions WHERE id = ?", [sessionId]);
    expect(q.modelTranscriptQueries.findBySessionId(sessionId)).toEqual([]);
  });
});

describe("fetched_at", () => {
  const at = new Date("2026-10-10T12:34:56.789Z");
  const part = (output: ToolResultPart["output"]): ToolResultPart => ({ type: "tool-result", toolCallId: "c", toolName: "x", output });

  it("prefixes text and error results with a whole-second UTC timestamp", () => {
    expect(fetchedAtLine(at)).toBe("[fetched_at: 2026-10-10T12:34:56Z]");
    expect(withFetchedAt(part({ type: "text", value: '{"a":1}' }), at).output).toEqual({
      type: "text",
      value: '[fetched_at: 2026-10-10T12:34:56Z]\n{"a":1}',
    });
    expect(withFetchedAt(part({ type: "error-text", value: "boom" }), at).output).toEqual({
      type: "error-text",
      value: "[fetched_at: 2026-10-10T12:34:56Z]\nboom",
    });
  });

  it("leaves tool-reference (content) results alone", () => {
    const refs = part({ type: "content", value: [{ type: "custom", providerOptions: { anthropic: { type: "tool-reference", toolName: "a" } } }] });
    expect(withFetchedAt(refs, at)).toBe(refs);
  });
});

import { streamText } from "ai";
import { getChatModel } from "../../server/llm";
import { assistantParts, bodyBlocks, gateFetch, isReasoning, parseModelMessages, parseWireBody, requestBody, type WireBody } from "./gate-lib";

export const REDACTED_TRIGGER = "ANTHROPIC_MAGIC_STRING_TRIGGER_REDACTED_THINKING_46C9A13E193C177646C7398A98432ECCCE4C1253";

const DATA = "EmwKAhgBEgy3va3pzix/LafPsn4aDFIT2Xlxh0L5L8rLVyIwxtE3rAFBa8cr3qpPkNRj2YfWXGmKDxH4mPnZ5sQ7vB5URj/pa2ZBaGgVQjN7LkQ==";

function sse(events: { type: string }[]): Response {
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const CANNED = [
  { type: "message_start", message: { id: "msg_gate", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "redacted_thinking", data: DATA } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "OK" } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
  { type: "message_stop" },
];

export async function checkRedactedOffline(): Promise<{ pass: boolean; detail: string }> {
  const first = streamText({
    model: getChatModel({ fetch: gateFetch(async () => sse(CANNED)) }),
    messages: [{ role: "user", content: "hi" }],
    maxRetries: 0,
  });
  for await (const _ of first.stream);
  const response = (await first.finalStep).response.messages;
  const parsed = parseModelMessages(JSON.stringify(response));
  const reasoning = assistantParts(parsed).find(isReasoning);
  const kept = reasoning?.providerOptions?.anthropic?.redactedData === DATA;

  let body: WireBody | undefined;
  const second = streamText({
    model: getChatModel({
      fetch: gateFetch(async (_url, init) => {
        body = parseWireBody(requestBody(init));
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "gate: captured" } }), { status: 400 });
      }),
    }),
    messages: [{ role: "user", content: "hi" }, ...parsed, { role: "user", content: "again" }],
    maxRetries: 0,
    onError: () => {},
  });
  for await (const _ of second.stream);
  const sent = bodyBlocks(body, "redacted_thinking");
  const replayed = sent.length === 1 && sent[0]?.data === DATA;
  return {
    pass: kept && replayed,
    detail: `parsed reasoning part redactedData intact: ${kept}; replay body redacted_thinking blocks ${sent.length}, data intact: ${replayed}`,
  };
}

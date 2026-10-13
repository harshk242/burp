/**
 * One LLM call of the chat loop: runs streamText over the turn's transport,
 * streams text and thinking to the client as it arrives, and returns the
 * call's results once it finished cleanly. A failed or aborted call throws
 * before its results are read, so it is never metered as finished.
 */

import { streamText, wrapLanguageModel, type ModelMessage, type SystemModelMessage } from "ai";
import { getChatModel, type ChatProviderOptions, type LLMConfig } from "../llm";
import { providerError, TurnError } from "./chat-turn";
import type { CallTracker } from "./turn-usage";
import type { ToolSet } from "./tool-dispatch";
import type { StreamEvent } from "./types";

type StreamResult = ReturnType<typeof streamText<ToolSet>>;

/** Stream parts that mean the model started answering (completionStartTime). */
const FIRST_CHUNK_PARTS = new Set<string>(["text-delta", "reasoning-delta", "tool-input-start", "tool-call"]);

/** A stretch of the call's output in stream order: thinking or text. */
export interface CallSegment {
  thinking: boolean;
  text: string;
}

export interface ModelCallRequest {
  iteration: number;
  llmConfig: Pick<LLMConfig, "chatModel" | "maxRetries" | "maxOutputTokens">;
  providerOptions: ChatProviderOptions | undefined;
  instructions: string | SystemModelMessage;
  /** What is sent: the turn's messages, with cache markers when caching. */
  messages: ModelMessage[];
  /** Declarations only (no execute): the loop dispatches tool calls itself. */
  tools: ToolSet;
  tracker: CallTracker;
  signal: AbortSignal;
  /** Called once, on the first streamed output (text, thinking or a tool call). */
  onFirstChunk?: () => void;
}

export interface ModelCallResult {
  /** This call's response text (all text deltas). */
  text: string;
  segments: CallSegment[];
  finishReason: Awaited<StreamResult["finishReason"]>;
  rawFinishReason: string | undefined;
  toolCalls: Awaited<StreamResult["toolCalls"]>;
  finalStep: Awaited<StreamResult["finalStep"]>;
}

/**
 * Runs one call. Thinking (summarized on Anthropic) is sent as `reasoning`
 * events; the first delta of each thinking block carries `newBlock`.
 */
export async function* streamModelCall(req: ModelCallRequest): AsyncGenerator<StreamEvent, ModelCallResult> {
  const { llmConfig, tracker, signal } = req;
  // A provider error part does not make the stream throw: the SDK emits an
  // error part, hands it to onError and finishes the step with finishReason "error".
  let streamError: unknown;
  tracker.begin(req.iteration);
  const result = streamText({
    model: wrapLanguageModel({
      model: getChatModel({ fetch: tracker.fetch, model: llmConfig.chatModel }) as Parameters<typeof wrapLanguageModel>[0]["model"],
      middleware: {
        specificationVersion: "v4",
        wrapStream: async ({ doStream }) => {
          tracker.assertContextBudget();
          return doStream();
        },
      },
    }),
    instructions: req.instructions,
    messages: req.messages,
    tools: req.tools,
    maxRetries: llmConfig.maxRetries,
    maxOutputTokens: llmConfig.maxOutputTokens,
    providerOptions: req.providerOptions,
    abortSignal: signal,
    onLanguageModelCallStart: tracker.onRequest,
    onChunk: tracker.onChunk,
    onError: ({ error }) => {
      streamError ??= error;
    },
  });

  // Segments keep this call's thinking and text in stream order.
  const segments: CallSegment[] = [];
  let text = "";
  let thinkingStarted = false;
  let firstChunk = req.onFirstChunk;
  for await (const part of result.stream) {
    if (firstChunk && FIRST_CHUNK_PARTS.has(part.type)) {
      firstChunk();
      firstChunk = undefined;
    }
    if (part.type === "text-delta") {
      text += part.text;
      const last = segments.at(-1);
      if (last && !last.thinking) last.text += part.text;
      else if (part.text) segments.push({ thinking: false, text: part.text });
      yield { type: "text", data: part.text };
    } else if (part.type === "reasoning-start") {
      thinkingStarted = true;
    } else if (part.type === "reasoning-delta" && part.text) {
      const newBlock = thinkingStarted || segments.at(-1)?.thinking !== true;
      thinkingStarted = false;
      if (newBlock) segments.push({ thinking: true, text: part.text });
      else segments.at(-1)!.text += part.text;
      yield { type: "reasoning", data: { text: part.text, newBlock } };
    } else if (part.type === "error") {
      streamError ??= part.error;
    }
  }
  // An abort can end the text stream without an error; stop before
  // reading the step's results.
  signal.throwIfAborted();
  // A failed call has no valid final usage: throw before metering it, so
  // the tracker keeps it in flight and the turn records it as an estimate.
  // Checked before awaiting the results, which would reject with a generic
  // NoOutputGeneratedError when the call produced nothing.
  if (streamError !== undefined) throw streamError instanceof TurnError ? streamError : providerError(streamError);

  const finishReason = await result.finishReason;
  if (finishReason === "error") throw providerError(`LLM call ${req.iteration} finished with an error`);
  return {
    text,
    segments,
    finishReason,
    rawFinishReason: await result.rawFinishReason,
    toolCalls: await result.toolCalls,
    finalStep: await result.finalStep,
  };
}

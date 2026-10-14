import { streamText, wrapLanguageModel, type ModelMessage, type SystemModelMessage } from "ai";
import { getChatModel, type ChatProviderOptions, type LLMConfig } from "../llm";
import { providerError, TurnError } from "./chat-turn";
import type { CallTracker } from "./turn-usage";
import type { ToolSet } from "./tool-dispatch";
import type { StreamEvent } from "./types";

type StreamResult = ReturnType<typeof streamText<ToolSet>>;

const FIRST_CHUNK_PARTS = new Set<string>(["text-delta", "reasoning-delta", "tool-input-start", "tool-call"]);

export interface CallSegment {
  thinking: boolean;
  text: string;
}

export interface ModelCallRequest {
  iteration: number;
  llmConfig: Pick<LLMConfig, "chatModel" | "maxRetries" | "maxOutputTokens">;
  providerOptions: ChatProviderOptions | undefined;
  instructions: string | SystemModelMessage;
  messages: ModelMessage[];
  tools: ToolSet;
  tracker: CallTracker;
  signal: AbortSignal;
  onFirstChunk?: () => void;
}

export interface ModelCallResult {
  text: string;
  segments: CallSegment[];
  finishReason: Awaited<StreamResult["finishReason"]>;
  rawFinishReason: string | undefined;
  toolCalls: Awaited<StreamResult["toolCalls"]>;
  finalStep: Awaited<StreamResult["finalStep"]>;
}

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
  signal.throwIfAborted();
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

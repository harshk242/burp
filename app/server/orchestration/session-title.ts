/**
 * Session title: a short title from the first user question (title model),
 * with a fallback built from the question itself.
 */

import { generateText } from "ai";
import { getTitleModel, loadLLMConfig } from "../llm";
import { chatSessionQueries } from "../db";
import { logger, startTimer, type LogContext } from "../logger";

const llmConfig = loadLLMConfig();

export async function generateSessionTitle(
  sessionId: string,
  firstMessage: string
): Promise<string> {
  const fallbackTitle = buildFallbackTitle(firstMessage);
  const elapsed = startTimer();
  const ctx: LogContext = { session_id: sessionId };

  logger.info("TITLE", "generation_start", {
    ctx,
    data: { model: llmConfig.titleModel, provider: llmConfig.provider },
  });

  try {
    const { text } = await generateText({
      model: getTitleModel(),
      maxOutputTokens: 50,
      prompt: `Generate a short chat title (3-6 words) from this user question:
"${firstMessage.substring(0, 300)}"

Return only the title text.`,
      abortSignal: AbortSignal.timeout(5000),
    });

    const title = normalizeTitle(text, fallbackTitle);
    chatSessionQueries.updateTitle(sessionId, title);

    logger.info("TITLE", "generation_complete", {
      ctx,
      duration_ms: elapsed(),
      data: { title },
    });

    return title;
  } catch (error) {
    logger.error("TITLE", "generation_failed", {
      ctx,
      duration_ms: elapsed(),
      error: error instanceof Error ? error : String(error),
      data: { fallback_title: fallbackTitle },
    });
    chatSessionQueries.updateTitle(sessionId, fallbackTitle);
    return fallbackTitle;
  }
}

function normalizeTitle(rawTitle: string, fallback: string): string {
  const normalized = rawTitle
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!normalized) return fallback;
  return normalized.length > 80 ? normalized.slice(0, 80).trimEnd() : normalized;
}

function buildFallbackTitle(firstMessage: string): string {
  const cleaned = firstMessage
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!cleaned) return "New Chat";
  const words = cleaned.split(" ").slice(0, 6);
  const title = words.join(" ");
  return title.length > 80 ? title.slice(0, 80).trimEnd() : title;
}

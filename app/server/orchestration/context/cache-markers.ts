/**
 * Anthropic prompt-cache breakpoints for the chat loop.
 *
 * - System: the instructions go out as a system message with `cacheControl`.
 *   Tools render before system, so this one breakpoint covers tools + system.
 *   (A deferred tool can't carry `cache_control`; the API returns 400.)
 * - Messages: the current last message and the previous call's last message.
 *   Anthropic looks back only ~20 blocks from a breakpoint for an earlier cache
 *   entry; a large parallel tool batch goes past that, so marking the previous
 *   call's last message keeps its cache entry an exact hit. A turn's first
 *   call carries the preceding successful turn's final input endpoint.
 *   Total: at most 3 of the 4 breakpoints the API allows.
 *
 * Markers go on a copy made just before each call: the loop's `messages` array
 * (and every message in it) is never modified, so nothing has to be cleared
 * between calls and the messages can be saved as they are.
 *
 * TTL is 5 minutes: calls within a turn are seconds apart. Anthropic only; the
 * Google provider ignores `providerOptions.anthropic`, but the loop doesn't send
 * markers there at all.
 */

import type { ModelMessage, SystemModelMessage } from "ai";

type ProviderOptions = NonNullable<ModelMessage["providerOptions"]>;

export const EPHEMERAL_5M = { type: "ephemeral", ttl: "5m" } as const;

/** Adds the cache marker to a message's provider options, keeping any others. */
function withCacheControl(providerOptions: ProviderOptions | undefined): ProviderOptions {
  return {
    ...providerOptions,
    anthropic: { ...providerOptions?.anthropic, cacheControl: EPHEMERAL_5M },
  };
}

/** The system prompt as a cached system message (breakpoint over tools + system). */
export function cachedInstructions(systemPrompt: string): SystemModelMessage {
  return {
    role: "system",
    content: systemPrompt,
    providerOptions: withCacheControl(undefined),
  };
}

/**
 * A copy of `messages` with cache markers on the last message and on
 * `previousLastIndex` (the previous call's last message, including across
 * turns). Only the marked messages are cloned
 * (shallowly); the input array and its messages are left untouched.
 */
export function applyCacheMarkers(messages: readonly ModelMessage[], previousLastIndex?: number): ModelMessage[] {
  const copy = [...messages];
  const lastIndex = copy.length - 1;
  const marked = new Set<number>();
  if (lastIndex >= 0) marked.add(lastIndex);
  if (previousLastIndex !== undefined && previousLastIndex >= 0 && previousLastIndex < lastIndex) {
    marked.add(previousLastIndex);
  }
  for (const index of marked) {
    const message = copy[index]!;
    copy[index] = { ...message, providerOptions: withCacheControl(message.providerOptions) } as ModelMessage;
  }
  return copy;
}

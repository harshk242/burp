import type { ModelMessage, SystemModelMessage } from "ai";

type ProviderOptions = NonNullable<ModelMessage["providerOptions"]>;

export const EPHEMERAL_5M = { type: "ephemeral", ttl: "5m" } as const;

function withCacheControl(providerOptions: ProviderOptions | undefined): ProviderOptions {
  return {
    ...providerOptions,
    anthropic: { ...providerOptions?.anthropic, cacheControl: EPHEMERAL_5M },
  };
}

export function cachedInstructions(systemPrompt: string): SystemModelMessage {
  return {
    role: "system",
    content: systemPrompt,
    providerOptions: withCacheControl(undefined),
  };
}

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

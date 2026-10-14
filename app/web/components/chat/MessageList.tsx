"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { StreamingText } from "./StreamingText";
import { ToolCallGroup } from "./ToolCallGroup";
import { ReasoningBlock } from "./ReasoningBlock";
import { joinReasoning } from "@/lib/reasoning";
import type { Message, ToolCall } from "@/types";

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  pendingToolCalls: ToolCall[];
  isStreaming: boolean;
  reasoningSegments: string[];
  sessionTitle?: string;
}

export function MessageList({
  messages,
  streamingContent,
  pendingToolCalls,
  isStreaming,
  reasoningSegments,
  sessionTitle,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent, pendingToolCalls, reasoningSegments]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4">
      <div className="max-w-3xl mx-auto py-4 space-y-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} sessionTitle={sessionTitle} />
        ))}

        {isStreaming && (streamingContent || pendingToolCalls.length > 0 || reasoningSegments.length > 0) && (
          <div className="space-y-2">
            {reasoningSegments.length > 0 && (
              <ReasoningBlock
                content={joinReasoning(reasoningSegments)}
                defaultExpanded={false}
              />
            )}

            {pendingToolCalls.length > 0 && (
              <ToolCallGroup toolCalls={pendingToolCalls} />
            )}

            {streamingContent && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                  AI
                </div>
                <div className="flex-1 space-y-2 overflow-hidden">
                  <StreamingText content={streamingContent} />
                </div>
              </div>
            )}
          </div>
        )}

        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <h2 className="text-2xl font-semibold mb-2">
              Welcome to BURP
            </h2>
            <p className="text-muted-foreground max-w-md">
              Ask questions about proteins, drugs, genes, variants, pathways,
              clinical trials, or biomedical literature. I have access to 10
              specialized databases.
            </p>
            <div className="mt-6 grid gap-2 text-sm text-muted-foreground">
              <p>Try asking:</p>
              <ul className="space-y-1">
                <li>&quot;What proteins interact with BRCA1?&quot;</li>
                <li>&quot;Find drugs that target EGFR&quot;</li>
                <li>&quot;What is the clinical significance of rs1042522?&quot;</li>
                <li>&quot;Show me pathways involving TP53&quot;</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

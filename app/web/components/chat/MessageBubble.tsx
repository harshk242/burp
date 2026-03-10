"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolCallCard } from "./ToolCallCard";
import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors duration-150",
        className
      )}
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium",
          isUser
            ? "bg-secondary text-secondary-foreground"
            : "bg-primary text-primary-foreground"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : "AI"}
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex-1 space-y-2 overflow-hidden",
          isUser && "flex flex-col items-end"
        )}
      >
        {/* Tool calls (for assistant messages) */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-2 text-left w-full">
            {message.toolCalls.map((toolCall) => (
              <ToolCallCard key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}

        {/* Message content */}
        {message.content && (
          <div className={cn("group", isUser && "max-w-[85%]")}>
            <div
              className={cn(
                "rounded-lg px-4 py-2 max-w-full",
                isUser ? "bg-primary text-primary-foreground" : "bg-muted"
              )}
            >
              {isUser ? (
                <p className="whitespace-pre-wrap text-left">{message.content}</p>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                </div>
              )}
            </div>
            {/* Action bar below bubble */}
            <div className={cn(
              "flex items-center mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200",
              isUser ? "justify-end" : "justify-start"
            )}>
              <CopyButton text={message.content} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

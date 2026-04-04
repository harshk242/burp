"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, Copy, Check, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolCallGroup } from "./ToolCallGroup";
import { ReasoningBlock } from "./ReasoningBlock";
import { exportMessageAsPdf } from "@/lib/exportPdf";
import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
  sessionTitle?: string;
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

function DownloadButton({
  content,
  sessionTitle,
  className,
}: {
  content: string;
  sessionTitle: string;
  className?: string;
}) {
  const [isExporting, setIsExporting] = useState(false);

  const handleDownload = async () => {
    if (!content || isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportMessageAsPdf(content, sessionTitle);
      if (!result.success) {
        console.error("PDF export failed:", result.error);
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={isExporting}
      className={cn(
        "p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      title="Download as PDF"
    >
      {isExporting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function MessageBubble({ message, sessionTitle = "Chat" }: MessageBubbleProps) {
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
        <div className="w-full space-y-2">
          {/* Reasoning block (assistant only) */}
          {!isUser && message.reasoning && (
            <ReasoningBlock content={message.reasoning} defaultExpanded={false} />
          )}

          {/* Tool calls (for assistant messages) */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="text-left w-full">
              <ToolCallGroup toolCalls={message.toolCalls} />
            </div>
          )}

          {/* Message content */}
          {message.content && (
            <div className={cn(isUser && "max-w-[85%]")}>
              <div
                className={cn(
                  "rounded-lg px-4 py-2 max-w-full",
                  isUser ? "bg-primary text-primary-foreground" : "bg-muted"
                )}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap text-left">{message.content}</p>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  </div>
                )}
              </div>
              {/* Action bar below bubble */}
              <div className={cn(
                "action-bar flex items-center gap-2 mt-1",
                isUser ? "justify-end" : "justify-start"
              )}>
                <CopyButton text={message.content} />
                {!isUser && (
                  <DownloadButton content={message.content} sessionTitle={sessionTitle} />
                )}
                {/* Token count — only shown for assistant messages that have usage data */}
                {!isUser && message.tokenUsage && (
                  <span className="text-[10px] text-foreground/60 select-none">
                    {(message.tokenUsage.input + message.tokenUsage.output).toLocaleString()} tokens
                    &nbsp;·&nbsp;↑{message.tokenUsage.input.toLocaleString()} ↓{message.tokenUsage.output.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

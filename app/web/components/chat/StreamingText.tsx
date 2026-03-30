"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface StreamingTextProps {
  content: string;
  className?: string;
}

export function StreamingText({ content, className }: StreamingTextProps) {
  return (
    <div
      className={cn(
        "rounded-lg bg-muted px-4 py-2 inline-block max-w-full",
        className
      )}
    >
      <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        <span className="streaming-cursor" />
      </div>
    </div>
  );
}

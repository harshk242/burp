"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ReasoningBlockProps {
  content: string;
  defaultExpanded?: boolean;
}

export function ReasoningBlock({ content, defaultExpanded = false }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!content) return null;

  return (
    <div className="reasoning-block border rounded-lg overflow-hidden bg-card text-card-foreground">
      {/* Clickable summary header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        <Brain className="h-4 w-4 text-violet-500 shrink-0" />

        <span className="text-sm font-medium text-muted-foreground">Reasoning</span>
      </button>

      {/* Expanded: render reasoning content */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t bg-violet-50/50 dark:bg-violet-950/20">
          <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-muted-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

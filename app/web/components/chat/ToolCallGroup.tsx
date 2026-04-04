"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToolCallCard } from "./ToolCallCard";
import { DATABASE_LABELS } from "@/lib/constants";
import type { ToolCall } from "@/types";

interface ToolCallGroupProps {
  toolCalls: ToolCall[];
}

export function ToolCallGroup({ toolCalls }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  // Aggregate stats for the summary header
  const serverCounts = new Map<string, number>();
  let running = 0;
  let errors = 0;

  for (const tc of toolCalls) {
    const label = DATABASE_LABELS[tc.server] || tc.server;
    serverCounts.set(label, (serverCounts.get(label) || 0) + 1);
    if (tc.status === "running" || tc.status === "pending") running++;
    else if (tc.status === "error") errors++;
  }

  const isInProgress = running > 0;
  const hasErrors = errors > 0;

  return (
    <div className="tool-call-group border rounded-lg overflow-hidden bg-card text-card-foreground">
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

        <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />

        <span className="text-sm font-medium whitespace-nowrap">
          {toolCalls.length} tool call{toolCalls.length !== 1 ? "s" : ""}
        </span>

        {/* Server badges with counts */}
        <div className="flex items-center gap-1 flex-wrap overflow-hidden">
          {Array.from(serverCounts.entries()).map(([label, count]) => (
            <Badge key={label} variant="outline" className="text-xs shrink-0">
              {label}
              {count > 1 ? ` ×${count}` : ""}
            </Badge>
          ))}
        </div>

        {/* Status indicator */}
        <div className="ml-auto shrink-0">
          {isInProgress ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : hasErrors ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
        </div>
      </button>

      {/* Expanded: show individual tool call cards */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t">
          {toolCalls.map((toolCall) => (
            <ToolCallCard key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      )}
    </div>
  );
}

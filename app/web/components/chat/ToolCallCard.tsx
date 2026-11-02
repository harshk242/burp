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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DATABASE_LABELS } from "@/lib/constants";
import type { ToolCall } from "@/types";

interface ToolCallCardProps {
  toolCall: ToolCall;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
    running: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
    complete: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    error: <XCircle className="h-4 w-4 text-destructive" />,
  };

  const serverLabel = DATABASE_LABELS[toolCall.server] || toolCall.server;

  return (
    <Card
      className={cn(
        "overflow-hidden transition-colors",
        toolCall.status === "error" && "border-destructive/50"
      )}
    >
      <CardHeader className="p-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>

          <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {serverLabel}
              </Badge>
              <span className="text-sm font-medium truncate">
                {toolCall.toolName}
              </span>
            </div>
          </div>

          {statusIcon[toolCall.status]}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-3 pt-0 space-y-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Input
            </p>
            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>

          {toolCall.error ? (
            <div>
              <p className="text-xs font-medium text-destructive mb-1">Error</p>
              <pre className="text-xs bg-destructive/10 text-destructive p-2 rounded overflow-x-auto">
                {toolCall.error}
              </pre>
            </div>
          ) : toolCall.output ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Output
              </p>
              <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-48 overflow-y-auto">
                {typeof toolCall.output === "string"
                  ? toolCall.output
                  : JSON.stringify(toolCall.output, null, 2)}
              </pre>
            </div>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

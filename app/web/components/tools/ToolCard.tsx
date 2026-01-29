"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Tool } from "@/types";

interface ToolCardProps {
  tool: Tool;
}

export function ToolCard({ tool }: ToolCardProps) {
  return (
    <Card className={!tool.available ? "opacity-60 border-destructive/50" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium leading-tight">
            {tool.name}
          </CardTitle>
          {tool.available ? (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          ) : (
            <Badge variant="destructive" className="text-xs shrink-0">
              <AlertCircle className="h-3 w-3 mr-1" />
              Unavailable
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs line-clamp-2">
          {tool.description}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

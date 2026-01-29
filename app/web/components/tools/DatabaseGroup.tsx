"use client";

import { AlertCircle } from "lucide-react";
import { ToolCard } from "./ToolCard";
import { DATABASE_DESCRIPTIONS } from "@/lib/constants";
import type { Tool } from "@/types";

interface DatabaseGroupProps {
  name: string;
  server: string;
  tools: Tool[];
}

export function DatabaseGroup({ name, server, tools }: DatabaseGroupProps) {
  // Check if any tools in this group are unavailable (server down)
  const unavailableCount = tools.filter((t) => !t.available).length;
  const isServerDown = unavailableCount === tools.length && tools.length > 0;
  const description = DATABASE_DESCRIPTIONS[server];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">{name}</h2>
          <span className="text-sm text-muted-foreground">
            {tools.length} tools
          </span>
          {isServerDown && (
            <span className="flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              Server unavailable
            </span>
          )}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <ToolCard key={`${tool.server}-${tool.name}`} tool={tool} />
        ))}
      </div>
    </div>
  );
}

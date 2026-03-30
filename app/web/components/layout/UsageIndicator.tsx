"use client";

import { useUserStore } from "@/stores/userStore";
import { useUsage } from "@/hooks/useUsage";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Compact usage indicator for the header.
 * Shows "X / Y" queries with a color-coded bar, or "Unlimited" for admins.
 */
export function UsageIndicator() {
  // Hook triggers fetch on mount and after each stream
  useUsage();

  const usage = useUserStore((s) => s.usage);
  const user = useUserStore((s) => s.user);

  if (!user || !usage) return null;

  // Admin (unlimited)
  if (usage.limit === -1) {
    return (
      <Badge variant="secondary" className="text-xs font-normal">
        Unlimited
      </Badge>
    );
  }

  const pct = usage.limit > 0 ? (usage.used / usage.limit) * 100 : 0;
  const barColor =
    pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-yellow-500" : "bg-primary";

  const resetTime = new Date(usage.resetAt * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 px-2 cursor-default">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {usage.used}/{usage.limit}
          </span>
          <div className="hidden sm:block w-16 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">
          {usage.used} of {usage.limit} queries used today
        </p>
        <p className="text-xs text-muted-foreground">
          Resets at {resetTime}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

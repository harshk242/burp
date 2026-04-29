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
 * Shows daily dollar spend with a color-coded bar, or "Unlimited" for admins.
 */
export function UsageIndicator() {
  // Hook triggers fetch on mount and after each stream
  useUsage();

  const usage = useUserStore((s) => s.usage);
  const user = useUserStore((s) => s.user);

  if (!user || !usage) return null;

  const cost = usage.cost;

  // Admin / unlimited cost budget
  if (cost?.daily_limit_microusd === -1 && cost.monthly_limit_microusd === -1) {
    return (
      <Badge variant="secondary" className="text-xs font-normal">
        Unlimited
      </Badge>
    );
  }

  const queryPct = usage.limit > 0 ? (usage.used / usage.limit) * 100 : 0;
  const tokens = usage.tokens;
  const tokenPct =
    tokens && tokens.limit > 0 ? (tokens.used_today / tokens.limit) * 100 : 0;
  const dailyCostPct =
    cost && cost.daily_limit_microusd > 0
      ? (cost.daily_used_microusd / cost.daily_limit_microusd) * 100
      : 0;
  const monthlyCostPct =
    cost && cost.monthly_limit_microusd > 0
      ? (cost.monthly_used_microusd / cost.monthly_limit_microusd) * 100
      : 0;

  // Color threshold: fire if either quota is close to exhausted
  const worstPct = cost
    ? Math.max(dailyCostPct, monthlyCostPct)
    : Math.max(queryPct, tokens && tokens.limit !== -1 ? tokenPct : 0);
  const barColor =
    worstPct >= 90 ? "bg-destructive" : worstPct >= 70 ? "bg-yellow-500" : "bg-primary";

  const resetTime = new Date(usage.resetAt * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const formatTokens = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const formatUsd = (microusd: number) => {
    if (microusd === -1) return "Unlimited";
    const usd = microusd / 1_000_000;
    return usd < 0.01 && usd > 0 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
  };
  const label = cost
    ? cost.daily_limit_microusd === -1
      ? `${formatUsd(cost.monthly_used_microusd)}/${formatUsd(cost.monthly_limit_microusd)}`
      : `${formatUsd(cost.daily_used_microusd)}/${formatUsd(cost.daily_limit_microusd)}`
    : `${usage.used}/${usage.limit}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 px-2 cursor-default">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {label}
          </span>
          <div className="hidden sm:block w-16 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(worstPct, 100)}%` }}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {cost ? (
          <>
            <p className="text-xs">
              {formatUsd(cost.daily_used_microusd)} of {formatUsd(cost.daily_limit_microusd)} used today
            </p>
            <p className="text-xs">
              {formatUsd(cost.monthly_used_microusd)} of {formatUsd(cost.monthly_limit_microusd)} used this month
            </p>
          </>
        ) : (
          <p className="text-xs">
            {usage.used} of {usage.limit} queries used today
          </p>
        )}
        {cost && (
          <p className="text-xs opacity-75">
            {usage.used} of {usage.limit} queries used today
          </p>
        )}
        {tokens && tokens.limit !== -1 && (
          <p className="text-xs">
            ~{formatTokens(tokens.used_today)} / {formatTokens(tokens.limit)} tokens used today
          </p>
        )}
        <p className="text-xs opacity-75">
          Resets at {resetTime}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

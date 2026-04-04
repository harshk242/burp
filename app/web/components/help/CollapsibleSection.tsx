"use client";

import { ReactNode, useRef } from "react";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function CollapsibleSection({
  summary,
  children,
  defaultOpen = false,
  className = "",
}: CollapsibleSectionProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  return (
    <details
      ref={detailsRef}
      open={defaultOpen}
      className={`group ${className}`}
    >
      <summary className="flex items-center justify-between cursor-pointer list-none select-none">
        <div className="flex-1">{summary}</div>
        <ChevronDown className="h-4 w-4 ml-2 shrink-0 transition-transform duration-200 group-open:rotate-180 text-muted-foreground" />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

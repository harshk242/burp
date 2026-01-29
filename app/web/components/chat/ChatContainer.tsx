"use client";

import { cn } from "@/lib/utils";

interface ChatContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function ChatContainer({ children, className }: ChatContainerProps) {
  return (
    <div className={cn("flex flex-1 flex-col h-full overflow-hidden", className)}>
      {children}
    </div>
  );
}

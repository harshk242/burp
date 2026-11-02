"use client";

import { ClerkProvider } from "@clerk/clerk-react";
import { developmentAuth } from "@/lib/auth";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function ClerkWrapper({ children }: { children: React.ReactNode }) {
  if (developmentAuth) return <>{children}</>;
  if (!publishableKey) throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required for authentication.");
  return <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>;
}

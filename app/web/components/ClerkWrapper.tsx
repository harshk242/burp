"use client";

import { ClerkProvider } from "@clerk/clerk-react";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  console.warn(
    "Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. Authentication will not work."
  );
}

export function ClerkWrapper({ children }: { children: React.ReactNode }) {
  if (!publishableKey) {
    // Render children without Clerk in development if key is missing
    return <>{children}</>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>
  );
}

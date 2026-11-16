"use client";

import { useMounted } from "@/hooks/useMounted";
import { SignUp } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";

export default function SignUpPage() {
  const mounted = useMounted();

  if (!mounted) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="w-full max-w-sm space-y-4 p-6">
          <Skeleton className="h-8 w-3/4 mx-auto" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/30">
      <SignUp
        routing="hash"
        signInUrl="/sign-in"
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "shadow-lg",
          },
        }}
      />
    </main>
  );
}

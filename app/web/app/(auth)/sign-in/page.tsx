"use client";

import { useState, useEffect } from "react";
import { SignIn } from "@clerk/clerk-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function SignInPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
      <SignIn
        routing="hash"
        signUpUrl="/sign-up"
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

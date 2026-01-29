"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Show loading during SSR/initial mount
  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 w-full max-w-md">
          <Skeleton className="h-8 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    );
  }

  return (
    <ProtectedContent
      isSynced={isSynced}
      setIsSynced={setIsSynced}
      syncError={syncError}
      setSyncError={setSyncError}
    >
      {children}
    </ProtectedContent>
  );
}

function ProtectedContent({
  children,
  isSynced,
  setIsSynced,
  syncError,
  setSyncError,
}: {
  children: React.ReactNode;
  isSynced: boolean;
  setIsSynced: (v: boolean) => void;
  syncError: string | null;
  setSyncError: (v: string | null) => void;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { post } = useApi();
  const router = useRouter();

  // Sync user with backend on first load
  useEffect(() => {
    if (isSignedIn && !isSynced) {
      post("/users/sync", {})
        .then(() => setIsSynced(true))
        .catch((err) => {
          console.error("Failed to sync user:", err);
          if (err.message.includes("403") || err.message.includes("waitlist")) {
            setSyncError("waitlist");
          } else {
            setIsSynced(true);
          }
        });
    }
  }, [isSignedIn, isSynced, post, setIsSynced, setSyncError]);

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 w-full max-w-md">
          <Skeleton className="h-8 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 w-full max-w-md">
          <Skeleton className="h-8 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    );
  }

  if (syncError === "waitlist") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center p-8 max-w-md">
          <h1 className="text-2xl font-bold mb-4">Access Pending</h1>
          <p className="text-muted-foreground mb-6">
            Your account is on the waitlist. You&apos;ll receive an email once
            your access has been approved.
          </p>
          <p className="text-sm text-muted-foreground">
            If you believe this is an error, please contact support.
          </p>
        </div>
      </div>
    );
  }

  if (!isSynced) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 w-full max-w-md">
          <Skeleton className="h-8 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

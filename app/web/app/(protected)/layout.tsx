"use client";

import { useState, useEffect } from "react";
import { useAuth, useClerk } from "@clerk/clerk-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { useUserStore } from "@/stores/userStore";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Clock, LogOut } from "lucide-react";
import type { User } from "@/types";

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
  const { signOut } = useClerk();
  const { post } = useApi();
  const router = useRouter();

  // Sync user with backend on first load
  useEffect(() => {
    if (isSignedIn && !isSynced) {
      post<User>("/users/sync", {})
        .then((user) => {
          useUserStore.getState().setUser(user);
          if (user.role === "waitlist") {
            setSyncError("waitlist");
          } else {
            setIsSynced(true);
          }
        })
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
          <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Pending</h1>
          <p className="text-muted-foreground mb-6">
            Your account is on the waitlist. We&apos;ll review your request
            and grant access soon.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Haven&apos;t requested access yet? Submit a request so we can
            review your application.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild>
              <Link href="/request-access">Request Access</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => signOut({ redirectUrl: "/" })}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
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

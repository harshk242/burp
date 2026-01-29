"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, MessageSquare, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useApi } from "@/hooks/useApi";
import type { SessionListResponse } from "@/types";

export function Sidebar() {
  const router = useRouter();
  const { get, post, delete: del } = useApi();
  const {
    sessions,
    activeSessionId,
    isLoading,
    setSessions,
    addSession,
    removeSession,
    setActiveSession,
    setLoading,
  } = useSessionStore();
  const { sidebarOpen, mobileMenuOpen, setMobileMenuOpen } = useUIStore();

  // Fetch sessions on mount
  useEffect(() => {
    async function fetchSessions() {
      setLoading(true);
      try {
        const data = await get<SessionListResponse>("/sessions");
        setSessions(data.sessions);
      } catch (error) {
        console.error("Failed to fetch sessions:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchSessions();
  }, [get, setSessions, setLoading]);

  async function handleNewChat() {
    try {
      const data = await post<{ id: string; title: string }>("/sessions", {});
      const newSession = {
        id: data.id,
        user_id: "",
        title: data.title,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: null,
      };
      addSession(newSession);
      setActiveSession(data.id);
      router.push(`/chat/${data.id}`);
      setMobileMenuOpen(false);
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  }

  async function handleDeleteSession(
    e: React.MouseEvent,
    sessionId: string
  ) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await del(`/sessions/${sessionId}`);
      removeSession(sessionId);
      if (activeSessionId === sessionId) {
        router.push("/chat");
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  }

  const isOpen = sidebarOpen || mobileMenuOpen;

  return (
    <>
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-14 z-40 h-[calc(100vh-3.5rem)] w-64 border-r bg-background transition-transform duration-200 md:relative md:top-0 md:h-full",
          isOpen ? "translate-x-0" : "-translate-x-full md:w-0 md:translate-x-0"
        )}
      >
        <div className="flex h-full flex-col">
          {/* New chat button */}
          <div className="p-4">
            <Button
              onClick={handleNewChat}
              className="w-full justify-start gap-2"
            >
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
          </div>

          <Separator />

          {/* Sessions list */}
          <ScrollArea className="flex-1 px-2">
            <div className="space-y-1 py-2">
              {isLoading ? (
                <>
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </>
              ) : sessions.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  No conversations yet
                </p>
              ) : (
                sessions.map((session) => (
                  <Link
                    key={session.id}
                    href={`/chat/${session.id}`}
                    onClick={() => {
                      setActiveSession(session.id);
                      setMobileMenuOpen(false);
                    }}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
                      activeSessionId === session.id && "bg-accent"
                    )}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">
                      {session.title || "New Chat"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                      onClick={(e) => handleDeleteSession(e, session.id)}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </Link>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </aside>
    </>
  );
}

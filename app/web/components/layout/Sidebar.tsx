"use client";

import { useEffect, useState } from "react";
import { Plus, MessageSquare, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useApi } from "@/hooks/useApi";
import { buildChatUrl } from "@/lib/chatUrl";
import type { SessionListResponse } from "@/types";

export function Sidebar() {
  const { get, patch, delete: del } = useApi();
  const {
    sessions,
    activeSessionId,
    isLoading,
    setSessions,
    removeSession,
    setActiveSession,
    updateSession,
    setLoading,
  } = useSessionStore();
  const { sidebarOpen, mobileMenuOpen, setMobileMenuOpen } = useUIStore();
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

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

  function handleNewChat() {
    setActiveSession(null);
    setMobileMenuOpen(false);
    window.history.pushState(null, "", buildChatUrl());
  }

  function handleStartRename(e: React.MouseEvent, sessionId: string, currentTitle: string) {
    e.preventDefault();
    e.stopPropagation();
    setEditingSessionId(sessionId);
    setEditingTitle(currentTitle || "New Chat");
  }

  async function handleRenameCommit(sessionId: string) {
    const trimmed = editingTitle.trim();
    setEditingSessionId(null);
    if (!trimmed) return;
    const session = sessions.find((s) => s.id === sessionId);
    if (trimmed === (session?.title || "New Chat")) return;
    try {
      await patch(`/sessions/${sessionId}`, { title: trimmed });
      updateSession(sessionId, { title: trimmed });
    } catch (error) {
      console.error("Failed to rename session:", error);
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent, sessionId: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameCommit(sessionId);
    } else if (e.key === "Escape") {
      setEditingSessionId(null);
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
        window.history.pushState(null, "", buildChatUrl());
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  }

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
          "fixed left-0 top-14 z-40 h-[calc(100dvh-3.5rem)] w-64 overflow-hidden border-r bg-background transition-all duration-200 md:relative md:top-0 md:h-full",
          // Mobile: slide in/out based solely on mobileMenuOpen
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: always translate-x-0; collapse width when sidebarOpen is false
          sidebarOpen ? "md:translate-x-0" : "md:w-0 md:translate-x-0"
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
          <ScrollArea className="flex-1 px-2 [&_[data-radix-scroll-area-viewport]>div]:!block [&_[data-radix-scroll-area-viewport]>div]:!min-w-0">
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
                  <a
                    key={session.id}
                    href={buildChatUrl(session.id)}
                    onClick={(e) => {
                      if (editingSessionId === session.id) return;
                      e.preventDefault();
                      setActiveSession(session.id);
                      setMobileMenuOpen(false);
                      window.history.pushState(null, "", buildChatUrl(session.id));
                    }}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-3 py-2 text-sm overflow-hidden hover:bg-accent",
                      activeSessionId === session.id && "bg-accent"
                    )}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {editingSessionId === session.id ? (
                      <input
                        autoFocus
                        className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none border-b border-muted-foreground/40"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => handleRenameCommit(session.id)}
                        onKeyDown={(e) => handleRenameKeyDown(e, session.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <TooltipProvider delayDuration={400}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex-1 min-w-0 truncate">
                                {session.title || "New Chat"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              className="rounded-lg bg-gray-200 text-black border-0 dark:bg-gray-700 dark:text-white"
                            >
                              {session.title || "New Chat"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <div className="flex shrink-0 items-center md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={(e) => handleStartRename(e, session.id, session.title || "")}
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-blue-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={(e) => handleDeleteSession(e, session.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </>
                    )}
                  </a>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </aside>
    </>
  );
}

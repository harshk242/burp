"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { developmentAuth, useAuth } from "@/lib/auth";
import { useChatStore } from "@/stores/chatStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useApi } from "@/hooks/useApi";
import { ChatSessionController } from "@/lib/chat-session-controller";
import { buildChatUrl, extractSessionIdFromLocation } from "@/lib/chatUrl";
import { generateId } from "@/lib/id";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatContainer } from "@/components/chat/ChatContainer";
import { MessageList } from "@/components/chat/MessageList";
import { MessageInput } from "@/components/chat/MessageInput";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { RateLimitError } from "@/types";

interface ChatPageClientProps {
  sessionId: string | null;
}

export function ChatPageClient({ sessionId: _initialSessionId }: ChatPageClientProps) {
  const [mounted, setMounted] = useState(false);

  const initialSessionId = typeof window !== "undefined"
    ? extractSessionIdFromLocation(window.location)
    : _initialSessionId;

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex h-dvh flex-col">
        <div className="sticky top-0 z-50 w-full border-b bg-background/95 h-14">
          <div className="flex h-full items-center px-4">
            <Skeleton className="h-8 w-32" />
            <div className="flex-1" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 border-r hidden md:block">
            <div className="p-4">
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <div className="flex-1 flex flex-col">
            <div className="flex-1 flex items-center justify-center">
              <LoadingSpinner size="lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <ChatPageContent initialSessionId={initialSessionId} />;
}

function ChatPageContent({ initialSessionId }: { initialSessionId: string | null }) {
  const { getToken } = useAuth();
  const { get, post } = useApi();
  const [controller] = useState(() => new ChatSessionController());
  useEffect(() => () => controller.dispose(), [controller]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(initialSessionId);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    message: string;
    resetAt: number;
  } | null>(null);
  const {
    messages,
    isStreaming,
    isLoadingHistory,
    streamingContent,
    pendingToolCalls,
    reasoningSegments,
    error,
  } = useChatStore();
  const { sessions, activeSessionId, addSession, setActiveSession, updateSession } = useSessionStore();

  const sessionTitle =
    sessions.find((s) => s.id === currentSessionId)?.title ?? "Chat";

  const prevActiveRef = useRef(activeSessionId);
  useEffect(() => useSessionStore.subscribe((state) => {
    if (state.activeSessionId !== prevActiveRef.current) controller.dispose();
  }), [controller]);

  useEffect(() => {
    if (prevActiveRef.current !== activeSessionId) {
      controller.dispose();
      setRateLimitInfo(null);
      prevActiveRef.current = activeSessionId;
      setCurrentSessionId(activeSessionId);
    }
  }, [activeSessionId, controller]);

  useEffect(() => {
    const handlePopState = () => {
      const sessionId = extractSessionIdFromLocation(window.location);
      controller.dispose();
      setRateLimitInfo(null);
      setCurrentSessionId(sessionId);
      prevActiveRef.current = sessionId;
      setActiveSession(sessionId);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setActiveSession, controller]);

  useEffect(() => {
    if (currentSessionId) {
      prevActiveRef.current = currentSessionId;
      setActiveSession(currentSessionId);
    }
    if (controller.selected(currentSessionId)) return;
    const work = controller.select(currentSessionId);
    setRateLimitInfo(null);
    void controller.loadHistory(work, get);
  }, [currentSessionId, get, setActiveSession, controller]);

  const handleSend = useCallback(
    async (content: string) => {
      const state = useChatStore.getState();
      if (!controller.selected(currentSessionId) || state.isStreaming || state.isLoadingHistory) return;
      let sessionId = currentSessionId;
      let work = controller.beginTurn(sessionId);

      if (!sessionId) {
        try {
          const data = await post<{ id: string; title: string }>("/sessions", {}, { signal: work.signal });
          const adopted = controller.adoptSession(work, data.id);
          if (!adopted) return;
          work = adopted;
          const newSession = {
            id: data.id,
            user_id: "",
            title: data.title,
            created_at: Math.floor(Date.now() / 1000),
            updated_at: null,
          };
          addSession(newSession);
          setCurrentSessionId(data.id);
          prevActiveRef.current = data.id;
          setActiveSession(data.id);
          window.history.replaceState(null, "", buildChatUrl(data.id));
          sessionId = data.id;
        } catch (err) {
          work.commit((store) => store.setError("Failed to create session"));
          return;
        }
      }

      work.commit((store) => store.addMessage({
        id: generateId(),
        role: "user",
        content,
        createdAt: Date.now(),
      }));

      try {
        const token = await getToken();
        if (!work.isCurrent()) return;
        if (!token && !developmentAuth) throw new Error("Not authenticated");

        setRateLimitInfo(null);
        await controller.stream(work, content, token, (title) => {
          updateSession(sessionId!, { title });
        });
      } catch (err) {
        if (!work.isCurrent()) return;
        if (err instanceof RateLimitError) {
          const resetTime = new Date(err.resetAt * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          });
          const formatUsd = (microusd: number) => `$${(microusd / 1_000_000).toFixed(2)}`;
          const message =
            err.errorCode === "cost_limit_exceeded"
              ? `You've used your dollar budget of ${formatUsd(err.limit)}. Resets at ${resetTime}.`
              : err.errorCode === "token_limit_exceeded"
              ? `You've used your daily token budget of ${err.limit.toLocaleString()} tokens. Resets at ${resetTime}.`
              : `You've used all ${err.limit} queries for today. Resets at ${resetTime}.`;
          setRateLimitInfo({
            message,
            resetAt: err.resetAt,
          });
        } else {
          const errorMsg = err instanceof Error ? err.message : "An error occurred";
          work.commit((store) => store.setError(errorMsg));
        }
      }
    },
    [currentSessionId, getToken, updateSession, post, addSession, setActiveSession, controller]
  );

  return (
    <div className="flex h-dvh flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <ChatContainer>
          <MessageList
            messages={messages}
            streamingContent={streamingContent}
            pendingToolCalls={pendingToolCalls}
            isStreaming={isStreaming}
            reasoningSegments={reasoningSegments}
            sessionTitle={sessionTitle}
          />
          {rateLimitInfo && (
            <div className="px-4 pb-2">
              <div className="max-w-3xl mx-auto">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Daily limit reached</AlertTitle>
                  <AlertDescription>{rateLimitInfo.message}</AlertDescription>
                </Alert>
              </div>
            </div>
          )}
          {error && !rateLimitInfo && (
            <div className="px-4 pb-2">
              <div className="max-w-3xl mx-auto">
                <div className="rounded-lg bg-destructive/10 text-destructive px-4 py-2 text-sm">
                  {error}
                </div>
              </div>
            </div>
          )}
          <MessageInput onSend={handleSend} disabled={isStreaming || isLoadingHistory} />
        </ChatContainer>
      </div>
    </div>
  );
}

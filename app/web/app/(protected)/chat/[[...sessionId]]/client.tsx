"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useChatStore } from "@/stores/chatStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useApi } from "@/hooks/useApi";
import { streamChat } from "@/lib/sse";
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
import type { SessionWithMessagesResponse, Message, ToolCall } from "@/types";

interface ChatPageClientProps {
  sessionId: string | null;
}

export function ChatPageClient({ sessionId: _initialSessionId }: ChatPageClientProps) {
  const [mounted, setMounted] = useState(false);

  // Always resolve session ID from the URL client-side (needed for static export)
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
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(initialSessionId);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    message: string;
    resetAt: number;
  } | null>(null);
  const {
    messages,
    isStreaming,
    streamingContent,
    pendingToolCalls,
    reasoningSegments,
    error,
    setMessages,
    addMessage,
    reset,
    setError,
  } = useChatStore();
  const { sessions, activeSessionId, addSession, setActiveSession, updateSession } = useSessionStore();

  // Resolve the title of the active session for PDF export filenames
  const sessionTitle =
    sessions.find((s) => s.id === currentSessionId)?.title ?? "Chat";

  // Sync session store → local state when sidebar changes the active session.
  // Uses a ref to skip the initial mount (where activeSessionId may be null
  // while currentSessionId is already set from the URL).
  const prevActiveRef = useRef(activeSessionId);
  useEffect(() => {
    if (prevActiveRef.current !== activeSessionId) {
      prevActiveRef.current = activeSessionId;
      setCurrentSessionId(activeSessionId);
    }
  }, [activeSessionId]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const sessionId = extractSessionIdFromLocation(window.location);
      setCurrentSessionId(sessionId);
      setActiveSession(sessionId);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setActiveSession]);

  // Load session messages when session ID changes
  useEffect(() => {
    // When switching to "New Chat" (null), just clear messages
    if (!currentSessionId) {
      reset();
      return;
    }

    setActiveSession(currentSessionId);
    reset(); // Clear previous session's messages

    async function loadMessages() {
      try {
        const data = await get<SessionWithMessagesResponse>(
          `/sessions/${currentSessionId}`
        );

        // Convert DB messages to frontend format
        const convertedMessages: Message[] = data.messages.map((msg) => {
          const tokenUsage =
            msg.role === "assistant" &&
            (msg.input_tokens ?? 0) + (msg.output_tokens ?? 0) > 0
              ? { input: msg.input_tokens ?? 0, output: msg.output_tokens ?? 0 }
              : undefined;
          return {
            id: msg.id,
            role: msg.role,
            content: msg.content || "",
            toolCalls: msg.tool_calls as ToolCall[] | undefined,
            createdAt: msg.created_at * 1000,
            tokenUsage,
            // Load reasoning from DB column (null/undefined → omit field)
            reasoning: msg.reasoning || undefined,
          };
        });

        setMessages(convertedMessages);
      } catch (err) {
        console.error("Failed to load messages:", err);
        setError("Failed to load conversation history");
      }
    }

    loadMessages();
  }, [currentSessionId, get, setActiveSession, reset, setMessages, setError]);

  const handleSend = useCallback(
    async (content: string) => {
      let sessionId = currentSessionId;

      // Lazily create session on first message
      if (!sessionId) {
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
          setCurrentSessionId(data.id);
          setActiveSession(data.id);
          window.history.replaceState(null, "", buildChatUrl(data.id));
          sessionId = data.id;
        } catch (err) {
          setError("Failed to create session");
          return;
        }
      }

      // Add user message immediately
      addMessage({
        id: generateId(),
        role: "user",
        content,
        createdAt: Date.now(),
      });

      try {
        const token = await getToken();
        if (!token) throw new Error("Not authenticated");

        setRateLimitInfo(null);
        await streamChat(sessionId, content, token, (title) => {
          updateSession(sessionId!, { title });
        });
      } catch (err) {
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
          setError(errorMsg);
        }
      }
    },
    [currentSessionId, getToken, addMessage, updateSession, setError, post, addSession, setActiveSession]
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
          <MessageInput onSend={handleSend} disabled={isStreaming} />
        </ChatContainer>
      </div>
    </div>
  );
}

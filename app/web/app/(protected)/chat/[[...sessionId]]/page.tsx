import { ChatPageClient } from "./client";

// For static export - generate base path, handle session IDs client-side
export function generateStaticParams() {
  return [{ sessionId: [] }];
}

export default function ChatPage({
  params,
}: {
  params: { sessionId?: string[] };
}) {
  // Extract session ID from optional catch-all params
  const sessionId = params.sessionId?.[0] || null;
  return <ChatPageClient sessionId={sessionId} />;
}

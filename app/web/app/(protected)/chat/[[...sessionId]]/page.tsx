import { ChatPageClient } from "./client";

// For static export - generate base path, handle session IDs client-side
export function generateStaticParams() {
  return [{ sessionId: [] }];
}

export default function ChatPage() {
  // Session ID is resolved client-side from window.location in ChatPageClient
  return <ChatPageClient sessionId={null} />;
}

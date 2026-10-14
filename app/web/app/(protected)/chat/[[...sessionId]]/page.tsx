import { ChatPageClient } from "./client";

export function generateStaticParams() {
  return [{ sessionId: [] }];
}

export default function ChatPage() {
  return <ChatPageClient sessionId={null} />;
}

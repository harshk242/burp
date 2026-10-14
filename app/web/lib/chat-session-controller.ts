import { useChatStore, type ChatOwner, type ChatState } from "@/stores/chatStore";
import { generateId } from "@/lib/id";
import { dbMessageToMessage } from "@/lib/history";
import { streamChat, type StreamOwner } from "@/lib/sse";
import type { SessionWithMessagesResponse } from "@/types";

export interface SessionWork extends StreamOwner {
  owner: ChatOwner;
}

export class ChatSessionController {
  private work: SessionWork | null = null;
  private abort: AbortController | null = null;

  private claim(sessionId: string | null, turnId: string | null): SessionWork {
    this.abort?.abort();
    const abort = new AbortController();
    const owner = { sessionId, turnId };
    const work: SessionWork = {
      owner,
      signal: abort.signal,
      isCurrent: () => !abort.signal.aborted && useChatStore.getState().owner === owner,
      commit: (commit: (store: ChatState) => void) =>
        !abort.signal.aborted && useChatStore.getState().commitOwned(owner, commit),
    };
    this.abort = abort;
    this.work = work;
    useChatStore.getState().claim(owner);
    return work;
  }

  select(sessionId: string | null): SessionWork {
    this.abort?.abort();
    useChatStore.getState().reset();
    return this.claim(sessionId, null);
  }

  selected(sessionId: string | null): boolean {
    return this.work?.owner.sessionId === sessionId && this.work.isCurrent();
  }

  beginTurn(sessionId: string | null): SessionWork {
    const work = this.claim(sessionId, generateId());
    work.commit((store) => {
      store.setLoadingHistory(false);
      store.resetStreamingState();
      store.setStreaming(true);
    });
    return work;
  }

  adoptSession(work: SessionWork, sessionId: string): SessionWork | null {
    if (!work.isCurrent()) return null;
    return this.claim(sessionId, work.owner.turnId);
  }

  async loadHistory(
    work: SessionWork,
    get: (path: string, options: RequestInit) => Promise<SessionWithMessagesResponse>
  ): Promise<void> {
    if (!work.owner.sessionId) return;
    work.commit((store) => store.setLoadingHistory(true));
    try {
      const data = await get(`/sessions/${work.owner.sessionId}`, { signal: work.signal });
      work.commit((store) => store.setMessages(data.messages.map(dbMessageToMessage)));
    } catch {
      work.commit((store) => store.setError("Failed to load conversation history"));
    } finally {
      work.commit((store) => store.setLoadingHistory(false));
    }
  }

  async stream(work: SessionWork, content: string, token: string, onTitle: (title: string) => void) {
    if (!work.owner.sessionId || !work.isCurrent()) return;
    await streamChat(work.owner.sessionId, content, token, work, onTitle);
  }

  dispose() {
    this.work?.commit((store) => {
      store.setStreaming(false);
      store.setLoadingHistory(false);
    });
    this.abort?.abort();
    this.work = null;
  }
}

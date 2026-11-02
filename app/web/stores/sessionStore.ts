import { create } from "zustand";
import type { Session } from "@/types";

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  isLoading: boolean;

  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((state) => ({ sessions: [session, ...state.sessions] })),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),

  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    })),

  setActiveSession: (id) => set({ activeSessionId: id }),

  setLoading: (isLoading) => set({ isLoading }),
}));

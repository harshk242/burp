import { create } from "zustand";
import type { Tool } from "@/types";

interface ToolState {
  tools: Tool[];
  groupedByServer: Record<string, Tool[]>;
  searchQuery: string;
  isLoading: boolean;

  // Actions
  setTools: (tools: Tool[]) => void;
  setSearchQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;

  // Computed
  filteredTools: () => Tool[];
}

export const useToolStore = create<ToolState>((set, get) => ({
  tools: [],
  groupedByServer: {},
  searchQuery: "",
  isLoading: false,

  setTools: (tools) => {
    const grouped = tools.reduce(
      (acc, tool) => {
        if (!acc[tool.server]) acc[tool.server] = [];
        acc[tool.server].push(tool);
        return acc;
      },
      {} as Record<string, Tool[]>
    );
    set({ tools, groupedByServer: grouped });
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setLoading: (isLoading) => set({ isLoading }),

  filteredTools: () => {
    const { tools, searchQuery } = get();
    if (!searchQuery) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.server.toLowerCase().includes(q)
    );
  },
}));

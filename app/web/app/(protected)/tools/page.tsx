"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToolStore } from "@/stores/toolStore";
import { useApi } from "@/hooks/useApi";
import { DatabaseGroup } from "@/components/tools/DatabaseGroup";
import { DATABASE_LABELS, DATABASE_ORDER } from "@/lib/constants";
import type { ToolListResponse, Tool } from "@/types";

export default function ToolsPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
          <div className="container flex h-14 items-center">
            <Skeleton className="h-8 w-32" />
          </div>
        </header>
        <div className="container py-8">
          <Skeleton className="h-10 w-48 mb-2" />
          <Skeleton className="h-4 w-64 mb-6" />
          <Skeleton className="h-10 w-64 mb-8" />
          <div className="space-y-8">
            <Skeleton className="h-8 w-32" />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <ToolsPageContent />;
}

function ToolsPageContent() {
  const { get } = useApi();
  const {
    groupedByServer,
    searchQuery,
    setTools,
    setSearchQuery,
    filteredTools,
    isLoading,
    setLoading,
  } = useToolStore();

  useEffect(() => {
    async function loadTools() {
      setLoading(true);
      try {
        const data = await get<ToolListResponse>("/tools");
        setTools(data.tools);
      } catch (error) {
        console.error("Failed to load tools:", error);
      } finally {
        setLoading(false);
      }
    }
    loadTools();
  }, [get, setTools, setLoading]);

  const filtered = filteredTools();
  const groupedFiltered = filtered.reduce(
    (acc, tool) => {
      if (!acc[tool.server]) acc[tool.server] = [];
      acc[tool.server].push(tool);
      return acc;
    },
    {} as Record<string, Tool[]>
  );

  const sortedServers = Object.keys(groupedFiltered).sort((a, b) => {
    const aIndex = DATABASE_ORDER.indexOf(a);
    const bIndex = DATABASE_ORDER.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <Button variant="ghost" size="sm" asChild className="mr-4">
            <Link href="/chat">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Chat
            </Link>
          </Button>
        </div>
      </header>

      <div className="container py-8">
        <h1 className="text-3xl font-bold mb-2">Available Tools</h1>
        <p className="text-muted-foreground mb-6">
          210+ tools across 10 biomedical databases. The AI agent automatically
          selects the right tools for your questions.
        </p>

        <div className="relative max-w-md mb-8">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {isLoading ? (
          <div className="space-y-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-4">
                <Skeleton className="h-8 w-48" />
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-12">
            {sortedServers.map((server) => (
              <DatabaseGroup
                key={server}
                name={DATABASE_LABELS[server] || server}
                server={server}
                tools={groupedFiltered[server]}
              />
            ))}

            {sortedServers.length === 0 && searchQuery && (
              <p className="text-center text-muted-foreground py-12">
                No tools found matching &quot;{searchQuery}&quot;
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

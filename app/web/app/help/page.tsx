import { Separator } from "@/components/ui/separator";
import { HelpHero } from "@/components/help/HelpHero";
import { HelpTableOfContents } from "@/components/help/HelpTableOfContents";
import { DatabaseOverviewTable } from "@/components/help/DatabaseOverviewTable";
import { PromptGuide } from "@/components/help/PromptGuide";
import { WorkflowSection } from "@/components/help/WorkflowSection";
import { DatabaseConnectionMap } from "@/components/help/DatabaseConnectionMap";
import { IdMappingReference } from "@/components/help/IdMappingReference";
import { TipsSection } from "@/components/help/TipsSection";
import { LimitationsSection } from "@/components/help/LimitationsSection";

export const metadata = {
  title: "Help & User Guide — BURP",
  description:
    "Learn how to query BURP's 10 biomedical databases effectively. Prompt writing guides, research workflows, database connection maps, and ID mapping reference.",
};

export default function HelpPage() {
  return (
    <main className="min-h-screen">
      {/* Hero banner */}
      <HelpHero />

      {/* Main content — sidebar TOC on desktop, single column on mobile */}
      <div className="container mx-auto px-4 max-w-6xl pb-20">
        <div className="flex gap-12">
          {/* Sticky sidebar TOC (desktop only) */}
          <HelpTableOfContents />

          {/* Page content */}
          <div className="flex-1 min-w-0 space-y-16">
            <DatabaseOverviewTable />

            <Separator />

            <PromptGuide />

            <Separator />

            <WorkflowSection />

            <Separator />

            <DatabaseConnectionMap />

            <Separator />

            <IdMappingReference />

            <Separator />

            <TipsSection />

            <Separator />

            <LimitationsSection />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-8 border-t">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>BURP - Bio Unified Research Platform</p>
        </div>
      </footer>
    </main>
  );
}

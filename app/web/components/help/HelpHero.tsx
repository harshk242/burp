import Link from "next/link";
import { ArrowLeft, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TOC_SECTIONS } from "./helpData";

export function HelpHero() {
  return (
    <section className="relative overflow-hidden py-16 sm:py-20">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/5 to-transparent" />
      <div className="container mx-auto px-4">
        {/* Back link */}
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/" className="flex items-center gap-2 text-muted-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Link>
          </Button>
        </div>

        {/* Title */}
        <div className="flex flex-col items-start gap-3 mb-6">
          <div className="flex items-center gap-3">
            <HelpCircle className="h-8 w-8 text-primary" />
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Help & User Guide</h1>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Learn how to query BURP&apos;s 10 biomedical databases effectively. This guide covers
            database capabilities, prompt writing strategies, research workflows, and how databases
            connect.
          </p>
        </div>

        {/* Quick-link badges */}
        <div className="flex flex-wrap gap-2">
          {TOC_SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              <Badge
                variant="secondary"
                className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                {section.label}
              </Badge>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

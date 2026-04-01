"use client";

import { useState, useEffect } from "react";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Image from "next/image";
import {
  Database,
  MessageSquare,
  Sparkles,
  ArrowRight,
} from "lucide-react";

const databases = [
  { name: "UniProt", description: "Protein sequences & annotations" },
  { name: "ChEMBL", description: "Drug compounds & bioactivity" },
  { name: "PubChem", description: "Chemical structures & properties" },
  { name: "Ensembl", description: "Genomic data & annotations" },
  { name: "ClinVar", description: "Clinical variants" },
  { name: "Open Targets", description: "Drug-target associations" },
  { name: "Reactome", description: "Biological pathways" },
  { name: "ClinicalTrials", description: "Trial registrations" },
  { name: "PubMed", description: "Biomedical literature" },
  { name: "ClinPGx", description: "Pharmacogenomics" },
];

export default function HomePage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Render auth-conditional content only after mounting
  const AuthButtons = () => {
    if (!mounted) {
      // Show both buttons during SSR/build
      return (
        <>
          <Button asChild size="lg">
            <Link href="/sign-in">
              Sign In
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href="/request-access">Request Access</Link>
          </Button>
        </>
      );
    }

    return (
      <>
        <SignedOut>
          <Button asChild size="lg">
            <Link href="/sign-in">
              Sign In
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href="/request-access">Request Access</Link>
          </Button>
        </SignedOut>

        <SignedIn>
          <Button asChild size="lg">
            <Link href="/chat">
              <MessageSquare className="mr-2 h-4 w-4" />
              Start Chatting
            </Link>
          </Button>
        </SignedIn>
      </>
    );
  };

  const CTAButton = () => {
    if (!mounted) {
      return (
        <Button asChild size="lg">
          <Link href="/request-access">Request Access</Link>
        </Button>
      );
    }

    return (
      <>
        <SignedOut>
          <Button asChild size="lg">
            <Link href="/request-access">Request Access</Link>
          </Button>
        </SignedOut>
        <SignedIn>
          <Button asChild size="lg">
            <Link href="/chat">Go to Chat</Link>
          </Button>
        </SignedIn>
      </>
    );
  };

  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 sm:py-32">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/5 to-transparent" />
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center text-center">
            <div className="flex flex-col items-center gap-4 mb-6">
              <Image src="/burp-logo.png" alt="BURP" width={96} height={96} className="rounded-lg" />
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
                BURP
              </h1>
            </div>
            <p className="text-lg text-muted-foreground mb-2">
              Bio Unified Research Platform
            </p>

            <p className="text-xl text-muted-foreground max-w-2xl mb-8">
              Query 10 biomedical databases with natural language. Proteins, drugs,
              genes, variants, pathways, clinical trials, and literature - all
              through one intelligent interface.
            </p>

            <div className="flex flex-wrap justify-center gap-4">
              <AuthButtons />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-12">
            Why BURP?
          </h2>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <Card>
              <CardContent className="pt-6">
                <Database className="h-10 w-10 text-primary mb-4" />
                <h3 className="font-semibold mb-2">10 Databases, One Interface</h3>
                <p className="text-sm text-muted-foreground">
                  Access UniProt, ChEMBL, Ensembl, and 7 more databases without
                  switching tabs or learning different query languages.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <MessageSquare className="h-10 w-10 text-primary mb-4" />
                <h3 className="font-semibold mb-2">Natural Language Queries</h3>
                <p className="text-sm text-muted-foreground">
                  Ask questions in plain English. No need to learn complex query
                  syntax or database-specific APIs.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <Sparkles className="h-10 w-10 text-primary mb-4" />
                <h3 className="font-semibold mb-2">Intelligent Cross-Referencing</h3>
                <p className="text-sm text-muted-foreground">
                  Automatically links data across databases. Find gene to protein
                  to drug to clinical trial connections.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Databases */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-4">
            Connected Databases
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
            210+ specialized tools across 10 biomedical databases, ready to answer
            your research questions.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 max-w-4xl mx-auto">
            {databases.map((db) => (
              <Card key={db.name} className="text-center">
                <CardContent className="p-4">
                  <p className="font-medium text-sm">{db.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {db.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-primary/5">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold mb-4">Ready to accelerate your research?</h2>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto">
            Join researchers who are saving hours by querying multiple databases
            with natural language.
          </p>
          <CTAButton />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>BURP - Bio Unified Research Platform</p>
        </div>
      </footer>
    </main>
  );
}

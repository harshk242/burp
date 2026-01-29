import type { Metadata } from "next";
import { ClerkWrapper } from "@/components/ClerkWrapper";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Super Bio Agent",
  description:
    "Query 10 biomedical databases with natural language. Proteins, drugs, genes, variants, pathways, trials, and literature.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <ClerkWrapper>
          <TooltipProvider>{children}</TooltipProvider>
        </ClerkWrapper>
      </body>
    </html>
  );
}

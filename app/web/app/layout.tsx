import type { Metadata, Viewport } from "next";
import { ClerkWrapper } from "@/components/ClerkWrapper";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "BURP",
  description:
    "Query 10 biomedical databases with natural language. Proteins, drugs, genes, variants, pathways, trials, and literature.",
  icons: {
    icon: "/burp-logo.png",
    apple: "/burp-logo.png",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
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

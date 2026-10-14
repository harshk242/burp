"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/clerk-react";
import Image from "next/image";
import { Menu, Wrench, Shield, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useUserStore } from "@/stores/userStore";
import { UsageIndicator } from "@/components/layout/UsageIndicator";

export function Header() {
  const { toggleSidebar, toggleMobileMenu } = useUIStore();
  const user = useUserStore((s) => s.user);
  const pathname = usePathname();
  const hasSidebar = !pathname.startsWith("/admin");

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center px-4">
        {hasSidebar && (
          <Button
            variant="ghost"
            size="icon"
            className="mr-2 md:hidden"
            onClick={toggleMobileMenu}
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle menu</span>
          </Button>
        )}

        {hasSidebar && (
          <Button
            variant="ghost"
            size="icon"
            className="mr-2 hidden md:flex"
            onClick={toggleSidebar}
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle sidebar</span>
          </Button>
        )}

        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image src="/burp-logo.png" alt="BURP" width={28} height={28} className="rounded-sm" />
          <span className="hidden sm:inline">BURP</span>
        </Link>

        <div className="flex-1" />

        <nav className="flex items-center gap-2">
          {pathname.startsWith("/admin") ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/chat" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                <span className="hidden sm:inline">Chat</span>
              </Link>
            </Button>
          ) : (
            user?.role === "admin" && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/admin" className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  <span className="hidden sm:inline">Admin</span>
                </Link>
              </Button>
            )
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/tools" className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              <span className="hidden sm:inline">Tools</span>
            </Link>
          </Button>
          <UsageIndicator />
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: "h-8 w-8",
              },
            }}
          />
        </nav>
      </div>
    </header>
  );
}

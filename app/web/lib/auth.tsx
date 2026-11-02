"use client";

import * as Clerk from "@clerk/clerk-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const developmentAuth = process.env.NEXT_PUBLIC_AUTH_MODE === "development" && process.env.NODE_ENV !== "production";
const developmentSession = { isLoaded: true, isSignedIn: true, getToken: async () => null };
const developmentClerk = { signOut: async (options?: { redirectUrl?: string }) => { window.location.assign(options?.redirectUrl || "/"); } };

export function useAuth() {
  if (developmentAuth) return developmentSession;
  return Clerk.useAuth();
}

export function useClerk() {
  if (developmentAuth) return developmentClerk;
  return Clerk.useClerk();
}

export function SignedIn({ children }: { children: ReactNode }) {
  return developmentAuth ? <>{children}</> : <Clerk.SignedIn>{children}</Clerk.SignedIn>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  return developmentAuth ? null : <Clerk.SignedOut>{children}</Clerk.SignedOut>;
}

export function UserButton(props: ComponentProps<typeof Clerk.UserButton>) {
  return developmentAuth ? <span>Development user</span> : <Clerk.UserButton {...props} />;
}

export function SignIn(props: ComponentProps<typeof Clerk.SignIn>) {
  return developmentAuth ? <Link href="/chat">Continue as development user</Link> : <Clerk.SignIn {...props} />;
}

export function SignUp(props: ComponentProps<typeof Clerk.SignUp>) {
  return developmentAuth ? <Link href="/chat">Continue as development user</Link> : <Clerk.SignUp {...props} />;
}

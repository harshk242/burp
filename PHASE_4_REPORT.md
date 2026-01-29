# Phase 4: After implementation report

## Overview
● Phase 4b is complete. The static export is ready in app/web/out/.

  Regarding the Clerk documentation you mentioned:

  I ended up using @clerk/clerk-react instead of @clerk/nextjs because:
  1. @clerk/nextjs v6 uses Server Actions internally, which are not compatible with Next.js static export (output: 'export')
  2. @clerk/clerk-react is the pure client-side React SDK that works perfectly with static exports

  The key pattern I used:
  - ClerkProvider wrapped in a client component (ClerkWrapper.tsx)
  - All pages that use Clerk hooks render a skeleton during SSR/build, then show actual content after mounting
  - This allows the build to succeed without Clerk keys, which are only needed at runtime

  Summary of Phase 4b implementation:
  ┌──────────────────────────┬────────┐
  │        Component         │ Status │
  ├──────────────────────────┼────────┤
  │ Next.js project setup    │ Done   │
  ├──────────────────────────┼────────┤
  │ Tailwind + shadcn/ui     │ Done   │
  ├──────────────────────────┼────────┤
  │ Clerk auth (client-side) │ Done   │
  ├──────────────────────────┼────────┤
  │ Zustand stores           │ Done   │
  ├──────────────────────────┼────────┤
  │ API client + SSE handler │ Done   │
  ├──────────────────────────┼────────┤
  │ Layout (Header, Sidebar) │ Done   │
  ├──────────────────────────┼────────┤
  │ Chat components          │ Done   │
  ├──────────────────────────┼────────┤
  │ All pages                │ Done   │
  ├──────────────────────────┼────────┤
  │ Static export build      │ Done   │
  └──────────────────────────┴────────┘

  Output structure:
  app/web/out/
  ├── index.html       # Landing page
  ├── chat/            # Chat interface
  ├── tools/           # Tool browser
  ├── sign-in/         # Auth pages
  ├── sign-up/
  ├── request-access/  # Waitlist form
  └── _next/           # JS/CSS bundles

  To run locally:
  cd app/web
  echo "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_..." > .env.local
  bun run dev

  To integrate with the server:
  The static output in app/web/out/ can be copied to app/public/ and served by Hono. Would you like me to update the Dockerfile or any integration configuration?

## Summary of problems
● Detailed Summary of Problems Faced During Phase 4b Implementation

  1. Next.js Config File Extension Issue

  Problem: Created next.config.ts but Next.js 14.2 doesn't support TypeScript config files.

  Error:
  Error: Configuring Next.js via 'next.config.ts' is not supported.
  Please replace the file with 'next.config.js' or 'next.config.mjs'.

  Solution: Renamed to next.config.mjs and converted TypeScript syntax to plain JavaScript with JSDoc type annotations.

  ---
  2. Dynamic Routes with Static Export - generateStaticParams Required

  Problem: Used dynamic routes like [sessionId] and [[...sign-in]] for Clerk auth pages. Static export requires generateStaticParams()
   for all dynamic routes.

  Error:
  Error: Page "/sign-in/[[...sign-in]]" is missing "generateStaticParams()"
  so it cannot be used with "output: export" config.

  Solution: Added generateStaticParams() to return empty arrays or base paths:
  export function generateStaticParams() {
    return [{ "sign-in": [] }];
  }

  ---
  3. Client Components Cannot Export generateStaticParams

  Problem: Pages with "use client" directive cannot export generateStaticParams() - it's a server-side function.

  Error:
  Error: Page "/(protected)/chat/[sessionId]/page" cannot use both
  "use client" and export function "generateStaticParams()".

  Solution: Split into two files:
  - page.tsx - Server component that exports generateStaticParams() and renders the client component
  - client.tsx - Client component with all the React hooks and interactivity

  // page.tsx (server)
  export function generateStaticParams() { return []; }
  export default function Page({ params }) {
    return <ClientComponent sessionId={params.sessionId} />;
  }

  // client.tsx
  "use client";
  export function ClientComponent({ sessionId }) { ... }

  ---
  4. Server Actions Not Supported with Static Export

  Problem: @clerk/nextjs v6 uses Server Actions internally for its components (SignIn, SignUp, etc.). Static export doesn't support
  Server Actions.

  Error:
  > Server Actions are not supported with static export.

  Solution: Switched from @clerk/nextjs to @clerk/clerk-react:
  // Before
  "@clerk/nextjs": "^6.10.0"

  // After
  "@clerk/clerk-react": "^5.18.0"

  This required updating all imports:
  // Before
  import { useAuth, SignIn } from "@clerk/nextjs";

  // After
  import { useAuth, SignIn } from "@clerk/clerk-react";

  ---
  5. Clerk Components Require ClerkProvider During Build

  Problem: Even after switching to @clerk/clerk-react, the Clerk components (SignIn, SignUp, useAuth) throw errors during static page
  generation because ClerkProvider isn't available at build time.

  Error:
  Error: @clerk/clerk-react: SignIn can only be used within the
  <ClerkProvider /> component.

  Cause: During next build, Next.js pre-renders pages. Clerk components try to access the ClerkProvider context, which doesn't exist
  during build (no NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).

  Solution: Implemented a "mounted" pattern - render a skeleton during SSR/build, only render Clerk components after client-side
  mounting:

  "use client";

  export default function SignInPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
      setMounted(true);
    }, []);

    // During SSR/build, render skeleton (no Clerk components)
    if (!mounted) {
      return (
        <main>
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-10 w-full" />
        </main>
      );
    }

    // After mounting on client, render actual Clerk component
    return (
      <main>
        <SignIn routing="hash" />
      </main>
    );
  }

  Applied this pattern to:
  - /sign-in/page.tsx
  - /sign-up/page.tsx
  - /page.tsx (landing page with SignedIn/SignedOut)
  - /(protected)/layout.tsx
  - /(protected)/chat/[[...sessionId]]/client.tsx
  - /(protected)/tools/page.tsx

  ---
  6. ClerkProvider in Root Layout During SSR

  Problem: ClerkProvider in root layout also caused issues because it needs the publishable key.

  Solution: Created a ClerkWrapper client component that gracefully handles missing keys:

  // components/ClerkWrapper.tsx
  "use client";

  import { ClerkProvider } from "@clerk/clerk-react";

  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  export function ClerkWrapper({ children }: { children: React.ReactNode }) {
    if (!publishableKey) {
      console.warn("Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
      return <>{children}</>;  // Render without Clerk during build
    }

    return (
      <ClerkProvider publishableKey={publishableKey}>
        {children}
      </ClerkProvider>
    );
  }

  ---
  7. Optional Catch-All Route for Chat Sessions

  Problem: Needed /chat to work both as a base route and with session IDs (/chat/abc-123). Standard [sessionId] dynamic route doesn't
  match the base /chat path.

  Solution: Used optional catch-all route [[...sessionId]]:
  app/(protected)/chat/[[...sessionId]]/
  ├── page.tsx      # Server component with generateStaticParams
  └── client.tsx    # Client component with chat logic

  The optional catch-all:
  - Matches /chat → params.sessionId = []
  - Matches /chat/abc-123 → params.sessionId = ["abc-123"]

  ---
  Summary Table
  ┌─────┬────────────────────────────────────────┬───────────────────────────────────┬─────────────────────────────────────┐
  │  #  │                Problem                 │            Root Cause             │              Solution               │
  ├─────┼────────────────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────┤
  │ 1   │ .ts config not supported               │ Next.js 14.2 limitation           │ Use .mjs                            │
  ├─────┼────────────────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────┤
  │ 2   │ Missing generateStaticParams           │ Static export requirement         │ Add function to dynamic routes      │
  ├─────┼────────────────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────┤
  │ 3   │ Client + generateStaticParams conflict │ Next.js architecture              │ Split into server/client files      │
  ├─────┼────────────────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────┤
  │ 4   │ Server Actions not supported           │ @clerk/nextjs uses Server Actions │ Switch to @clerk/clerk-react        │
  ├─────┼────────────────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────┤
  │ 5   │ Clerk components fail at build         │ No ClerkProvider during SSR       │ "mounted" pattern with skeleton     │
  ├─────┼────────────────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────┤
  │ 6   │ ClerkProvider needs key at build       │ SSR tries to render Clerk         │ Conditional wrapper component       │
  ├─────┼────────────────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────┤
  │ 7   │ Need /chat and /chat/[id]              │ Route matching                    │ Optional catch-all [[...sessionId]] │
  └─────┴────────────────────────────────────────┴───────────────────────────────────┴─────────────────────────────────────┘
  ---
  Key Takeaways for Static Export + Clerk

  1. Use @clerk/clerk-react instead of @clerk/nextjs for static export
  2. Always use "mounted" pattern for any component using Clerk hooks
  3. Split dynamic route pages into server (generateStaticParams) and client (hooks) files
  4. ClerkProvider must handle missing keys gracefully during build
  5. Clerk's routing="hash" is recommended for static sites to handle auth flows client-side

import { expect, it } from "bun:test";
import { fileURLToPath } from "url";

it("renders development auth consumers without a Clerk provider", async () => {
  const child = Bun.spawn([process.execPath, "-e", `
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const auth = await import('./lib/auth');
    const { ClerkWrapper } = await import('./components/ClerkWrapper');
    function Consumer() {
      const session = auth.useAuth();
      const clerk = auth.useClerk();
      if (!session.isLoaded || !session.isSignedIn || !clerk.signOut) throw new Error('missing development session');
      return React.createElement('span', null, 'development session');
    }
    const html = renderToStaticMarkup(React.createElement(ClerkWrapper, null,
      React.createElement(Consumer),
      React.createElement(auth.SignedIn, null, 'signed in'),
      React.createElement(auth.SignedOut, null, 'signed out'),
      React.createElement(auth.UserButton),
      React.createElement(auth.SignIn), React.createElement(auth.SignUp),
    ));
    if (await auth.useAuth().getToken() !== null) throw new Error('unexpected development token');
    console.log(html);
  `], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, NODE_ENV: "development", NEXT_PUBLIC_AUTH_MODE: "development", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "" },
    stdout: "pipe", stderr: "pipe",
  });
  const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(exit, error).toBe(0);
  expect(output).toContain("development session");
  expect(output).toContain("signed in");
  expect(output).not.toContain("signed out");
  expect(output).toContain("Development user");
  expect(output).toContain("Continue as development user");
});

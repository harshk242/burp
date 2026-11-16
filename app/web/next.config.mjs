import { resolveWebAuthConfig } from "./lib/auth-config.mjs";

const rawOrigins =
  process.env.CORS_ORIGINS ||
  "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001";

// Next.js matches allowedDevOrigins against the request origin's hostname only,
// so strip scheme and port (e.g. "http://100.x.y.z:3001" -> "100.x.y.z").
/** @param {string} origin */
const toHostname = (origin) => {
  try {
    return new URL(origin.includes("://") ? origin : `http://${origin}`).hostname;
  } catch {
    return "";
  }
};

const allowedDevOrigins = [
  ...new Set(
    rawOrigins
      .split(",")
      .map((o) => toHostname(o.trim()))
      .filter(Boolean),
  ),
];

const config = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  allowedDevOrigins,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

/** @param {string} phase */
export default (phase) => {
  const auth = resolveWebAuthConfig(process.env, phase === "phase-production-build" || process.env.NODE_ENV === "production");
  return {
    ...config,
    experimental: { externalDir: true },
    env: {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: auth.publishableKey,
      NEXT_PUBLIC_AUTH_MODE: auth.development ? "development" : "clerk",
    },
  };
};

/** @type {import('next').NextConfig} */

// Derive allowed dev origins from CORS_ORIGINS (strip scheme) so there's a
// single source of truth in the env file. Falls back to localhost defaults.
const rawOrigins =
  process.env.CORS_ORIGINS ||
  "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001";

const allowedDevOrigins = rawOrigins
  .split(",")
  .map((o) => o.trim().replace(/^https?:\/\//, ""))
  .filter(Boolean);

const config = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  allowedDevOrigins,
  // Skip type checking during build (handled by IDE/pre-commit)
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default config;

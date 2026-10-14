/** @type {import('next').NextConfig} */

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
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default config;

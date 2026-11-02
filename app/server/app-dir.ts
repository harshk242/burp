import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Single anchor for on-disk app paths. It must live directly in server/ so it resolves to the
// same directory from source (server/app-dir.ts) and from the production bundle (server/index.js,
// see the build:server script). Derive every other runtime path from APP_DIR, never from
// import.meta in a nested module: bundling collapses all modules into the bundle's location.
export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Database initialization script
 * Run with: bun run db:init
 */
import { initializeSchema } from "./index";

console.log("Initializing database...");
initializeSchema();
console.log("Done!");

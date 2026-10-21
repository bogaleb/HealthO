import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Load the repo-root .env (if present) for CLI scripts. Next.js loads env itself. */
export function loadRootEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, "../../../.env");
  if (existsSync(file) && typeof process.loadEnvFile === "function") process.loadEnvFile(file);
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  return url;
}

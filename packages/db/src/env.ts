import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Load the repo-root .env (if present) for CLI scripts. Next.js loads env itself. */
export function loadRootEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, "../../../.env");
  if (existsSync(file) && typeof process.loadEnvFile === "function") process.loadEnvFile(file);
}

/**
 * DATABASE_URL, or (cloud deployments) a URL composed from DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD so the
 * password can come from the RDS-managed Secrets Manager secret without ever being written into a URL by an operator.
 * DB_SSLMODE defaults to verify-full in that mode (the image ships the RDS CA bundle via NODE_EXTRA_CA_CERTS).
 */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.DB_HOST && env.DB_USER && env.DB_PASSWORD) {
    const u = new URL(`postgresql://${env.DB_HOST}:${env.DB_PORT ?? "5432"}/${env.DB_NAME ?? "projectos"}`);
    u.username = encodeURIComponent(env.DB_USER);
    u.password = encodeURIComponent(env.DB_PASSWORD);
    u.searchParams.set("sslmode", env.DB_SSLMODE ?? "verify-full");
    return u.toString();
  }
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

/** True when the calling module is the process entry point (works with Windows paths too). */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return metaUrl === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

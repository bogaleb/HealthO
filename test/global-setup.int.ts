import postgres from "postgres";
import { loadRootEnv } from "@projectos/db";
import { runMigrations } from "../packages/db/src/migrate";

/** Wipes and re-migrates the dedicated TEST database once per run. Refuses to touch DATABASE_URL. */
export default async function setup() {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for integration tests.");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL (tests wipe it).");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await sql.end();
  await runMigrations(url);
}

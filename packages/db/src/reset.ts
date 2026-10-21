import postgres from "postgres";
import { databaseUrl, loadRootEnv } from "./env";
import { appMode, isSyntheticMode } from "@projectos/shared";

/** Drops and recreates the public schema. Refuses outside synthetic modes. */
async function main() {
  loadRootEnv();
  if (!isSyntheticMode(appMode())) throw new Error(`Refusing to reset database in APP_MODE=${appMode()}`);
  const sql = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await sql.end();
  console.log(JSON.stringify({ level: "info", msg: "database reset" }));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

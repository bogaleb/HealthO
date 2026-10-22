import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, isMain, loadRootEnv } from "./index";

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function runMigrations(url?: string, migrationsFolder = MIGRATIONS_DIR) {
  const { sql, db } = createDb(url, 1);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  runMigrations()
    .then(() => console.log(JSON.stringify({ level: "info", msg: "migrations applied" })))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

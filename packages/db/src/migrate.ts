import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, loadRootEnv } from "./index";

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function runMigrations(url?: string) {
  const { sql, db } = createDb(url, 1);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadRootEnv();
  runMigrations()
    .then(() => console.log(JSON.stringify({ level: "info", msg: "migrations applied" })))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

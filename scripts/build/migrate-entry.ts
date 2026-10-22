// Migration runner for the release image: applies packages/db/migrations (copied next to the bundle) and exits.
// Run as a one-off release step BEFORE new web/worker tasks start (see docs/ops/RELEASE_RUNBOOK.md).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@projectos/db";

const folder = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");
const { sql, db } = createDb(undefined, 1);
migrate(db, { migrationsFolder: folder })
  .then(() => console.log(JSON.stringify({ level: "info", msg: "migrations applied" })))
  .catch((e: unknown) => {
    console.error(JSON.stringify({ level: "error", msg: "migration failed", err: e instanceof Error ? e.message : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => sql.end());

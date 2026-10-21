import { createDb, loadRootEnv } from "@projectos/db";
import { JOB_HANDLERS, enqueueJob, recoverStaleJobs, runDueJobs } from "@projectos/core";
import { runCredentialDeadlines } from "@projectos/credentialing";
import { logger, todayIn } from "@projectos/shared";

/**
 * ProjectOS worker: polls the Postgres job table. No Redis required.
 * - Every tick: enqueue today's recurring-task generation (deduped by date key), recover stale locks, run due jobs.
 * - `--once` runs a single tick and exits (used by tests/cron).
 */
loadRootEnv();
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 30_000);
const once = process.argv.includes("--once");
const { db, sql } = createDb(undefined, 3);
// Credential expiry + 90/60/30-day renewal tasks (idempotent; safe to run repeatedly).
JOB_HANDLERS["credentialing.deadlines"] = (d, p) => runCredentialDeadlines(d, { organizationId: typeof p.organizationId === "string" ? p.organizationId : undefined });
let stopping = false;

async function tick() {
  const day = todayIn("America/New_York");
  // Hourly key so newly-created definitions are picked up the same day; generator itself is idempotent.
  const hour = new Date().toISOString().slice(0, 13);
  await enqueueJob(db, "recurring.generate", `recurring.generate:${day}:${hour}`);
  await enqueueJob(db, "credentialing.deadlines", `credentialing.deadlines:${day}`);
  const recovered = await recoverStaleJobs(db);
  const ran = await runDueJobs(db);
  if (ran || recovered) logger.info("worker.tick", { ran, recovered });
}

async function main() {
  logger.info("worker.start", { pollMs: POLL_MS, once });
  do {
    try {
      await tick();
    } catch (e) {
      logger.error("worker.tick_failed", { err: e instanceof Error ? e.name : "unknown" });
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  } while (!stopping);
  await sql.end();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    logger.info("worker.stopping", { sig });
  });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

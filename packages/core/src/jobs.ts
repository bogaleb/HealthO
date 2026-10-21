import { hostname } from "node:os";
import { sql } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { jobs } from "@projectos/db/schema";
import { logger } from "@projectos/shared";
import { generateRecurringTasks } from "./projects/recurring";

type Handler = (db: Db, payload: Record<string, unknown>) => Promise<unknown>;

/** Registry of job types. Handlers must be idempotent: a job may run more than once after a crash. */
export const JOB_HANDLERS: Record<string, Handler> = {
  "recurring.generate": (db, p) => generateRecurringTasks(db, { organizationId: typeof p.organizationId === "string" ? p.organizationId : undefined }),
};

/** Enqueue with a dedupe key; a second enqueue with the same key is a no-op. */
export async function enqueueJob(db: Db, type: string, idempotencyKey: string, payload: Record<string, unknown> = {}, runAt = new Date()) {
  const r = await db.insert(jobs).values({ type, idempotencyKey, payload, runAt }).onConflictDoNothing().returning({ id: jobs.id });
  return r[0]?.id ?? null;
}

/**
 * Claim and run up to `limit` due jobs. Uses FOR UPDATE SKIP LOCKED so multiple workers never
 * run the same job; failed jobs retry with exponential backoff and become DEAD after max attempts.
 */
export async function runDueJobs(db: Db, limit = 10, workerId = `${hostname()}:${process.pid}`) {
  let ran = 0;
  for (let i = 0; i < limit; i++) {
    const claimed = await db.execute<{ id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }>(sql`
      update jobs set status = 'RUNNING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
      where id = (
        select id from jobs where status in ('PENDING','FAILED') and run_at <= now()
        order by run_at for update skip locked limit 1
      ) returning id, type, payload, attempts, max_attempts`);
    const job = claimed[0];
    if (!job) break;
    ran++;
    const handler = JOB_HANDLERS[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      const result = await handler(db, job.payload ?? {});
      await db.execute(sql`update jobs set status = 'DONE', completed_at = now(), last_error = null where id = ${job.id}`);
      logger.info("job.done", { jobId: job.id, type: job.type, result: result as Record<string, unknown> });
    } catch (e) {
      const dead = job.attempts >= job.max_attempts;
      const delaySec = Math.min(3600, 2 ** job.attempts * 15);
      const msg = e instanceof Error ? e.message.slice(0, 500) : "unknown error";
      await db.execute(sql`update jobs set status = ${dead ? "DEAD" : "FAILED"}, last_error = ${msg},
        run_at = now() + make_interval(secs => ${delaySec}) where id = ${job.id}`);
      logger.warn("job.failed", { jobId: job.id, type: job.type, attempts: job.attempts, dead });
    }
  }
  return ran;
}

/** Release jobs stuck in RUNNING (worker crashed) so they are retried. */
export async function recoverStaleJobs(db: Db, staleMinutes = 15) {
  const r = await db.execute(sql`update jobs set status = 'FAILED', last_error = 'recovered after stale lock'
    where status = 'RUNNING' and locked_at < now() - make_interval(mins => ${staleMinutes}) returning id`);
  return r.length;
}

import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@projectos/db";
import { jobs, notifications, outboxEvents } from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import { audit, authorize, parse } from "@projectos/core";
import { AppError, logger, notFound, notificationRead, type NotificationKind } from "@projectos/shared";

/**
 * Phase 6 internal notifications through a Postgres transactional outbox.
 *
 *  domain transaction ──insert──▶ outbox_events (PENDING, unique dedupe key)
 *  worker tick ──claim (SKIP LOCKED)──▶ deliver = insert notifications ON CONFLICT DO NOTHING ──▶ DONE
 *
 * Delivery is idempotent (unique (org, user, dedupe_key) on notifications), so a crash between "delivered"
 * and "marked DONE", a retry, or a manual replay never produces a duplicate. In-app inbox only: no SMS/email.
 */

export interface NotificationInput {
  organizationId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** Relative in-app path only. */
  link?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  /** Stable key for this fact, e.g. `rcm.overdue:<caseId>:<dueDate>`. */
  dedupeKey: string;
}

export const OUTBOX_NOTIFY = "notification.create";

/** Write a notification request to the outbox (call inside the domain transaction). Duplicate keys are ignored. */
export async function enqueueNotification(db: DbOrTx, n: NotificationInput) {
  if (n.link && !/^\/[A-Za-z0-9/_?=&.-]*$/.test(n.link)) throw new Error("Notification links must be relative in-app paths.");
  const r = await db
    .insert(outboxEvents)
    .values({ organizationId: n.organizationId, type: OUTBOX_NOTIFY, dedupeKey: `notify:${n.userId}:${n.dedupeKey}`, payload: { ...n } })
    .onConflictDoNothing()
    .returning({ id: outboxEvents.id });
  return r[0]?.id ?? null;
}

type OutboxRow = typeof outboxEvents.$inferSelect;
export type Deliverer = (db: Db, ev: OutboxRow) => Promise<void>;

/** Default deliverer: in-app inbox row, idempotent per (org, user, dedupe key). */
export const deliverInApp: Deliverer = async (db, ev) => {
  if (ev.type !== OUTBOX_NOTIFY) throw new Error(`No deliverer for outbox type ${ev.type}`);
  const p = ev.payload as Partial<NotificationInput>;
  if (!p.userId || !p.kind || !p.title || !p.dedupeKey) throw new Error("Malformed notification payload");
  await db
    .insert(notifications)
    .values({
      organizationId: ev.organizationId,
      userId: p.userId,
      kind: p.kind,
      title: p.title,
      body: p.body ?? null,
      link: p.link ?? null,
      resourceType: p.resourceType ?? null,
      resourceId: p.resourceId ?? null,
      dedupeKey: p.dedupeKey,
    })
    .onConflictDoNothing();
};

/**
 * Claim and deliver due outbox events. FOR UPDATE SKIP LOCKED so concurrent workers never take the same row;
 * failures back off exponentially and become DEAD after max attempts (visible on /admin/worker for replay).
 */
export async function dispatchOutbox(db: Db, opts: { limit?: number; deliver?: Deliverer } = {}) {
  const deliver = opts.deliver ?? deliverInApp;
  const claimed = await db.execute<OutboxRow & Record<string, unknown>>(sql`
    update outbox_events set status = 'PROCESSING', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from outbox_events where status in ('PENDING','FAILED') and available_at <= now()
      order by available_at limit ${opts.limit ?? 50} for update skip locked
    ) returning id, organization_id, type, payload, dedupe_key, status, attempts, max_attempts, available_at, locked_at, last_error, processed_at, created_at`);
  let delivered = 0;
  let failed = 0;
  for (const raw of claimed) {
    const ev = {
      id: raw.id,
      organizationId: raw.organization_id as string,
      type: raw.type,
      payload: raw.payload,
      dedupeKey: raw.dedupe_key as string,
      status: raw.status,
      attempts: raw.attempts,
      maxAttempts: raw.max_attempts as number,
    } as OutboxRow;
    try {
      await deliver(db, ev);
      await db.execute(sql`update outbox_events set status = 'DONE', processed_at = now(), last_error = null where id = ${ev.id}`);
      delivered++;
    } catch (e) {
      failed++;
      const dead = ev.attempts >= ev.maxAttempts;
      const delaySec = Math.min(3600, 2 ** ev.attempts * 15);
      const msg = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
      await db.execute(sql`update outbox_events set status = ${dead ? "DEAD" : "FAILED"}, last_error = ${msg},
        available_at = now() + make_interval(secs => ${delaySec}) where id = ${ev.id}`);
      logger.warn("outbox.failed", { outboxId: ev.id, type: ev.type, attempts: ev.attempts, dead });
    }
  }
  return { claimed: claimed.length, delivered, failed };
}

/** A worker that died mid-delivery leaves rows PROCESSING; return them to the queue (delivery is idempotent). */
export async function recoverStaleOutbox(db: Db, staleMinutes = 10) {
  const r = await db.execute(sql`update outbox_events set status = 'FAILED', last_error = 'recovered after stale lock'
    where status = 'PROCESSING' and locked_at < now() - make_interval(mins => ${staleMinutes}) returning id`);
  return r.length;
}

// ---------------------------------------------------------------- inbox (per user, always own rows only)

export async function listNotifications(db: Db, ctx: AuthContext, opts: { unread?: boolean; limit?: number } = {}) {
  const where = [eq(notifications.organizationId, ctx.organizationId), eq(notifications.userId, ctx.userId)];
  if (opts.unread) where.push(isNull(notifications.readAt));
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...where))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(opts.limit ?? 100, 200));
  return { items: rows, unread: await unreadCount(db, ctx) };
}

export async function unreadCount(db: DbOrTx, ctx: AuthContext) {
  const [r] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.organizationId, ctx.organizationId), eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
  return Number(r?.n ?? 0);
}

export async function markNotificationsRead(db: Db, ctx: AuthContext, input: unknown) {
  const d = parse(notificationRead, input);
  const where = [eq(notifications.organizationId, ctx.organizationId), eq(notifications.userId, ctx.userId), isNull(notifications.readAt)];
  if ("ids" in d) where.push(inArray(notifications.id, d.ids));
  const r = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(...where))
    .returning({ id: notifications.id });
  return { updated: r.length, unread: await unreadCount(db, ctx) };
}

// ---------------------------------------------------------------- worker health + replay (org admins)

/** Status counts and failed/dead rows for jobs and the outbox ("dashboards for worker failures"). */
export async function workerStatus(db: Db, ctx: AuthContext) {
  await authorize(db, ctx, "org.manage", {});
  const orgJobs = sql`(${jobs.organizationId} is null or ${jobs.organizationId} = ${ctx.organizationId})`;
  const [jobCounts, outboxCounts, jobProblems, outboxProblems, [lastJob], [lastOutbox]] = await Promise.all([
    db.select({ status: jobs.status, n: count() }).from(jobs).where(orgJobs).groupBy(jobs.status),
    db.select({ status: outboxEvents.status, n: count() }).from(outboxEvents).where(eq(outboxEvents.organizationId, ctx.organizationId)).groupBy(outboxEvents.status),
    db
      .select({ id: jobs.id, type: jobs.type, status: jobs.status, attempts: jobs.attempts, maxAttempts: jobs.maxAttempts, lastError: jobs.lastError, runAt: jobs.runAt })
      .from(jobs)
      .where(and(orgJobs, inArray(jobs.status, ["FAILED", "DEAD"])))
      .orderBy(desc(jobs.runAt))
      .limit(50),
    db
      .select({
        id: outboxEvents.id,
        type: outboxEvents.type,
        status: outboxEvents.status,
        attempts: outboxEvents.attempts,
        maxAttempts: outboxEvents.maxAttempts,
        lastError: outboxEvents.lastError,
        availableAt: outboxEvents.availableAt,
        dedupeKey: outboxEvents.dedupeKey,
      })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.organizationId, ctx.organizationId), inArray(outboxEvents.status, ["FAILED", "DEAD", "PROCESSING"])))
      .orderBy(desc(outboxEvents.availableAt))
      .limit(50),
    db
      .select({ at: sql<string | null>`max(${jobs.completedAt})` })
      .from(jobs)
      .where(orgJobs),
    db
      .select({ at: sql<string | null>`max(${outboxEvents.processedAt})` })
      .from(outboxEvents)
      .where(eq(outboxEvents.organizationId, ctx.organizationId)),
  ]);
  const toMap = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return {
    computedAt: new Date().toISOString(),
    jobs: { counts: toMap(jobCounts), problems: jobProblems, lastCompletedAt: lastJob?.at ?? null },
    outbox: { counts: toMap(outboxCounts), problems: outboxProblems, lastProcessedAt: lastOutbox?.at ?? null },
  };
}

/** Put a FAILED/DEAD outbox event back in the queue. Safe: delivery is idempotent. */
export async function replayOutboxEvent(db: Db, ctx: AuthContext, id: string) {
  await authorize(db, ctx, "org.manage", {}, { action: "outbox.replay", resourceType: "outbox_event", resourceId: id });
  return db.transaction(async (tx) => {
    const [ev] = await tx
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.organizationId, ctx.organizationId), eq(outboxEvents.id, id)))
      .for("update");
    if (!ev) throw notFound("Outbox event");
    if (!["FAILED", "DEAD"].includes(ev.status)) throw new AppError("CONFLICT", `Only failed or dead events can be replayed (this one is ${ev.status}).`);
    const [r] = await tx.update(outboxEvents).set({ status: "PENDING", attempts: 0, availableAt: new Date(), lockedAt: null }).where(eq(outboxEvents.id, id)).returning();
    await audit(tx, ctx, { action: "outbox.replay", resourceType: "outbox_event", resourceId: id, metadata: { type: ev.type, previousStatus: ev.status } });
    return r!;
  });
}

/** Put a FAILED/DEAD job back in the queue (handlers are idempotent by contract). */
export async function replayJob(db: Db, ctx: AuthContext, id: string) {
  await authorize(db, ctx, "org.manage", {}, { action: "job.replay", resourceType: "job", resourceId: id });
  return db.transaction(async (tx) => {
    const [j] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), sql`(${jobs.organizationId} is null or ${jobs.organizationId} = ${ctx.organizationId})`))
      .for("update");
    if (!j) throw notFound("Job");
    if (!["FAILED", "DEAD"].includes(j.status)) throw new AppError("CONFLICT", `Only failed or dead jobs can be replayed (this one is ${j.status}).`);
    const [r] = await tx.update(jobs).set({ status: "PENDING", attempts: 0, runAt: new Date(), lockedAt: null, lockedBy: null }).where(eq(jobs.id, id)).returning();
    await audit(tx, ctx, { action: "job.replay", resourceType: "job", resourceId: id, metadata: { type: j.type, previousStatus: j.status } });
    return r!;
  });
}

import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { organizations, rcmCases, rcmQueues } from "@projectos/db/schema";
import { enqueueNotification } from "@projectos/notifications";
import { RCM_DUE_SOON_DAYS, addDays, todayIn } from "@projectos/shared";
import { caseRef } from "./access";

/**
 * Worker job `rcm.scan`: due-soon and overdue next-action reminders, written to the outbox.
 * Recipient = case owner, or the queue lead when the case is unassigned. Idempotent: the dedupe key
 * includes the due date, so repeated scans and retries never duplicate; a new due date re-arms it.
 */
export async function scanRcmDue(db: Db, opts: { organizationId?: string; now?: Date } = {}) {
  const orgs = await db
    .select({ id: organizations.id, timezone: organizations.timezone })
    .from(organizations)
    .where(opts.organizationId ? eq(organizations.id, opts.organizationId) : eq(organizations.status, "ACTIVE"));
  let queued = 0;
  let skippedNoRecipient = 0;
  for (const o of orgs) {
    const today = todayIn(o.timezone, opts.now);
    const rows = await db
      .select({
        id: rcmCases.id,
        number: rcmCases.number,
        nextAction: rcmCases.nextAction,
        nextActionDue: rcmCases.nextActionDue,
        ownerUserId: rcmCases.ownerUserId,
        leadUserId: rcmQueues.leadUserId,
      })
      .from(rcmCases)
      .innerJoin(rcmQueues, eq(rcmQueues.id, rcmCases.queueId))
      .where(
        and(
          eq(rcmCases.organizationId, o.id),
          sql`${rcmCases.status} not in ('RESOLVED','CLOSED_NO_ACTION')`,
          isNotNull(rcmCases.nextActionDue),
          lte(rcmCases.nextActionDue, addDays(today, RCM_DUE_SOON_DAYS)),
        ),
      );
    for (const c of rows) {
      const overdue = c.nextActionDue! < today;
      const userId = c.ownerUserId ?? (overdue ? c.leadUserId : null);
      if (!userId) {
        skippedNoRecipient++;
        continue;
      }
      const id = await enqueueNotification(db, {
        organizationId: o.id,
        userId,
        kind: overdue ? "RCM_OVERDUE" : "RCM_DUE_SOON",
        title: `${caseRef(c.number)} next action ${overdue ? "is overdue" : "is due soon"}${c.ownerUserId ? "" : " (unassigned)"}`,
        body: `${c.nextAction ?? "Follow up"} — due ${c.nextActionDue}`,
        link: `/rcm/cases/${c.id}`,
        resourceType: "rcm_case",
        resourceId: c.id,
        dedupeKey: `${overdue ? "rcm.overdue" : "rcm.due_soon"}:${c.id}:${c.nextActionDue}`,
      });
      if (id) queued++;
    }
  }
  return { queued, skippedNoRecipient };
}

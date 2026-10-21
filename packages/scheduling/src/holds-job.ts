import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { resourceReservations } from "@projectos/db/schema";
import { audit } from "@projectos/core";

/**
 * Explicitly release holds whose expiry has passed. Idempotent and safe under concurrent workers
 * (FOR UPDATE SKIP LOCKED): each hold is expired exactly once, its reservations are released in the
 * same transaction, and one SYSTEM audit event is written per hold.
 * Until this runs, an expired hold keeps blocking its resources (the exclusion constraint never looks at now()).
 */
export async function releaseExpiredHolds(db: Db, opts: { organizationId?: string; now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 500;
  return db.transaction(async (tx) => {
    const expired = await tx.execute<{ id: string; organization_id: string }>(sql`
      with due as (
        select id from appointment_holds
        where status = 'ACTIVE' and expires_at <= ${now.toISOString()}::timestamptz
          ${opts.organizationId ? sql`and organization_id = ${opts.organizationId}` : sql``}
        order by expires_at
        limit ${limit}
        for update skip locked
      )
      update appointment_holds h set status = 'EXPIRED', released_at = ${now.toISOString()}::timestamptz, release_reason = 'expired'
      from due where h.id = due.id
      returning h.id, h.organization_id`);
    const rows = [...expired];
    if (!rows.length) return { released: 0 };
    await tx
      .update(resourceReservations)
      .set({ state: "RELEASED", releasedAt: now })
      .where(
        and(
          eq(resourceReservations.state, "ACTIVE"),
          inArray(
            resourceReservations.holdId,
            rows.map((r) => r.id),
          ),
        ),
      );
    for (const r of rows) {
      await audit(tx, { system: "scheduling.release-holds", organizationId: r.organization_id }, { action: "hold.expire", resourceType: "appointment_hold", resourceId: r.id });
    }
    return { released: rows.length };
  });
}

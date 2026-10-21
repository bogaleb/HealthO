import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@projectos/db";
import { auditEvents, memberships } from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import { authorize } from "../authz";
import { parse } from "../util";

const auditQuery = z.object({
  action: z.string().max(80).optional(),
  outcome: z.enum(["ALLOW", "DENY", "ERROR"]).optional(),
  resourceType: z.string().max(60).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listAuditEvents(db: Db, ctx: AuthContext, query: unknown) {
  await authorize(db, ctx, "audit.read", {}, { action: "audit.read", resourceType: "audit_event" });
  const q = parse(auditQuery, query);
  const where: SQL[] = [eq(auditEvents.organizationId, ctx.organizationId)];
  if (q.action) where.push(eq(auditEvents.action, q.action));
  if (q.outcome) where.push(eq(auditEvents.outcome, q.outcome));
  if (q.resourceType) where.push(eq(auditEvents.resourceType, q.resourceType));
  if (q.from) where.push(gte(auditEvents.createdAt, new Date(q.from)));
  if (q.to) where.push(lte(auditEvents.createdAt, new Date(q.to)));
  const rows = await db
    .select({ event: auditEvents, actorName: memberships.displayName })
    .from(auditEvents)
    .leftJoin(memberships, and(eq(memberships.userId, auditEvents.actorUserId), eq(memberships.organizationId, auditEvents.organizationId)))
    .where(and(...where))
    .orderBy(desc(auditEvents.createdAt))
    .limit(q.pageSize + 1)
    .offset((q.page - 1) * q.pageSize);
  return { items: rows.slice(0, q.pageSize).map((r) => ({ ...r.event, actorName: r.actorName })), hasMore: rows.length > q.pageSize, page: q.page };
}

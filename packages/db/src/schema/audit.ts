import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_common";

/** Append-only (enforced by trigger in migration 0001). Metadata must be redacted: IDs and field names only. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    organizationId: uuid("organization_id"),
    actorType: text("actor_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    outcome: text("outcome").notNull(),
    requestId: text("request_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    check("audit_actor_type_ck", sql`${t.actorType} in ('USER','SYSTEM','ANONYMOUS')`),
    check("audit_outcome_ck", sql`${t.outcome} in ('ALLOW','DENY','ERROR')`),
    index("audit_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_org_resource_idx").on(t.organizationId, t.resourceType, t.resourceId),
  ],
);

/** Durable Postgres-backed job queue (claimed with FOR UPDATE SKIP LOCKED). */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    organizationId: uuid("organization_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull().default("PENDING"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("jobs_status_ck", sql`${t.status} in ('PENDING','RUNNING','DONE','FAILED','DEAD')`),
    index("jobs_status_run_idx").on(t.status, t.runAt),
  ],
);

/** Request idempotency records for retried mutations. */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    resourceId: uuid("resource_id").notNull(),
    createdAt: createdAt(),
    expiresOn: date("expires_on"),
  },
  (t) => [unique("idempotency_org_scope_key_uq").on(t.organizationId, t.scope, t.key)],
);

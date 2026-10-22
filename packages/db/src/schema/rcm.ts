import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgSequence, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, updatedAt, version } from "./_common";
import { departments, organizations, sites } from "./org";
import { users } from "./auth";
import { tasks } from "./projects";
import { credentialingCases, payerPlans, payers, practitioners } from "./credentialing";

// Phase 6 revenue-cycle work queues. SYNTHETIC claim references only ("SYN-…"); no claim lines,
// diagnosis codes or patient identity are stored. This is not a clearinghouse.

export const rcmCaseNumberSeq = pgSequence("rcm_case_number_seq", { startWith: 1 });

export const rcmQueues = pgTable(
  "rcm_queues",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    name: text("name").notNull(),
    category: text("category").notNull(),
    /** Visibility scope: department-scoped RCM grants see this queue's cases. Fixed after creation. */
    departmentId: uuid("department_id").notNull(),
    description: text("description"),
    /** Queue lead: receives notifications for unassigned overdue work and escalations by default. */
    leadUserId: uuid("lead_user_id").references(() => users.id),
    followUpDays: integer("follow_up_days").notNull().default(14),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("rcm_queues_org_id_uq").on(t.organizationId, t.id),
    unique("rcm_queues_org_name_uq").on(t.organizationId, t.name),
    foreignKey({ columns: [t.organizationId, t.departmentId], foreignColumns: [departments.organizationId, departments.id] }),
    check("rcm_queues_category_ck", sql`${t.category} in ('DENIAL_INITIATIVE','AGING_FOLLOW_UP','CREDENTIALING_PAYER','BILLING_QUALITY')`),
    check("rcm_queues_follow_up_ck", sql`${t.followUpDays} between 1 and 90`),
  ],
);

export const rcmCases = pgTable(
  "rcm_cases",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    number: integer("number")
      .notNull()
      .default(sql`nextval('rcm_case_number_seq')`),
    queueId: uuid("queue_id").notNull(),
    departmentId: uuid("department_id").notNull(),
    siteId: uuid("site_id"),
    caseType: text("case_type").notNull(),
    claimRef: text("claim_ref").notNull(),
    payerId: uuid("payer_id").notNull(),
    payerPlanId: uuid("payer_plan_id"),
    serviceDate: date("service_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    denialCode: text("denial_code"),
    status: text("status").notNull().default("OPEN"),
    priority: text("priority").notNull().default("MEDIUM"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    nextAction: text("next_action"),
    nextActionDue: date("next_action_due"),
    practitionerId: uuid("practitioner_id"),
    credentialingCaseId: uuid("credentialing_case_id"),
    taskId: uuid("task_id"),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    lastActionAt: timestamp("last_action_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("rcm_cases_org_id_uq").on(t.organizationId, t.id),
    unique("rcm_cases_org_number_uq").on(t.organizationId, t.number),
    foreignKey({ columns: [t.organizationId, t.queueId], foreignColumns: [rcmQueues.organizationId, rcmQueues.id] }),
    foreignKey({ columns: [t.organizationId, t.departmentId], foreignColumns: [departments.organizationId, departments.id] }),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
    foreignKey({ columns: [t.organizationId, t.payerId], foreignColumns: [payers.organizationId, payers.id] }),
    foreignKey({ columns: [t.organizationId, t.payerPlanId], foreignColumns: [payerPlans.organizationId, payerPlans.id] }),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }),
    foreignKey({ columns: [t.organizationId, t.credentialingCaseId], foreignColumns: [credentialingCases.organizationId, credentialingCases.id] }),
    foreignKey({ columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }),
    // One OPEN case per claim reference and type: a retried create can never duplicate work.
    uniqueIndex("rcm_cases_open_claim_uq")
      .on(t.organizationId, t.claimRef, t.caseType)
      .where(sql`status not in ('RESOLVED','CLOSED_NO_ACTION')`),
    index("rcm_cases_org_queue_status_idx").on(t.organizationId, t.queueId, t.status),
    index("rcm_cases_org_owner_idx").on(t.organizationId, t.ownerUserId, t.status),
    index("rcm_cases_org_due_idx").on(t.organizationId, t.nextActionDue),
    check("rcm_cases_status_ck", sql`${t.status} in ('OPEN','IN_PROGRESS','WAITING_PAYER','ESCALATED','RESOLVED','CLOSED_NO_ACTION')`),
    check("rcm_cases_priority_ck", sql`${t.priority} in ('LOW','MEDIUM','HIGH','URGENT')`),
    check("rcm_cases_type_ck", sql`${t.caseType} in ('DENIAL','NO_RESPONSE','UNDERPAYMENT','ENROLLMENT_BLOCKER','CODING_REVIEW','CORRECTED_CLAIM')`),
    check("rcm_cases_claim_ref_ck", sql`${t.claimRef} ~ '^SYN-[A-Z0-9-]{2,30}$'`),
    check("rcm_cases_amount_ck", sql`${t.amountCents} >= 0`),
    check("rcm_cases_resolved_ck", sql`(${t.status} in ('RESOLVED','CLOSED_NO_ACTION')) = (${t.resolvedAt} is not null)`),
  ],
);

/** Append-only follow-up/action timeline (trigger in migration 0010). */
export const rcmCaseActions = pgTable(
  "rcm_case_actions",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    caseId: uuid("case_id").notNull(),
    type: text("type").notNull(),
    note: text("note"),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    fromOwnerUserId: uuid("from_owner_user_id"),
    toOwnerUserId: uuid("to_owner_user_id"),
    nextAction: text("next_action"),
    nextActionDue: date("next_action_due"),
    batchId: uuid("batch_id"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorSystem: text("actor_system"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.caseId], foreignColumns: [rcmCases.organizationId, rcmCases.id] }).onDelete("cascade"),
    index("rcm_case_actions_case_idx").on(t.organizationId, t.caseId, t.at),
    check("rcm_case_actions_actor_ck", sql`(${t.actorUserId} is not null) or (${t.actorSystem} is not null)`),
  ],
);

/** A bulk (re)assignment, kept so it can be reviewed and reversed as a unit. */
export const rcmAssignmentBatches = pgTable(
  "rcm_assignment_batches",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    /** [{ caseId, previousOwnerUserId, versionAfter }] */
    items: jsonb("items").notNull(),
    caseCount: integer("case_count").notNull(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: uuid("undone_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique("rcm_batches_org_id_uq").on(t.organizationId, t.id)],
);

/** In-app notifications (internal inbox only — no SMS/email in this phase). Bodies carry no PHI. */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Relative in-app path (never an external URL, never contains identifiers beyond record IDs). */
    link: text("link"),
    resourceType: text("resource_type"),
    resourceId: uuid("resource_id"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("notifications_dedupe_uq").on(t.organizationId, t.userId, t.dedupeKey),
    index("notifications_user_idx").on(t.organizationId, t.userId, t.readAt, t.createdAt),
    check("notifications_link_ck", sql`${t.link} is null or ${t.link} ~ '^/[A-Za-z0-9/_?=&.-]*$'`),
  ],
);

/** Transactional outbox: rows are written in the same transaction as the domain change, delivered by the worker. */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("outbox_dedupe_uq").on(t.organizationId, t.dedupeKey),
    index("outbox_status_idx").on(t.status, t.availableAt),
    check("outbox_status_ck", sql`${t.status} in ('PENDING','PROCESSING','DONE','FAILED','DEAD')`),
  ],
);

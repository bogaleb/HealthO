import { z } from "zod";
import { TASK_PRIORITIES } from "./validation";

/**
 * Phase 6 revenue-cycle vocabulary. This is an internal work-queue tool, NOT a claims clearinghouse:
 * claim references are synthetic placeholders (prefix "SYN-"), no claim lines, no diagnosis codes, no patient identity.
 */
export const RCM_QUEUE_CATEGORIES = ["DENIAL_INITIATIVE", "AGING_FOLLOW_UP", "CREDENTIALING_PAYER", "BILLING_QUALITY"] as const;
export type RcmQueueCategory = (typeof RCM_QUEUE_CATEGORIES)[number];
export const RCM_QUEUE_CATEGORY_LABEL: Record<RcmQueueCategory, string> = {
  DENIAL_INITIATIVE: "Denial initiative",
  AGING_FOLLOW_UP: "Aging follow-up",
  CREDENTIALING_PAYER: "Credentialing-linked payer issue",
  BILLING_QUALITY: "Billing quality",
};

export const RCM_CASE_TYPES = ["DENIAL", "NO_RESPONSE", "UNDERPAYMENT", "ENROLLMENT_BLOCKER", "CODING_REVIEW", "CORRECTED_CLAIM"] as const;
export type RcmCaseType = (typeof RCM_CASE_TYPES)[number];
export const RCM_CASE_TYPE_LABEL: Record<RcmCaseType, string> = {
  DENIAL: "Denial",
  NO_RESPONSE: "No payer response",
  UNDERPAYMENT: "Underpayment",
  ENROLLMENT_BLOCKER: "Enrollment / credentialing blocker",
  CODING_REVIEW: "Coding / documentation review",
  CORRECTED_CLAIM: "Corrected claim",
};

export const RCM_CASE_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_PAYER", "ESCALATED", "RESOLVED", "CLOSED_NO_ACTION"] as const;
export type RcmCaseStatus = (typeof RCM_CASE_STATUSES)[number];
export const RCM_CLOSED_STATUSES: readonly RcmCaseStatus[] = ["RESOLVED", "CLOSED_NO_ACTION"];
export const RCM_STATUS_LABEL: Record<RcmCaseStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  WAITING_PAYER: "Waiting on payer",
  ESCALATED: "Escalated",
  RESOLVED: "Resolved",
  CLOSED_NO_ACTION: "Closed — no action",
};

export const RCM_PRIORITIES = TASK_PRIORITIES;

/** Follow-up events a user records; system events (assignment, status, escalation, link) are written by the server. */
export const RCM_FOLLOW_UP_TYPES = ["NOTE", "PAYER_CALL", "PORTAL_CHECK", "APPEAL_SUBMITTED", "CORRECTED_CLAIM_SUBMITTED", "RECORDS_SENT"] as const;
export const RCM_SYSTEM_ACTION_TYPES = ["CREATED", "ASSIGNED", "STATUS_CHANGED", "ESCALATED", "TASK_LINKED", "UPDATED"] as const;
export const RCM_ACTION_TYPES = [...RCM_FOLLOW_UP_TYPES, ...RCM_SYSTEM_ACTION_TYPES] as const;
export type RcmActionType = (typeof RCM_ACTION_TYPES)[number];
export const RCM_ACTION_LABEL: Record<RcmActionType, string> = {
  NOTE: "Note",
  PAYER_CALL: "Payer call",
  PORTAL_CHECK: "Payer portal check",
  APPEAL_SUBMITTED: "Appeal submitted",
  CORRECTED_CLAIM_SUBMITTED: "Corrected claim submitted",
  RECORDS_SENT: "Records sent",
  CREATED: "Created",
  ASSIGNED: "Assigned",
  STATUS_CHANGED: "Status changed",
  ESCALATED: "Escalated",
  TASK_LINKED: "Project task linked",
  UPDATED: "Updated",
};

/** Age category is derived from the date of service (never stored), so it can't drift. */
export const RCM_AGE_BUCKETS = ["0-30", "31-60", "61-90", "91-120", "120+"] as const;
export type RcmAgeBucket = (typeof RCM_AGE_BUCKETS)[number];
export function ageBucket(ageDays: number): RcmAgeBucket {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  if (ageDays <= 120) return "91-120";
  return "120+";
}
/** Inclusive [min, max] age in days for a bucket (max null = open-ended); shared by SQL filters and UI. */
export const AGE_BUCKET_RANGE: Record<RcmAgeBucket, [number, number | null]> = {
  "0-30": [0, 30],
  "31-60": [31, 60],
  "61-90": [61, 90],
  "91-120": [91, 120],
  "120+": [121, null],
};

/** Days before the next-action date at which a "due soon" internal notification is produced. */
export const RCM_DUE_SOON_DAYS = 1;
export const BULK_ASSIGN_MAX = 200;

const uuid = z.uuid();
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
/** Synthetic placeholder only — real claim numbers are out of scope until the PHI go-live gate. */
export const SYNTHETIC_CLAIM_REF = /^SYN-[A-Z0-9-]{2,30}$/;
const claimRef = z.string().trim().toUpperCase().regex(SYNTHETIC_CLAIM_REF, "Use a synthetic reference starting with SYN- (no real claim numbers)");
const denialCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,3}-?\d{1,4}$/, "Use a short reason code such as CO-16")
  .max(12);
const text = (max: number) => z.string().trim().min(1).max(max);

export const rcmQueueCreate = z.object({
  name: text(120),
  category: z.enum(RCM_QUEUE_CATEGORIES),
  departmentId: uuid,
  description: z.string().trim().max(500).nullable().optional(),
  leadUserId: uuid.nullable().optional(),
  followUpDays: z.coerce.number().int().min(1).max(90).default(14),
});
export const rcmQueueUpdate = rcmQueueCreate.partial().extend({ version: z.number().int(), active: z.boolean().optional() });

export const rcmCaseCreate = z.object({
  queueId: uuid,
  caseType: z.enum(RCM_CASE_TYPES),
  claimRef,
  payerId: uuid,
  payerPlanId: uuid.nullable().optional(),
  siteId: uuid.nullable().optional(),
  serviceDate: iso,
  amountCents: z.coerce.number().int().min(0).max(100_000_000),
  denialCode: denialCode.nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  ownerUserId: uuid.nullable().optional(),
  nextAction: z.string().trim().max(200).nullable().optional(),
  nextActionDue: iso.nullable().optional(),
  practitionerId: uuid.nullable().optional(),
  credentialingCaseId: uuid.nullable().optional(),
});

export const rcmCaseUpdate = z.object({
  version: z.number().int(),
  status: z.enum(RCM_CASE_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  nextAction: z.string().trim().max(200).nullable().optional(),
  nextActionDue: iso.nullable().optional(),
  denialCode: denialCode.nullable().optional(),
  resolutionNote: z.string().trim().max(500).optional(),
});

export const rcmActionCreate = z.object({
  type: z.enum(RCM_FOLLOW_UP_TYPES),
  note: text(1000),
  /** Optionally set the next action in the same step (most follow-ups end with one). */
  nextAction: z.string().trim().max(200).nullable().optional(),
  nextActionDue: iso.nullable().optional(),
  status: z.enum(["IN_PROGRESS", "WAITING_PAYER"]).optional(),
});

export const rcmAssign = z.object({ version: z.number().int(), ownerUserId: uuid.nullable() });

export const rcmBulkAssign = z.object({
  caseIds: z.array(uuid).min(1).max(BULK_ASSIGN_MAX),
  ownerUserId: uuid.nullable(),
  /** Optional optimistic-lock map; when given every listed case must still be at that version. */
  versions: z.record(z.string(), z.number().int()).optional(),
});

export const rcmEscalate = z.object({
  version: z.number().int(),
  reason: text(300),
  escalateToUserId: uuid.nullable().optional(),
});

export const rcmLinkTask = z.object({ projectId: uuid });

export const notificationRead = z.union([z.object({ ids: z.array(uuid).min(1).max(200) }), z.object({ all: z.literal(true) })]);

export const NOTIFICATION_KINDS = ["RCM_DUE_SOON", "RCM_OVERDUE", "RCM_ASSIGNED", "RCM_ESCALATED", "TASK_DUE_SOON", "TASK_OVERDUE"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export const OUTBOX_STATUSES = ["PENDING", "PROCESSING", "DONE", "FAILED", "DEAD"] as const;

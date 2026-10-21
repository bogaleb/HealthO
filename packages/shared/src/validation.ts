import { z } from "zod";
import { US_JURISDICTIONS, isValidTimeZone } from "./jurisdictions";
import { PERMISSIONS } from "./permissions";

export const uuid = z.uuid();
export const timeZone = z.string().refine(isValidTimeZone, "Must be a valid IANA time zone, e.g. America/New_York");
export const jurisdiction = z.enum(US_JURISDICTIONS);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const trimmed = (max: number) => z.string().trim().min(1, "Required").max(max);

// NOTE: schemas intentionally do NOT accept organizationId. Unknown keys are stripped,
// so a forged organizationId in a body is ignored and the session org is always used.

export const siteCreate = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/, "2–16 letters, digits or dashes"),
  name: trimmed(120),
  state: jurisdiction,
  timezone: timeZone,
  addressLine1: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().max(10).optional().nullable(),
});
export const siteUpdate = siteCreate.partial().extend({ active: z.boolean().optional(), version: z.number().int().positive() });

export const departmentCreate = z.object({
  name: trimmed(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/),
  siteId: uuid.nullable().optional(),
});
export const teamCreate = z.object({ name: trimmed(120), departmentId: uuid });

export const roleGrantInput = z.object({
  roleId: uuid,
  siteId: uuid.nullable().optional(),
  departmentId: uuid.nullable().optional(),
});
export const setMembershipRoles = z.object({ grants: z.array(roleGrantInput).max(20), version: z.number().int().positive() });

export const roleCreate = z.object({
  name: trimmed(80),
  description: z.string().trim().max(300).optional().nullable(),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
});
export const roleUpdate = roleCreate.partial().extend({ version: z.number().int().positive() });

export const inviteCreate = z.object({
  email: z.email().trim().toLowerCase().max(200),
  displayName: trimmed(120),
  grants: z.array(roleGrantInput).min(1).max(10),
});
export const inviteAccept = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(12, "At least 12 characters").max(128),
});

export const membershipUpdate = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  version: z.number().int().positive(),
});

// ---------- Projects & tasks ----------
export const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export const PROJECT_HEALTH = ["ON_TRACK", "AT_RISK", "OFF_TRACK"] as const;
export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE", "CANCELLED"] as const;
export const BOARD_COLUMNS = ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE"] as const;
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  BLOCKED: "Blocked",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const projectCreate = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/, "2–10 letters/digits, starting with a letter"),
  name: trimmed(140),
  description: z.string().trim().max(4000).optional().nullable(),
  siteId: uuid.nullable().optional(),
  departmentId: uuid.nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  startDate: isoDate.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  templateId: uuid.nullable().optional(),
});
export const projectUpdate = z.object({
  name: trimmed(140).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  health: z.enum(PROJECT_HEALTH).optional(),
  ownerUserId: uuid.nullable().optional(),
  startDate: isoDate.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  version: z.number().int().positive(),
});
export const milestoneCreate = z.object({ name: trimmed(140), dueDate: isoDate.nullable().optional() });

export const taskCreate = z.object({
  projectId: uuid,
  title: trimmed(200),
  description: z.string().trim().max(8000).optional().nullable(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  ownerUserId: uuid.nullable().optional(),
  collaboratorUserIds: z.array(uuid).max(20).optional(),
  dueDate: isoDate.nullable().optional(),
  dueTimezone: timeZone.optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  parentTaskId: uuid.nullable().optional(),
  milestoneId: uuid.nullable().optional(),
});
export const taskUpdate = z.object({
  title: trimmed(200).optional(),
  description: z.string().trim().max(8000).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  ownerUserId: uuid.nullable().optional(),
  collaboratorUserIds: z.array(uuid).max(20).optional(),
  dueDate: isoDate.nullable().optional(),
  dueTimezone: timeZone.optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  milestoneId: uuid.nullable().optional(),
  version: z.number().int().positive(),
});
export const taskMove = z.object({
  status: z.enum(TASK_STATUSES),
  /** Insert before this task within the target column; null = end of column. */
  beforeTaskId: uuid.nullable().optional(),
  version: z.number().int().positive(),
});
export const taskListQuery = z.object({
  projectId: uuid.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  ownerUserId: uuid.optional(),
  label: z.string().max(40).optional(),
  q: z.string().trim().max(100).optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const commentCreate = z.object({ body: z.string().trim().min(1).max(4000) });
export const checklistCreate = z.object({ text: trimmed(300) });
export const checklistUpdate = z.object({ done: z.boolean().optional(), text: trimmed(300).optional() });
export const dependencyCreate = z.object({
  blockingTaskId: uuid,
  kind: z.enum(["BLOCKS", "RELATED"]).default("BLOCKS"),
});
export const recurringCreate = z.object({
  projectId: uuid,
  title: trimmed(200),
  description: z.string().trim().max(4000).optional().nullable(),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  ownerUserId: uuid.nullable().optional(),
  cadence: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  monthDay: z.number().int().min(1).max(28).nullable().optional(),
  timezone: timeZone,
  startOn: isoDate,
  dueInDays: z.number().int().min(0).max(60).default(0),
});

export type SiteCreate = z.infer<typeof siteCreate>;
export type TaskCreate = z.infer<typeof taskCreate>;

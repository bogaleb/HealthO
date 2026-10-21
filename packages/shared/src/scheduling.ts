import { z } from "zod";
import { US_JURISDICTIONS } from "./jurisdictions";
import { MODALITIES } from "./credentialing";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");
const uuid = z.uuid();
const text = (max: number) => z.string().trim().min(1, "Required").max(max);
/** An instant with an EXPLICIT offset (Z or ±HH:MM) — local wall times are never accepted bare. */
const instant = z.iso.datetime({ offset: true, message: "Use an ISO date-time with an explicit offset" });

/** Appointment lifecycle (separate from license/payer readiness — never collapse them). */
export const APPOINTMENT_STATUSES = ["HOLD", "PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED", "NEEDS_RESCHEDULE"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  HOLD: "Hold",
  PENDING: "Pending",
  CONFIRMED: "Booked",
  CHECKED_IN: "Checked in",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelled",
  NEEDS_RESCHEDULE: "Needs reschedule",
};
/** Allowed manual status transitions (cancel and reschedule have their own endpoints). */
/** CHECKED_IN is reached only through the check-in endpoint (it re-evaluates eligibility with the confirmed location). */
export const STATUS_TRANSITIONS: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  CONFIRMED: ["NO_SHOW"],
  CHECKED_IN: ["COMPLETED"],
  NEEDS_RESCHEDULE: [],
};
/** Statuses that occupy time (their reservations stay ACTIVE). */
export const OCCUPYING_STATUSES: AppointmentStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW", "NEEDS_RESCHEDULE"];

export const LOCATION_STATUSES = ["PROPOSED", "VERIFIED", "UNKNOWN"] as const;
export const EXCEPTION_KINDS = ["PTO", "CLOSURE", "BLOCK"] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];
export const EXCEPTION_KIND_LABEL: Record<ExceptionKind, string> = { PTO: "Provider time off", CLOSURE: "Site closure / holiday", BLOCK: "Blocked time" };

/** Eligibility shown before the Phase 5 policy engine exists. Never "eligible". */
export const ELIGIBILITY_POLICY_PENDING = "POLICY_PENDING" as const;

export const SLOT_STEP_MINUTES = 15;
export const MAX_SEARCH_DAYS = 14;

export const appointmentTypeCreate = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_]{2,24}$/, "2–24 capital letters, digits or _"),
    name: text(120),
    serviceId: uuid.nullable().optional(),
    durationMinutes: z.coerce.number().int().min(5).max(480),
    bufferBeforeMinutes: z.coerce.number().int().min(0).max(120).default(0),
    bufferAfterMinutes: z.coerce.number().int().min(0).max(120).default(0),
    modalities: z.array(z.enum(MODALITIES)).min(1, "Choose at least one modality"),
    requiresRoom: z.boolean().default(false),
    minNoticeMinutes: z.coerce
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 30)
      .default(0),
    maxDaysOut: z.coerce.number().int().min(1).max(365).default(90),
  })
  .refine((v) => !(v.requiresRoom && !v.modalities.includes("IN_PERSON")), { message: "Only in-person visits can require a room", path: ["requiresRoom"] });

export const appointmentTypeUpdate = z.object({
  version: z.number().int(),
  name: text(120).optional(),
  active: z.boolean().optional(),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  bufferBeforeMinutes: z.coerce.number().int().min(0).max(120).optional(),
  bufferAfterMinutes: z.coerce.number().int().min(0).max(120).optional(),
  minNoticeMinutes: z.coerce.number().int().min(0).max(43200).optional(),
  maxDaysOut: z.coerce.number().int().min(1).max(365).optional(),
});

export const roomCreate = z.object({
  siteId: uuid,
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{1,16}$/, "1–16 capital letters, digits or -"),
  name: text(80),
});

export const scheduleTemplateCreate = z
  .object({
    practitionerId: uuid,
    siteId: uuid,
    weekday: z.coerce.number().int().min(0).max(6),
    startTime: hhmm,
    endTime: hhmm,
    modalities: z.array(z.enum(MODALITIES)).min(1),
    effectiveFrom: iso,
    effectiveTo: iso.nullable().optional(),
  })
  .refine((v) => v.endTime > v.startTime, { message: "End must be after start (blocks cannot cross midnight)", path: ["endTime"] })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { message: "End date before start date", path: ["effectiveTo"] });

export const scheduleExceptionCreate = z
  .object({
    kind: z.enum(EXCEPTION_KINDS),
    practitionerId: uuid.nullable().optional(),
    siteId: uuid.nullable().optional(),
    startAt: instant,
    endAt: instant,
    reason: text(200),
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), { message: "End must be after start", path: ["endAt"] })
  .refine((v) => (v.kind === "CLOSURE" ? !!v.siteId : !!v.practitionerId), { message: "Closures need a site; time off and blocks need a provider", path: ["kind"] });

export const patientCreate = z.object({
  displayName: text(80),
  birthYear: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
  homeState: z.enum(US_JURISDICTIONS).nullable().optional(),
  externalSource: z.string().trim().max(40).nullable().optional(),
  externalId: z.string().trim().max(64).nullable().optional(),
});

export const slotSearch = z.object({
  appointmentTypeId: uuid,
  modality: z.enum(MODALITIES),
  siteId: uuid.optional(),
  practitionerId: uuid.optional(),
  fromDate: iso,
  days: z.coerce.number().int().min(1).max(MAX_SEARCH_DAYS).default(7),
  /** Where the patient will physically be at visit time (required to evaluate video/audio eligibility). */
  patientState: z.enum(US_JURISDICTIONS).optional(),
  patientLocationStatus: z.enum(["PROPOSED", "VERIFIED"]).default("PROPOSED"),
  payerPlanId: uuid.nullable().optional(),
  /** eligible = ALLOW only (default); all = include REVIEW/BLOCK times with their explanations. */
  show: z.enum(["eligible", "all"]).default("eligible"),
  limitPerDay: z.coerce.number().int().min(1).max(200).default(40),
});

const slotTarget = {
  practitionerId: uuid,
  siteId: uuid,
  appointmentTypeId: uuid,
  modality: z.enum(MODALITIES),
  startAt: instant,
  roomId: uuid.nullable().optional(),
};

export const holdCreate = z.object({
  ...slotTarget,
  patientLocationState: z.enum(US_JURISDICTIONS).nullable().optional(),
  payerPlanId: uuid.nullable().optional(),
});

export const appointmentCreate = z.object({
  ...slotTarget,
  patientId: uuid,
  holdId: uuid.optional(),
  /** Null/omitted = unknown (video/audio visits then need review and cannot be confirmed). */
  patientLocationState: z.enum(US_JURISDICTIONS).nullable().optional(),
  patientLocationStatus: z.enum(LOCATION_STATUSES).default("PROPOSED"),
  payerPlanId: uuid.nullable().optional(),
  /** Explicitly save a REVIEW result as a PENDING (unconfirmed) appointment that holds the time for staff review. */
  acceptPendingReview: z.boolean().default(false),
});

export const appointmentReschedule = z.object({
  version: z.number().int(),
  startAt: instant,
  practitionerId: uuid.optional(),
  siteId: uuid.optional(),
  roomId: uuid.nullable().optional(),
  reason: text(300),
  acceptPendingReview: z.boolean().default(false),
});

export const appointmentCancel = z.object({ version: z.number().int(), reason: text(300) });
export const appointmentStatusChange = z.object({ version: z.number().int(), status: z.enum(APPOINTMENT_STATUSES), reason: z.string().trim().max(300).optional() });

export const calendarQuery = z.object({
  date: iso,
  view: z.enum(["day", "week"]).default("day"),
  siteId: uuid.optional(),
  practitionerId: uuid.optional(),
});

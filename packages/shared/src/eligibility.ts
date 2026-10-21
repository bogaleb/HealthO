import { z } from "zod";
import { US_JURISDICTIONS } from "./jurisdictions";
import { MODALITIES } from "./credentialing";

/**
 * Phase 5 eligibility vocabulary shared by server, API and UI so every surface derives the same result.
 * Decisions are deterministic; nothing here is a legal determination (fixture rules are DEMO only).
 */
export const ELIGIBILITY_DECISIONS = ["ALLOW", "REVIEW", "BLOCK"] as const;
export type EligibilityDecision = (typeof ELIGIBILITY_DECISIONS)[number];

/** Flag categories with their own metadata (owner, remediation, whether a follow-up task is created). */
export const ELIGIBILITY_CATEGORIES = [
  "LICENSE_REVIEW",
  "LICENSE_BLOCKED",
  "PAYER_NOT_READY",
  "LOCATION_UNKNOWN",
  "EHR_STALE",
  "CAPACITY_CONFLICT",
  "SCHEDULE_UNAVAILABLE",
] as const;
export type EligibilityCategory = (typeof ELIGIBILITY_CATEGORIES)[number];

export interface CategoryMeta {
  label: string;
  dimension: "LICENSE" | "PAYER" | "LOCATION" | "EHR" | "CAPACITY" | "SCHEDULE";
  owner: string;
  remediation: string;
  /** A follow-up task is created (idempotently) for this category when it blocks a booking. */
  createsTask: boolean;
}

export const CATEGORY_META: Record<EligibilityCategory, CategoryMeta> = {
  LICENSE_REVIEW: {
    label: "License review needed",
    dimension: "LICENSE",
    owner: "Credentialing / compliance",
    remediation: "Verify the provider's authority for the patient's location, or have compliance approve a policy rule for this context.",
    createsTask: true,
  },
  LICENSE_BLOCKED: {
    label: "License blocks this visit",
    dimension: "LICENSE",
    owner: "Credentialing",
    remediation: "Choose another provider. The provider's authority is expired, suspended or revoked for this jurisdiction.",
    createsTask: true,
  },
  PAYER_NOT_READY: {
    label: "Payer not ready",
    dimension: "PAYER",
    owner: "Credentialing (enrollment)",
    remediation: "Use a provider participating with this plan at this site, book self-pay, or complete/verify the site enrollment.",
    createsTask: true,
  },
  LOCATION_UNKNOWN: {
    label: "Patient location unknown",
    dimension: "LOCATION",
    owner: "Scheduler",
    remediation: "Ask where the patient will physically be at the time of the visit and record it (home address does not count).",
    createsTask: false,
  },
  EHR_STALE: {
    label: "EHR schedule not current",
    dimension: "EHR",
    owner: "Scheduling manager / IT",
    remediation: "The site's master schedule is in the EHR and is not synchronized. Save as pending and confirm in the EHR.",
    createsTask: false,
  },
  CAPACITY_CONFLICT: {
    label: "Time not available",
    dimension: "CAPACITY",
    owner: "Scheduler",
    remediation: "Another appointment or hold occupies the provider or room. Pick an alternative time.",
    createsTask: false,
  },
  SCHEDULE_UNAVAILABLE: {
    label: "Outside schedule",
    dimension: "SCHEDULE",
    owner: "Scheduler",
    remediation: "Pick a time inside the provider's working hours, outside time off/closures and within the booking window.",
    createsTask: false,
  },
};

export const DECISION_LABEL: Record<EligibilityDecision, string> = { ALLOW: "Eligible to book", REVIEW: "Needs review", BLOCK: "Blocked" };

/** How long a persisted evaluation may be relied on before it must be re-run (UI and API both use this). */
export const EVALUATION_TTL_MINUTES = 15;

export interface EligibilityFlag {
  code: string;
  category: EligibilityCategory | "INFO";
  severity: "BLOCK" | "REVIEW" | "INFO";
  message: string;
  remediation?: string;
  evidenceId?: string;
}

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true, message: "Use an ISO date-time with an explicit offset" });
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const eligibilityEvaluate = z.object({
  practitionerId: uuid,
  siteId: uuid,
  appointmentTypeId: uuid,
  modality: z.enum(MODALITIES),
  startAt: instant,
  patientLocationState: z.enum(US_JURISDICTIONS).nullable().optional(),
  patientLocationStatus: z.enum(["PROPOSED", "VERIFIED", "UNKNOWN"]).default("PROPOSED"),
  payerPlanId: uuid.nullable().optional(),
  /** When explaining a time the caller is holding, its own hold is not counted as a conflict. */
  holdId: uuid.optional(),
});

export const appointmentCheckIn = z.object({
  version: z.number().int(),
  /** Where the patient says they are RIGHT NOW (required for video/audio visits). */
  patientLocationState: z.enum(US_JURISDICTIONS).optional(),
  locationConfirmed: z.boolean().default(false),
});

export const appointmentLocationChange = z.object({
  version: z.number().int(),
  patientLocationState: z.enum(US_JURISDICTIONS),
  patientLocationStatus: z.enum(["PROPOSED", "VERIFIED"]),
  reason: z.string().trim().min(1).max(300),
});

export const waitlistCreate = z
  .object({
    patientId: uuid,
    appointmentTypeId: uuid,
    modality: z.enum(MODALITIES),
    patientLocationState: z.enum(US_JURISDICTIONS),
    payerPlanId: uuid.nullable().optional(),
    siteId: uuid.nullable().optional(),
    practitionerId: uuid.nullable().optional(),
    earliestDate: iso,
    latestDate: iso,
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
    afterTime: hhmm.nullable().optional(),
    beforeTime: hhmm.nullable().optional(),
    priority: z.coerce.number().int().min(1).max(3).default(2),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => v.latestDate >= v.earliestDate, { message: "Latest date is before earliest date", path: ["latestDate"] })
  .refine((v) => !v.afterTime || !v.beforeTime || v.afterTime < v.beforeTime, { message: "Time window is empty", path: ["beforeTime"] });

export const waitlistOffer = z.object({
  /** Optional explicit slot; otherwise the first eligible matching slot is offered. */
  startAt: instant.optional(),
  practitionerId: uuid.optional(),
  siteId: uuid.optional(),
  expiresInMinutes: z.coerce
    .number()
    .int()
    .min(5)
    .max(48 * 60)
    .default(120),
});

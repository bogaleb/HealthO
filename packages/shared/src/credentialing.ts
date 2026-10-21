import { z } from "zod";
import { US_JURISDICTIONS } from "./jurisdictions";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const uuid = z.uuid();
const jurisdiction = z.enum(US_JURISDICTIONS);
const text = (max: number) => z.string().trim().min(1, "Required").max(max);

/**
 * Profession taxonomy. Fixed codes because policy rules match on them exactly:
 * an RN authority never satisfies an APRN rule, a psychologist's never satisfies an LCSW's, etc.
 */
export const PROFESSIONS = ["PHYSICIAN", "APRN", "RN", "LPN", "PSYCHOLOGIST", "LCSW", "LPC", "PA"] as const;
export type Profession = (typeof PROFESSIONS)[number];
export const PROFESSION_LABEL: Record<Profession, string> = {
  PHYSICIAN: "Physician (MD/DO)",
  APRN: "Advanced practice RN / NP",
  RN: "Registered nurse",
  LPN: "Licensed practical nurse",
  PSYCHOLOGIST: "Psychologist",
  LCSW: "Licensed clinical social worker",
  LPC: "Licensed professional counselor",
  PA: "Physician assistant",
};

/**
 * Kinds of professional authority evidence.
 * COMPACT_MEMBERSHIP_CLAIM is informational only: it can be recorded (e.g. "physician says they are in IMLC")
 * but can NEVER be listed as an authorization basis on a policy rule, so it can never authorize anything.
 */
export const AUTHORITY_TYPES = ["STATE_LICENSE", "MULTISTATE_LICENSE", "APIT", "TEMPORARY_PERMIT", "DOCUMENTED_EXEMPTION", "COMPACT_MEMBERSHIP_CLAIM"] as const;
export type AuthorityType = (typeof AUTHORITY_TYPES)[number];
export const AUTHORIZING_TYPES = ["STATE_LICENSE", "MULTISTATE_LICENSE", "APIT", "TEMPORARY_PERMIT", "DOCUMENTED_EXEMPTION"] as const;
export const AUTHORITY_TYPE_LABEL: Record<AuthorityType, string> = {
  STATE_LICENSE: "State license",
  MULTISTATE_LICENSE: "Multistate license (e.g. NLC)",
  APIT: "Authority to practice interjurisdictional telepsychology (APIT)",
  TEMPORARY_PERMIT: "Temporary permit",
  DOCUMENTED_EXEMPTION: "Documented exemption",
  COMPACT_MEMBERSHIP_CLAIM: "Compact membership claim (informational — never authorizes)",
};

export const AUTHORITY_STATUSES = ["DRAFT", "SUBMITTED", "VERIFIED", "REJECTED", "SUSPENDED", "REVOKED", "EXPIRED"] as const;
export type AuthorityStatus = (typeof AUTHORITY_STATUSES)[number];

export const MODALITIES = ["IN_PERSON", "VIDEO", "AUDIO_ONLY"] as const;
export type Modality = (typeof MODALITIES)[number];
export const MODALITY_LABEL: Record<Modality, string> = { IN_PERSON: "In person", VIDEO: "Video", AUDIO_ONLY: "Audio only" };

export const SERVICE_CATEGORIES = ["PRIMARY_CARE", "BEHAVIORAL_HEALTH", "PSYCHOLOGICAL_TESTING", "NURSING", "SPECIALTY"] as const;

export const ENROLLMENT_STATUSES = ["NOT_STARTED", "SUBMITTED", "AWAITING_INFO", "APPROVED", "DENIED", "TERMINATED"] as const;
export const CASE_TYPES = ["INITIAL_CREDENTIALING", "RECREDENTIALING", "LICENSE_NEW_STATE", "LICENSE_RENEWAL", "PAYER_ENROLLMENT"] as const;
export const CASE_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL", "COMPLETED", "CANCELLED"] as const;

export const practitionerCreate = z.object({
  displayName: text(120),
  profession: z.enum(PROFESSIONS),
  npi: z.string().regex(/^\d{10}$/, "10 digits").nullable().optional(),
  physicalState: jurisdiction.nullable().optional(),
  telehealthCapable: z.boolean().default(false),
  languages: z.array(z.string().trim().min(2).max(30)).max(8).default([]),
  siteIds: z.array(uuid).max(20).default([]),
  specialtyIds: z.array(uuid).max(10).default([]),
  serviceIds: z.array(uuid).max(20).default([]),
});
export const practitionerUpdate = practitionerCreate.partial().extend({ active: z.boolean().optional(), version: z.number().int().positive() });

export const authorityCreate = z
  .object({
    authorityType: z.enum(AUTHORITY_TYPES),
    profession: z.enum(PROFESSIONS),
    jurisdiction,
    /** Primary (home) state for multistate/APIT style authority. */
    homeState: jurisdiction.nullable().optional(),
    /** Only the last 4 characters are stored. */
    licenseNumberLast4: z.string().trim().regex(/^[A-Za-z0-9]{1,4}$/, "Up to 4 letters/digits").nullable().optional(),
    issuingAuthority: z.string().trim().max(200).nullable().optional(),
    effectiveOn: iso,
    expiresOn: iso.nullable().optional(),
    restrictions: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => !v.expiresOn || v.expiresOn >= v.effectiveOn, { message: "Expiration must be on or after the effective date", path: ["expiresOn"] })
  .refine((v) => !["MULTISTATE_LICENSE", "APIT"].includes(v.authorityType) || !!v.homeState, { message: "Home state is required for multistate/APIT authority", path: ["homeState"] });

export const authorityReview = z.object({
  version: z.number().int().positive(),
  sourceName: text(200),
  sourceUrl: z.url().max(500).nullable().optional(),
  verifiedOn: iso,
  nextReviewOn: iso.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});
export const authorityReject = z.object({ version: z.number().int().positive(), note: text(1000) });
export const authorityStatusChange = z.object({ version: z.number().int().positive(), status: z.enum(["SUSPENDED", "REVOKED"]), note: text(1000) });
export const authoritySubmit = z.object({ version: z.number().int().positive() });

export const ruleCreate = z.object({
  jurisdiction,
  profession: z.enum(PROFESSIONS),
  serviceCategory: z.enum(SERVICE_CATEGORIES).nullable().optional(),
  modality: z.enum(MODALITIES),
  authorizationBasis: z.array(z.enum(AUTHORIZING_TYPES)).min(1).max(5),
  /** For MULTISTATE_LICENSE / APIT: home states whose authority this rule accepts. Required for those bases. */
  acceptedHomeStates: z.array(jurisdiction).max(60).default([]),
  /** Empty = provider may be physically anywhere in the US; otherwise listed states only. */
  providerStates: z.array(jurisdiction).max(60).default([]),
  effectiveFrom: iso,
  effectiveTo: iso.nullable().optional(),
  nextReviewOn: iso,
  sourceUrl: z.url().max(500).nullable().optional(),
  sourceSummary: text(1000),
  isDemo: z.boolean().default(true),
});
export const ruleApprove = z.object({ reason: text(500) });
export const ruleRetire = z.object({ reason: text(500) });

export const payerCreate = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/), name: text(120) });
export const planCreate = z.object({ payerId: uuid, code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/), name: text(120), requiresEnrollment: z.boolean().default(true) });
export const enrollmentCreate = z.object({ practitionerId: uuid, payerPlanId: uuid, siteId: uuid, status: z.enum(ENROLLMENT_STATUSES).default("NOT_STARTED"), submittedOn: iso.nullable().optional() });
export const enrollmentUpdate = z.object({
  version: z.number().int().positive(),
  status: z.enum(ENROLLMENT_STATUSES),
  submittedOn: iso.nullable().optional(),
  /** Date the payer confirmed approval (when we learned of it). */
  approvedOn: iso.nullable().optional(),
  /** Retro/effective participation date — displayed separately from approvedOn. */
  effectiveOn: iso.nullable().optional(),
  terminatedOn: iso.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});
export const enrollmentVerify = z.object({ version: z.number().int().positive(), sourceName: text(200) });

export const caseCreate = z.object({
  practitionerId: uuid,
  caseType: z.enum(CASE_TYPES),
  title: text(200),
  ownerUserId: uuid.nullable().optional(),
  dueDate: iso.nullable().optional(),
  nextAction: z.string().trim().max(300).nullable().optional(),
  authorityId: uuid.nullable().optional(),
  enrollmentId: uuid.nullable().optional(),
});
export const caseUpdate = z.object({
  version: z.number().int().positive(),
  status: z.enum(CASE_STATUSES).optional(),
  ownerUserId: uuid.nullable().optional(),
  dueDate: iso.nullable().optional(),
  nextAction: z.string().trim().max(300).nullable().optional(),
});
export const caseLinkTask = z.object({ projectId: uuid });

export const readinessQuery = z.object({
  modality: z.enum(MODALITIES).default("VIDEO"),
  date: iso.optional(),
  profession: z.enum(PROFESSIONS).optional(),
});

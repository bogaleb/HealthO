import type { Tone } from "@projectos/ui";

export const TASK_STATUS_TONE: Record<string, Tone> = {
  TODO: "neutral",
  IN_PROGRESS: "blue",
  IN_REVIEW: "violet",
  BLOCKED: "red",
  DONE: "green",
  CANCELLED: "neutral",
};
export const PRIORITY_TONE: Record<string, Tone> = { LOW: "neutral", MEDIUM: "blue", HIGH: "amber", URGENT: "red" };
export const PRIORITY_LABEL: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };
export const PROJECT_STATUS_LABEL: Record<string, string> = { PLANNING: "Planning", ACTIVE: "Active", ON_HOLD: "On hold", COMPLETED: "Completed", CANCELLED: "Cancelled" };
export const HEALTH_LABEL: Record<string, string> = { ON_TRACK: "On track", AT_RISK: "At risk", OFF_TRACK: "Off track" };
export const HEALTH_TONE: Record<string, Tone> = { ON_TRACK: "green", AT_RISK: "amber", OFF_TRACK: "red" };

/** Formats a date-only value (YYYY-MM-DD) without any time-zone shifting. */
export function formatDate(d: string | null | undefined, opts: { withYear?: boolean } = {}) {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, day!));
  return dt.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(opts.withYear !== false ? { year: "numeric" } : {}), weekday: undefined });
}

/** Formats an instant in an explicit IANA zone and shows the zone. */
export function formatInstant(i: string | Date | null | undefined, timeZone = "America/New_York") {
  if (!i) return "—";
  const d = typeof i === "string" ? new Date(i) : i;
  return `${d.toLocaleString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`;
}

export const AUTHORITY_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "amber",
  VERIFIED: "green",
  REJECTED: "red",
  SUSPENDED: "red",
  REVOKED: "red",
  EXPIRED: "red",
};
export const READINESS_TONE: Record<string, Tone> = { ALLOW: "green", REVIEW: "amber", BLOCK: "red" };
export const READINESS_LABEL: Record<string, string> = {
  VERIFIED_ELIGIBLE: "Eligible",
  NEEDS_VERIFICATION: "Needs verification",
  EXPIRED: "Expired",
  VERIFIED_INELIGIBLE: "Blocked",
  POLICY_UNAVAILABLE: "No approved policy",
};
export const PAYER_TONE: Record<string, Tone> = { READY: "green", NOT_READY: "red", UNKNOWN: "amber", NOT_REQUIRED: "neutral" };
export const PAYER_LABEL: Record<string, string> = { READY: "Ready", NOT_READY: "Not ready", UNKNOWN: "Unverified", NOT_REQUIRED: "Not required" };
export const ENROLLMENT_TONE: Record<string, Tone> = { NOT_STARTED: "neutral", SUBMITTED: "amber", AWAITING_INFO: "amber", APPROVED: "green", DENIED: "red", TERMINATED: "red" };
export const CASE_STATUS_TONE: Record<string, Tone> = { OPEN: "neutral", IN_PROGRESS: "blue", WAITING_EXTERNAL: "amber", COMPLETED: "green", CANCELLED: "neutral" };
export const humanize = (s: string) =>
  s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

/** Days from `today` to a date-only value (negative = past). */
export function daysUntil(d: string, today: string) {
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

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

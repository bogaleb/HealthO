/**
 * Phase 7 EHR scheduling adapter contract (blueprint §4.5). Vendors differ: every operation is a capability that
 * must be both SUPPORTED by the adapter and VERIFIED (vendor documentation + access confirmed by a person) before
 * ProjectOS uses it. No silent fake sync: an unverified capability throws `CapabilityNotVerifiedError`.
 *
 * Resources follow the FHIR R4 shapes (Appointment, Slot-like busy blocks, Patient, Practitioner, Location),
 * reduced to the minimum-necessary fields ProjectOS needs.
 */

export const EHR_CAPABILITIES = [
  "health",
  "getProviders",
  "getLocations",
  "getAvailability",
  "searchPatients",
  "createAppointment",
  "updateAppointment",
  "cancelAppointment",
  "getAppointmentByExternalId",
  "pullChanges",
] as const;
export type EhrCapability = (typeof EHR_CAPABILITIES)[number];

export interface CapabilityFlag {
  /** The adapter implements the operation. */
  supported: boolean;
  /** A person verified the vendor supports it for this connection (docs + test access). Required to use it. */
  verified: boolean;
  verifiedBy: string | null;
}
export type CapabilityFlags = Record<EhrCapability, CapabilityFlag>;

export const EHR_CAPABILITY_LABEL: Record<EhrCapability, string> = {
  health: "Health / readiness check",
  getProviders: "Read practitioners",
  getLocations: "Read locations",
  getAvailability: "Read availability (busy times)",
  searchPatients: "Match patients by identifier",
  createAppointment: "Create appointment",
  updateAppointment: "Reschedule appointment",
  cancelAppointment: "Cancel appointment",
  getAppointmentByExternalId: "Read appointment by EHR id",
  pullChanges: "Pull changes since cursor",
};

// ---------------------------------------------------------------- FHIR R4 (subset)

export type FhirReference = { reference: string };
export interface FhirAppointment {
  resourceType: "Appointment";
  id?: string;
  meta?: { versionId?: string };
  /** R4 Appointment.status subset used here. */
  status: "booked" | "cancelled";
  start: string;
  end: string;
  participant: { actor: FhirReference; status: "accepted" }[];
  /** ProjectOS appointment id, so the EHR record can be traced back (business identifier, not PHI). */
  identifier?: { system: string; value: string }[];
}
export interface BusyBlock {
  externalId: string;
  practitionerRef: string;
  locationRef: string;
  start: Date;
  end: Date;
  status: "booked" | "cancelled";
  origin: "PROJECTOS" | "EHR";
}
export interface ExternalResource {
  externalId: string;
  identifier: string;
  display: string;
}

export const PROJECTOS_IDENTIFIER_SYSTEM = "urn:projectos-health:appointment";

// ---------------------------------------------------------------- errors

/** Network / timeout / 5xx: retry with backoff. Booking must fail closed (never confirm locally). */
export class EhrUnavailableError extends Error {
  readonly retryable = true;
  constructor(message = "EHR unavailable") {
    super(message);
    this.name = "EhrUnavailableError";
  }
}
/** The EHR refused the request (validation, unknown patient…): retrying will not help. */
export class EhrRejectedError extends Error {
  readonly retryable = false;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "EhrRejectedError";
  }
}
/** Optimistic-concurrency failure: the EHR record changed since we last saw it (ETag mismatch). */
export class EhrVersionConflictError extends Error {
  readonly retryable = false;
  constructor(message = "The appointment changed in the EHR") {
    super(message);
    this.name = "EhrVersionConflictError";
  }
}
export class CapabilityNotVerifiedError extends Error {
  readonly retryable = false;
  constructor(readonly capability: EhrCapability) {
    super(`EHR capability "${capability}" is not verified for this connection; ProjectOS will not use it.`);
    this.name = "CapabilityNotVerifiedError";
  }
}

// ---------------------------------------------------------------- contract

export interface EhrSchedulingAdapter {
  readonly vendor: string;
  readonly capabilities: CapabilityFlags;
  health(): Promise<{ ok: boolean; latencyMs: number; detail: string }>;
  getProviders(): Promise<ExternalResource[]>;
  getLocations(): Promise<ExternalResource[]>;
  /** Busy blocks in [from, to) for all practitioners of this connection's location. */
  getAvailability(range: { from: Date; to: Date }): Promise<BusyBlock[]>;
  searchPatients(q: { identifier: string }): Promise<ExternalResource[]>;
  /** Must be idempotent on `idempotencyKey`: a retried create returns the original appointment. */
  createAppointment(appt: FhirAppointment, idempotencyKey: string): Promise<{ externalId: string; etag: string }>;
  updateAppointment(externalId: string, appt: FhirAppointment, ifMatch: string | null): Promise<{ etag: string }>;
  cancelAppointment(externalId: string, ifMatch: string | null): Promise<{ etag: string }>;
  getAppointmentByExternalId(externalId: string): Promise<(FhirAppointment & { etag: string }) | null>;
  pullChanges(cursor: string | null): Promise<{ changes: (FhirAppointment & { etag: string; origin: "PROJECTOS" | "EHR" })[]; cursor: string }>;
}

export function emptyCapabilities(): CapabilityFlags {
  return Object.fromEntries(EHR_CAPABILITIES.map((c) => [c, { supported: false, verified: false, verifiedBy: null }])) as CapabilityFlags;
}

/** Normalize stored JSON into a full flag set (missing keys = unsupported, unverified). */
export function parseCapabilities(raw: unknown): CapabilityFlags {
  const base = emptyCapabilities();
  if (raw && typeof raw === "object") {
    for (const c of EHR_CAPABILITIES) {
      const v = (raw as Record<string, Partial<CapabilityFlag>>)[c];
      if (v) base[c] = { supported: !!v.supported, verified: !!v.supported && !!v.verified, verifiedBy: v.verifiedBy ?? null };
    }
  }
  return base;
}

export function usable(flags: CapabilityFlags, cap: EhrCapability) {
  return flags[cap].supported && flags[cap].verified;
}

export function requireCapability(flags: CapabilityFlags, cap: EhrCapability) {
  if (!usable(flags, cap)) throw new CapabilityNotVerifiedError(cap);
}

/**
 * Placeholder for a real vendor until its API documentation and access are verified. It supports nothing and its
 * health check always reports "not connected" — the UI can never show such a site as connected.
 */
export class UnverifiedVendorAdapter implements EhrSchedulingAdapter {
  readonly vendor = "UNVERIFIED_VENDOR";
  readonly capabilities = emptyCapabilities();
  async health() {
    return { ok: false, latencyMs: 0, detail: "Vendor API access and capabilities have not been verified — not connected." };
  }
  private no(cap: EhrCapability): never {
    throw new CapabilityNotVerifiedError(cap);
  }
  getProviders = async () => this.no("getProviders");
  getLocations = async () => this.no("getLocations");
  getAvailability = async () => this.no("getAvailability");
  searchPatients = async () => this.no("searchPatients");
  createAppointment = async () => this.no("createAppointment");
  updateAppointment = async () => this.no("updateAppointment");
  cancelAppointment = async () => this.no("cancelAppointment");
  getAppointmentByExternalId = async () => this.no("getAppointmentByExternalId");
  pullChanges = async () => this.no("pullChanges");
}

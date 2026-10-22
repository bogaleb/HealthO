import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, updatedAt, version } from "./_common";
import { organizations, sites } from "./org";
import { users } from "./auth";
import { appointments } from "./scheduling";

// Phase 7 — EHR integration. Only the SYNTHETIC simulator is implemented; any other vendor row is "not connected"
// and has no verified capabilities until vendor documentation + access are verified (ADR-0012).

/** One EHR connection per site (the site's `ehr_sync_mode` decides how it is used). */
export const ehrConnections = pgTable(
  "ehr_connections",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    siteId: uuid("site_id").notNull(),
    vendor: text("vendor").notNull(),
    displayName: text("display_name").notNull(),
    /** Capability flags: { [capability]: { supported, verified, verifiedBy } } — only verified ones are ever used. */
    capabilities: jsonb("capabilities").notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    lastHealthAt: timestamp("last_health_at", { withTimezone: true }),
    lastHealthOk: boolean("last_health_ok"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    changesCursor: text("changes_cursor"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("ehr_connections_org_id_uq").on(t.organizationId, t.id),
    unique("ehr_connections_site_uq").on(t.organizationId, t.siteId),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
    check("ehr_connections_vendor_ck", sql`${t.vendor} in ('SYNTHETIC_SIMULATOR','UNVERIFIED_VENDOR')`),
  ],
);

/** Local appointment ↔ EHR appointment (exactly one mapping per appointment and per external id). */
export const ehrAppointmentLinks = pgTable(
  "ehr_appointment_links",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    connectionId: uuid("connection_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    externalId: text("external_id").notNull(),
    etag: text("etag"),
    externalStatus: text("external_status"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("ehr_appt_links_appt_uq").on(t.organizationId, t.appointmentId),
    unique("ehr_appt_links_ext_uq").on(t.connectionId, t.externalId),
    foreignKey({ columns: [t.organizationId, t.connectionId], foreignColumns: [ehrConnections.organizationId, ehrConnections.id] }),
    foreignKey({ columns: [t.organizationId, t.appointmentId], foreignColumns: [appointments.organizationId, appointments.id] }),
  ],
);

/** Patient / practitioner / location identifier mapping. A patient is only mapped on an unambiguous match. */
export const ehrResourceLinks = pgTable(
  "ehr_resource_links",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    connectionId: uuid("connection_id").notNull(),
    kind: text("kind").notNull(),
    localId: uuid("local_id").notNull(),
    externalId: text("external_id").notNull(),
    matchedBy: text("matched_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ehr_res_links_local_uq").on(t.connectionId, t.kind, t.localId),
    unique("ehr_res_links_ext_uq").on(t.connectionId, t.kind, t.externalId),
    foreignKey({ columns: [t.organizationId, t.connectionId], foreignColumns: [ehrConnections.organizationId, ehrConnections.id] }),
    check("ehr_res_links_kind_ck", sql`${t.kind} in ('PATIENT','PRACTITIONER','LOCATION')`),
  ],
);

/** Every health check / availability pull / change pull / reconciliation run, with counts (no PHI). */
export const integrationSyncRuns = pgTable(
  "integration_sync_runs",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    connectionId: uuid("connection_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats").notNull().default({}),
    error: text("error"),
  },
  (t) => [
    index("integration_runs_conn_idx").on(t.organizationId, t.connectionId, t.startedAt),
    check("integration_runs_kind_ck", sql`${t.kind} in ('HEALTH','AVAILABILITY','CHANGES','RECONCILE')`),
    check("integration_runs_status_ck", sql`${t.status} in ('OK','FAILED')`),
  ],
);

/** Mapping / reconciliation conflicts surfaced to staff. Never auto-resolved silently. */
export const integrationConflicts = pgTable(
  "integration_conflicts",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    connectionId: uuid("connection_id").notNull(),
    kind: text("kind").notNull(),
    appointmentId: uuid("appointment_id"),
    externalId: text("external_id"),
    detail: text("detail").notNull(),
    status: text("status").notNull().default("OPEN"),
    dedupeKey: text("dedupe_key").notNull(),
    resolution: text("resolution"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("integration_conflicts_dedupe_uq").on(t.organizationId, t.dedupeKey),
    index("integration_conflicts_open_idx").on(t.organizationId, t.status),
    check(
      "integration_conflicts_kind_ck",
      sql`${t.kind} in ('PATIENT_NOT_FOUND','PATIENT_AMBIGUOUS','UNMAPPED_RESOURCE','EXTERNAL_CANCELLED','EXTERNAL_CHANGED','MISSING_EXTERNAL','WRITE_REJECTED','WRITE_FAILED')`,
    ),
    check("integration_conflicts_status_ck", sql`${t.status} in ('OPEN','RESOLVED','DISMISSED')`),
  ],
);

// ---------------------------------------------------------------- synthetic EHR simulator (SYNTHETIC DATA ONLY)
// A stand-in "remote EHR" persisted in Postgres so the web app and the worker see the same remote state.
// It behaves like a FHIR R4 scheduling endpoint (Appointment / Patient / Practitioner / Location) with
// idempotency keys, ETags and a change feed, and can be told to fail for rehearsals.

export const ehrSimState = pgTable("ehr_sim_state", {
  connectionId: uuid("connection_id").primaryKey(),
  /** NONE | UNREACHABLE | FAIL_WRITES | TIMEOUT_AFTER_WRITE */
  failureMode: text("failure_mode").notNull().default("NONE"),
  changeSeq: bigint("change_seq", { mode: "number" }).notNull().default(0),
  updatedAt: updatedAt(),
});

export const ehrSimResources = pgTable(
  "ehr_sim_resources",
  {
    connectionId: uuid("connection_id").notNull(),
    externalId: text("external_id").notNull(),
    resourceType: text("resource_type").notNull(),
    /** Synthetic identifiers only: MRN for Patient, local UUID for Practitioner/Location. */
    identifier: text("identifier").notNull(),
    display: text("display").notNull(),
  },
  (t) => [uniqueIndex("ehr_sim_resources_pk").on(t.connectionId, t.externalId), index("ehr_sim_resources_ident_idx").on(t.connectionId, t.resourceType, t.identifier)],
);

export const ehrSimAppointments = pgTable(
  "ehr_sim_appointments",
  {
    connectionId: uuid("connection_id").notNull(),
    externalId: text("external_id").notNull(),
    patientRef: text("patient_ref"),
    practitionerRef: text("practitioner_ref").notNull(),
    locationRef: text("location_ref").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    /** FHIR Appointment.status subset: booked | cancelled */
    status: text("status").notNull(),
    versionId: integer("version_id").notNull().default(1),
    /** Who created it: PROJECTOS (via the adapter) or EHR (entered directly in the EHR by other staff). */
    origin: text("origin").notNull(),
    idempotencyKey: text("idempotency_key"),
    changeSeq: bigint("change_seq", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ehr_sim_appts_pk").on(t.connectionId, t.externalId),
    uniqueIndex("ehr_sim_appts_idem_uq").on(t.connectionId, t.idempotencyKey),
    index("ehr_sim_appts_seq_idx").on(t.connectionId, t.changeSeq),
    check("ehr_sim_appts_status_ck", sql`${t.status} in ('booked','cancelled')`),
  ],
);

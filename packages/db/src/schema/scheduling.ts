import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, smallint, text, time, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, updatedAt, version } from "./_common";
import { organizations, sites } from "./org";
import { users } from "./auth";
import { practitioners, services } from "./credentialing";

// Phase 4 scheduling. Patients here are SYNTHETIC ONLY until the PHI go-live gate is signed.
// Instants are timestamptz (UTC); local wall times appear only in templates (with the site's IANA zone).

const modalitiesCk = (col: unknown) => sql`${col} <@ array['IN_PERSON','VIDEO','AUDIO_ONLY']::text[] and cardinality(${col}) > 0`;

export const appointmentTypes = pgTable(
  "appointment_types",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    serviceId: uuid("service_id"),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    modalities: text("modalities").array().notNull(),
    requiresRoom: boolean("requires_room").notNull().default(false),
    minNoticeMinutes: integer("min_notice_minutes").notNull().default(0),
    maxDaysOut: integer("max_days_out").notNull().default(90),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("appointment_types_org_code_uq").on(t.organizationId, t.code),
    unique("appointment_types_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.serviceId], foreignColumns: [services.organizationId, services.id] }),
    check("appointment_types_duration_ck", sql`${t.durationMinutes} between 5 and 480`),
    check("appointment_types_buffers_ck", sql`${t.bufferBeforeMinutes} >= 0 and ${t.bufferAfterMinutes} >= 0`),
    check("appointment_types_modalities_ck", modalitiesCk(t.modalities)),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    siteId: uuid("site_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("rooms_org_site_code_uq").on(t.organizationId, t.siteId, t.code),
    unique("rooms_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
  ],
);

/** Recurring weekly working block for a provider at a site, in the SITE's time zone. Breaks are the gaps between blocks. */
export const scheduleTemplates = pgTable(
  "schedule_templates",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    practitionerId: uuid("practitioner_id").notNull(),
    siteId: uuid("site_id").notNull(),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    modalities: text("modalities").array().notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    index("schedule_templates_prac_idx").on(t.organizationId, t.practitionerId, t.weekday),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
    check("schedule_templates_weekday_ck", sql`${t.weekday} between 0 and 6`),
    check("schedule_templates_range_ck", sql`${t.endTime} > ${t.startTime}`),
    check("schedule_templates_dates_ck", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
    check("schedule_templates_modalities_ck", modalitiesCk(t.modalities)),
  ],
);

/** PTO, closures and ad-hoc blocks. Removing one sets cancelled_at (history kept). */
export const scheduleExceptions = pgTable(
  "schedule_exceptions",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    kind: text("kind").notNull(),
    practitionerId: uuid("practitioner_id"),
    siteId: uuid("site_id"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
  },
  (t) => [
    index("schedule_exceptions_range_idx").on(t.organizationId, t.startAt),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
    check("schedule_exceptions_kind_ck", sql`${t.kind} in ('PTO','CLOSURE','BLOCK')`),
    check("schedule_exceptions_range_ck", sql`${t.endAt} > ${t.startAt}`),
    check("schedule_exceptions_target_ck", sql`(${t.kind} = 'CLOSURE' and ${t.siteId} is not null) or (${t.kind} <> 'CLOSURE' and ${t.practitionerId} is not null)`),
  ],
);

/** Minimal patient index (no address, no contacts yet). SYNTHETIC ONLY until the PHI gate. */
export const patients = pgTable(
  "patients",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    mrn: text("mrn").notNull(),
    displayName: text("display_name").notNull(),
    birthYear: smallint("birth_year"),
    homeState: text("home_state"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("patients_org_mrn_uq").on(t.organizationId, t.mrn),
    unique("patients_org_id_uq").on(t.organizationId, t.id),
    unique("patients_org_external_uq").on(t.organizationId, t.externalSource, t.externalId),
    index("patients_org_name_idx").on(t.organizationId, t.displayName),
    check("patients_external_pair_ck", sql`(${t.externalSource} is null) = (${t.externalId} is null)`),
  ],
);

export const appointmentHolds = pgTable(
  "appointment_holds",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    practitionerId: uuid("practitioner_id").notNull(),
    siteId: uuid("site_id").notNull(),
    roomId: uuid("room_id"),
    appointmentTypeId: uuid("appointment_type_id").notNull(),
    modality: text("modality").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
  },
  (t) => [
    unique("appointment_holds_org_id_uq").on(t.organizationId, t.id),
    index("appointment_holds_status_exp_idx").on(t.status, t.expiresAt),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
    foreignKey({ columns: [t.organizationId, t.roomId], foreignColumns: [rooms.organizationId, rooms.id] }),
    foreignKey({ columns: [t.organizationId, t.appointmentTypeId], foreignColumns: [appointmentTypes.organizationId, appointmentTypes.id] }),
    check("appointment_holds_status_ck", sql`${t.status} in ('ACTIVE','CONVERTED','RELEASED','EXPIRED')`),
    check("appointment_holds_range_ck", sql`${t.endAt} > ${t.startAt}`),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    patientId: uuid("patient_id").notNull(),
    practitionerId: uuid("practitioner_id").notNull(),
    siteId: uuid("site_id").notNull(),
    roomId: uuid("room_id"),
    appointmentTypeId: uuid("appointment_type_id").notNull(),
    modality: text("modality").notNull(),
    /** Visit time (what the patient sees). */
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    /** Visit time widened by the type's buffers — what the resource reservations block. */
    reservedStartAt: timestamp("reserved_start_at", { withTimezone: true }).notNull(),
    reservedEndAt: timestamp("reserved_end_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),
    status: text("status").notNull(),
    patientLocationState: text("patient_location_state"),
    patientLocationStatus: text("patient_location_status").notNull().default("UNKNOWN"),
    providerLocationState: text("provider_location_state"),
    bookingChannel: text("booking_channel").notNull().default("STAFF"),
    dataSource: text("data_source").notNull().default("PROJECTOS_DEMO"),
    /** Before Phase 5 this is always POLICY_PENDING; it is never "eligible". */
    eligibilityStatus: text("eligibility_status").notNull().default("POLICY_PENDING"),
    cancelReason: text("cancel_reason"),
    holdId: uuid("hold_id"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("appointments_org_id_uq").on(t.organizationId, t.id),
    index("appointments_prac_start_idx").on(t.organizationId, t.practitionerId, t.startAt),
    index("appointments_site_start_idx").on(t.organizationId, t.siteId, t.startAt),
    index("appointments_patient_start_idx").on(t.organizationId, t.patientId, t.startAt),
    foreignKey({ columns: [t.organizationId, t.patientId], foreignColumns: [patients.organizationId, patients.id] }),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
    foreignKey({ columns: [t.organizationId, t.roomId], foreignColumns: [rooms.organizationId, rooms.id] }),
    foreignKey({ columns: [t.organizationId, t.appointmentTypeId], foreignColumns: [appointmentTypes.organizationId, appointmentTypes.id] }),
    check("appointments_range_ck", sql`${t.endAt} > ${t.startAt} and ${t.reservedStartAt} <= ${t.startAt} and ${t.reservedEndAt} >= ${t.endAt}`),
    check("appointments_status_ck", sql`${t.status} in ('HOLD','PENDING','CONFIRMED','CHECKED_IN','COMPLETED','NO_SHOW','CANCELLED','NEEDS_RESCHEDULE')`),
    check("appointments_modality_ck", sql`${t.modality} in ('IN_PERSON','VIDEO','AUDIO_ONLY')`),
    check("appointments_location_status_ck", sql`${t.patientLocationStatus} in ('PROPOSED','VERIFIED','UNKNOWN')`),
    check(
      "appointments_eligibility_ck",
      sql`${t.eligibilityStatus} in ('POLICY_PENDING','VERIFIED_ELIGIBLE','VERIFIED_INELIGIBLE','NEEDS_VERIFICATION','EXPIRED','POLICY_UNAVAILABLE')`,
    ),
  ],
);

/** Append-only lifecycle history (DB trigger blocks UPDATE/DELETE). Reason text is staff-entered: no clinical detail. */
export const appointmentEvents = pgTable(
  "appointment_events",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    appointmentId: uuid("appointment_id").notNull(),
    event: text("event").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorSystem: text("actor_system"),
    reason: text("reason"),
    before: jsonb("before_json"),
    after: jsonb("after_json"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("appointment_events_appt_idx").on(t.organizationId, t.appointmentId, t.at),
    foreignKey({ columns: [t.organizationId, t.appointmentId], foreignColumns: [appointments.organizationId, appointments.id] }),
  ],
);

/**
 * Every provider/room booking, hold and block competes here. The exclusion constraint
 * `resource_reservations_no_overlap` (migration 0006, btree_gist) forbids two ACTIVE rows for the same
 * resource with overlapping [start, end) ranges. Note: the partial condition is `state = 'ACTIVE'` only —
 * never now(): an expired hold keeps blocking until it is explicitly released.
 */
export const resourceReservations = pgTable(
  "resource_reservations",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("ACTIVE"),
    reservationKind: text("reservation_kind").notNull(),
    appointmentId: uuid("appointment_id"),
    holdId: uuid("hold_id"),
    createdAt: createdAt(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    index("resource_reservations_lookup_idx").on(t.organizationId, t.resourceType, t.resourceId, t.startAt),
    index("resource_reservations_appt_idx").on(t.appointmentId),
    index("resource_reservations_hold_idx").on(t.holdId),
    foreignKey({ columns: [t.organizationId, t.appointmentId], foreignColumns: [appointments.organizationId, appointments.id] }),
    foreignKey({ columns: [t.organizationId, t.holdId], foreignColumns: [appointmentHolds.organizationId, appointmentHolds.id] }),
    check("resource_reservations_type_ck", sql`${t.resourceType} in ('PRACTITIONER','ROOM','EQUIPMENT')`),
    check("resource_reservations_state_ck", sql`${t.state} in ('ACTIVE','RELEASED')`),
    check("resource_reservations_kind_ck", sql`${t.reservationKind} in ('APPOINTMENT','HOLD','BLOCK')`),
    check("resource_reservations_range_ck", sql`${t.endAt} > ${t.startAt}`),
    check(
      "resource_reservations_owner_ck",
      sql`(${t.reservationKind} = 'APPOINTMENT' and ${t.appointmentId} is not null) or (${t.reservationKind} = 'HOLD' and ${t.holdId} is not null) or ${t.reservationKind} = 'BLOCK'`,
    ),
  ],
);

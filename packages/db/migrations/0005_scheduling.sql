CREATE TABLE "appointment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_user_id" uuid,
	"actor_system" text,
	"reason" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"room_id" uuid,
	"appointment_type_id" uuid NOT NULL,
	"modality" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	CONSTRAINT "appointment_holds_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "appointment_holds_status_ck" CHECK ("appointment_holds"."status" in ('ACTIVE','CONVERTED','RELEASED','EXPIRED')),
	CONSTRAINT "appointment_holds_range_ck" CHECK ("appointment_holds"."end_at" > "appointment_holds"."start_at")
);
--> statement-breakpoint
CREATE TABLE "appointment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"service_id" uuid,
	"duration_minutes" integer NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"modalities" text[] NOT NULL,
	"requires_room" boolean DEFAULT false NOT NULL,
	"min_notice_minutes" integer DEFAULT 0 NOT NULL,
	"max_days_out" integer DEFAULT 90 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "appointment_types_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "appointment_types_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "appointment_types_duration_ck" CHECK ("appointment_types"."duration_minutes" between 5 and 480),
	CONSTRAINT "appointment_types_buffers_ck" CHECK ("appointment_types"."buffer_before_minutes" >= 0 and "appointment_types"."buffer_after_minutes" >= 0),
	CONSTRAINT "appointment_types_modalities_ck" CHECK ("appointment_types"."modalities" <@ array['IN_PERSON','VIDEO','AUDIO_ONLY']::text[] and cardinality("appointment_types"."modalities") > 0)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"room_id" uuid,
	"appointment_type_id" uuid NOT NULL,
	"modality" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reserved_start_at" timestamp with time zone NOT NULL,
	"reserved_end_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"status" text NOT NULL,
	"patient_location_state" text,
	"patient_location_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"provider_location_state" text,
	"booking_channel" text DEFAULT 'STAFF' NOT NULL,
	"data_source" text DEFAULT 'PROJECTOS_DEMO' NOT NULL,
	"eligibility_status" text DEFAULT 'POLICY_PENDING' NOT NULL,
	"cancel_reason" text,
	"hold_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "appointments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "appointments_range_ck" CHECK ("appointments"."end_at" > "appointments"."start_at" and "appointments"."reserved_start_at" <= "appointments"."start_at" and "appointments"."reserved_end_at" >= "appointments"."end_at"),
	CONSTRAINT "appointments_status_ck" CHECK ("appointments"."status" in ('HOLD','PENDING','CONFIRMED','CHECKED_IN','COMPLETED','NO_SHOW','CANCELLED','NEEDS_RESCHEDULE')),
	CONSTRAINT "appointments_modality_ck" CHECK ("appointments"."modality" in ('IN_PERSON','VIDEO','AUDIO_ONLY')),
	CONSTRAINT "appointments_location_status_ck" CHECK ("appointments"."patient_location_status" in ('PROPOSED','VERIFIED','UNKNOWN')),
	CONSTRAINT "appointments_eligibility_ck" CHECK ("appointments"."eligibility_status" in ('POLICY_PENDING','VERIFIED_ELIGIBLE','VERIFIED_INELIGIBLE','NEEDS_VERIFICATION','EXPIRED','POLICY_UNAVAILABLE'))
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mrn" text NOT NULL,
	"display_name" text NOT NULL,
	"birth_year" smallint,
	"home_state" text,
	"external_source" text,
	"external_id" text,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "patients_org_mrn_uq" UNIQUE("organization_id","mrn"),
	CONSTRAINT "patients_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "patients_org_external_uq" UNIQUE("organization_id","external_source","external_id"),
	CONSTRAINT "patients_external_pair_ck" CHECK (("patients"."external_source" is null) = ("patients"."external_id" is null))
);
--> statement-breakpoint
CREATE TABLE "resource_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'ACTIVE' NOT NULL,
	"reservation_kind" text NOT NULL,
	"appointment_id" uuid,
	"hold_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "resource_reservations_type_ck" CHECK ("resource_reservations"."resource_type" in ('PRACTITIONER','ROOM','EQUIPMENT')),
	CONSTRAINT "resource_reservations_state_ck" CHECK ("resource_reservations"."state" in ('ACTIVE','RELEASED')),
	CONSTRAINT "resource_reservations_kind_ck" CHECK ("resource_reservations"."reservation_kind" in ('APPOINTMENT','HOLD','BLOCK')),
	CONSTRAINT "resource_reservations_range_ck" CHECK ("resource_reservations"."end_at" > "resource_reservations"."start_at"),
	CONSTRAINT "resource_reservations_owner_ck" CHECK (("resource_reservations"."reservation_kind" = 'APPOINTMENT' and "resource_reservations"."appointment_id" is not null) or ("resource_reservations"."reservation_kind" = 'HOLD' and "resource_reservations"."hold_id" is not null) or "resource_reservations"."reservation_kind" = 'BLOCK')
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rooms_org_site_code_uq" UNIQUE("organization_id","site_id","code"),
	CONSTRAINT "rooms_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"practitioner_id" uuid,
	"site_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	CONSTRAINT "schedule_exceptions_kind_ck" CHECK ("schedule_exceptions"."kind" in ('PTO','CLOSURE','BLOCK')),
	CONSTRAINT "schedule_exceptions_range_ck" CHECK ("schedule_exceptions"."end_at" > "schedule_exceptions"."start_at"),
	CONSTRAINT "schedule_exceptions_target_ck" CHECK (("schedule_exceptions"."kind" = 'CLOSURE' and "schedule_exceptions"."site_id" is not null) or ("schedule_exceptions"."kind" <> 'CLOSURE' and "schedule_exceptions"."practitioner_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "schedule_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"modalities" text[] NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "schedule_templates_weekday_ck" CHECK ("schedule_templates"."weekday" between 0 and 6),
	CONSTRAINT "schedule_templates_range_ck" CHECK ("schedule_templates"."end_time" > "schedule_templates"."start_time"),
	CONSTRAINT "schedule_templates_dates_ck" CHECK ("schedule_templates"."effective_to" is null or "schedule_templates"."effective_to" >= "schedule_templates"."effective_from"),
	CONSTRAINT "schedule_templates_modalities_ck" CHECK ("schedule_templates"."modalities" <@ array['IN_PERSON','VIDEO','AUDIO_ONLY']::text[] and cardinality("schedule_templates"."modalities") > 0)
);
--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_organization_id_appointment_id_appointments_organization_id_id_fk" FOREIGN KEY ("organization_id","appointment_id") REFERENCES "public"."appointments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_organization_id_room_id_rooms_organization_id_id_fk" FOREIGN KEY ("organization_id","room_id") REFERENCES "public"."rooms"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_organization_id_appointment_type_id_appointment_types_organization_id_id_fk" FOREIGN KEY ("organization_id","appointment_type_id") REFERENCES "public"."appointment_types"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_organization_id_service_id_services_organization_id_id_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_patient_id_patients_organization_id_id_fk" FOREIGN KEY ("organization_id","patient_id") REFERENCES "public"."patients"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_room_id_rooms_organization_id_id_fk" FOREIGN KEY ("organization_id","room_id") REFERENCES "public"."rooms"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_appointment_type_id_appointment_types_organization_id_id_fk" FOREIGN KEY ("organization_id","appointment_type_id") REFERENCES "public"."appointment_types"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_organization_id_appointment_id_appointments_organization_id_id_fk" FOREIGN KEY ("organization_id","appointment_id") REFERENCES "public"."appointments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_organization_id_hold_id_appointment_holds_organization_id_id_fk" FOREIGN KEY ("organization_id","hold_id") REFERENCES "public"."appointment_holds"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_events_appt_idx" ON "appointment_events" USING btree ("organization_id","appointment_id","at");--> statement-breakpoint
CREATE INDEX "appointment_holds_status_exp_idx" ON "appointment_holds" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "appointments_prac_start_idx" ON "appointments" USING btree ("organization_id","practitioner_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_site_start_idx" ON "appointments" USING btree ("organization_id","site_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_start_idx" ON "appointments" USING btree ("organization_id","patient_id","start_at");--> statement-breakpoint
CREATE INDEX "patients_org_name_idx" ON "patients" USING btree ("organization_id","display_name");--> statement-breakpoint
CREATE INDEX "resource_reservations_lookup_idx" ON "resource_reservations" USING btree ("organization_id","resource_type","resource_id","start_at");--> statement-breakpoint
CREATE INDEX "resource_reservations_appt_idx" ON "resource_reservations" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "resource_reservations_hold_idx" ON "resource_reservations" USING btree ("hold_id");--> statement-breakpoint
CREATE INDEX "schedule_exceptions_range_idx" ON "schedule_exceptions" USING btree ("organization_id","start_at");--> statement-breakpoint
CREATE INDEX "schedule_templates_prac_idx" ON "schedule_templates" USING btree ("organization_id","practitioner_id","weekday");
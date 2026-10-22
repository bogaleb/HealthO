CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ehr_appointment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"etag" text,
	"external_status" text,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ehr_appt_links_appt_uq" UNIQUE("organization_id","appointment_id"),
	CONSTRAINT "ehr_appt_links_ext_uq" UNIQUE("connection_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "ehr_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"vendor" text NOT NULL,
	"display_name" text NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_health_at" timestamp with time zone,
	"last_health_ok" boolean,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"changes_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ehr_connections_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ehr_connections_site_uq" UNIQUE("organization_id","site_id"),
	CONSTRAINT "ehr_connections_vendor_ck" CHECK ("ehr_connections"."vendor" in ('SYNTHETIC_SIMULATOR','UNVERIFIED_VENDOR'))
);
--> statement-breakpoint
CREATE TABLE "ehr_resource_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"local_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"matched_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ehr_res_links_local_uq" UNIQUE("connection_id","kind","local_id"),
	CONSTRAINT "ehr_res_links_ext_uq" UNIQUE("connection_id","kind","external_id"),
	CONSTRAINT "ehr_res_links_kind_ck" CHECK ("ehr_resource_links"."kind" in ('PATIENT','PRACTITIONER','LOCATION'))
);
--> statement-breakpoint
CREATE TABLE "ehr_sim_appointments" (
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"patient_ref" text,
	"practitioner_ref" text NOT NULL,
	"location_ref" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"version_id" integer DEFAULT 1 NOT NULL,
	"origin" text NOT NULL,
	"idempotency_key" text,
	"change_seq" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ehr_sim_appts_status_ck" CHECK ("ehr_sim_appointments"."status" in ('booked','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "ehr_sim_resources" (
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"identifier" text NOT NULL,
	"display" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ehr_sim_state" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"failure_mode" text DEFAULT 'NONE' NOT NULL,
	"change_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"appointment_id" uuid,
	"external_id" text,
	"detail" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"dedupe_key" text NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_conflicts_dedupe_uq" UNIQUE("organization_id","dedupe_key"),
	CONSTRAINT "integration_conflicts_kind_ck" CHECK ("integration_conflicts"."kind" in ('PATIENT_NOT_FOUND','PATIENT_AMBIGUOUS','UNMAPPED_RESOURCE','EXTERNAL_CANCELLED','EXTERNAL_CHANGED','MISSING_EXTERNAL','WRITE_REJECTED','WRITE_FAILED')),
	CONSTRAINT "integration_conflicts_status_ck" CHECK ("integration_conflicts"."status" in ('OPEN','RESOLVED','DISMISSED'))
);
--> statement-breakpoint
CREATE TABLE "integration_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "integration_runs_kind_ck" CHECK ("integration_sync_runs"."kind" in ('HEALTH','AVAILABILITY','CHANGES','RECONCILE')),
	CONSTRAINT "integration_runs_status_ck" CHECK ("integration_sync_runs"."status" in ('OK','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "compliance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"requirement" text NOT NULL,
	"owner_role" text NOT NULL,
	"critical" boolean DEFAULT true NOT NULL,
	"external" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"evidence_ref" text,
	"notes" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "compliance_items_org_key_uq" UNIQUE("organization_id","key"),
	CONSTRAINT "compliance_items_status_ck" CHECK ("compliance_items"."status" in ('NOT_STARTED','IN_PROGRESS','EVIDENCE_SUBMITTED','BLOCKED','APPROVED')),
	CONSTRAINT "compliance_items_approval_ck" CHECK ("compliance_items"."status" <> 'APPROVED' or ("compliance_items"."approved_by" is not null and "compliance_items"."submitted_by" is not null and "compliance_items"."approved_by" <> "compliance_items"."submitted_by" and "compliance_items"."evidence_ref" is not null))
);
--> statement-breakpoint
CREATE TABLE "ops_drills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_by" text NOT NULL,
	CONSTRAINT "ops_drills_kind_ck" CHECK ("ops_drills"."kind" in ('BACKUP_RESTORE','CLINIC_DAY_REHEARSAL','DOWNTIME_PRINT')),
	CONSTRAINT "ops_drills_status_ck" CHECK ("ops_drills"."status" in ('PASS','FAIL'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "ehr_state" text DEFAULT 'NOT_APPLICABLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ehr_appointment_links" ADD CONSTRAINT "ehr_appointment_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ehr_appointment_links" ADD CONSTRAINT "ehr_appointment_links_organization_id_connection_id_ehr_connections_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."ehr_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ehr_appointment_links" ADD CONSTRAINT "ehr_appointment_links_organization_id_appointment_id_appointments_organization_id_id_fk" FOREIGN KEY ("organization_id","appointment_id") REFERENCES "public"."appointments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ehr_connections" ADD CONSTRAINT "ehr_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ehr_connections" ADD CONSTRAINT "ehr_connections_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ehr_resource_links" ADD CONSTRAINT "ehr_resource_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ehr_resource_links" ADD CONSTRAINT "ehr_resource_links_organization_id_connection_id_ehr_connections_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."ehr_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_conflicts" ADD CONSTRAINT "integration_conflicts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_conflicts" ADD CONSTRAINT "integration_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD CONSTRAINT "compliance_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD CONSTRAINT "compliance_items_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD CONSTRAINT "compliance_items_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_drills" ADD CONSTRAINT "ops_drills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "two_factors_user_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "two_factors" USING btree ("secret");--> statement-breakpoint
CREATE UNIQUE INDEX "ehr_sim_appts_pk" ON "ehr_sim_appointments" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ehr_sim_appts_idem_uq" ON "ehr_sim_appointments" USING btree ("connection_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ehr_sim_appts_seq_idx" ON "ehr_sim_appointments" USING btree ("connection_id","change_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "ehr_sim_resources_pk" ON "ehr_sim_resources" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "ehr_sim_resources_ident_idx" ON "ehr_sim_resources" USING btree ("connection_id","resource_type","identifier");--> statement-breakpoint
CREATE INDEX "integration_conflicts_open_idx" ON "integration_conflicts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "integration_runs_conn_idx" ON "integration_sync_runs" USING btree ("organization_id","connection_id","started_at");--> statement-breakpoint
CREATE INDEX "ops_drills_kind_idx" ON "ops_drills" USING btree ("kind","finished_at");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_exceptions_external_uq" ON "schedule_exceptions" USING btree ("organization_id","external_ref");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_ehr_state_ck" CHECK ("appointments"."ehr_state" in ('NOT_APPLICABLE','DRAFT','PENDING_CREATE','PENDING_UPDATE','PENDING_CANCEL','SYNCED','FAILED','CONFLICT'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_ehr_confirmed_ck" CHECK ("appointments"."ehr_state" not in ('DRAFT','PENDING_CREATE','FAILED') or "appointments"."status" not in ('CONFIRMED','CHECKED_IN','COMPLETED'));
CREATE TABLE "eligibility_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"appointment_id" uuid,
	"waitlist_offer_id" uuid,
	"practitioner_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"modality" text NOT NULL,
	"valid_for_instant" timestamp with time zone NOT NULL,
	"jurisdiction" text,
	"patient_location_state" text,
	"patient_location_status" text NOT NULL,
	"provider_location_state" text,
	"payer_plan_id" uuid,
	"decision" text NOT NULL,
	"can_confirm" boolean NOT NULL,
	"license_status" text NOT NULL,
	"payer_status" text NOT NULL,
	"ehr_mode" text NOT NULL,
	"flags" jsonb NOT NULL,
	"missing_evidence_codes" text[] NOT NULL,
	"evidence_ids" uuid[] NOT NULL,
	"policy_rule_id" uuid,
	"policy_version" text,
	"is_demo_policy" boolean DEFAULT false NOT NULL,
	"rule_effective_date" date,
	"next_required_review_at" date,
	"evaluated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"actor_user_id" uuid,
	"actor_system" text,
	CONSTRAINT "eligibility_evaluations_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "eligibility_evaluations_decision_ck" CHECK ("eligibility_evaluations"."decision" in ('ALLOW','REVIEW','BLOCK')),
	CONSTRAINT "eligibility_evaluations_confirm_ck" CHECK ("eligibility_evaluations"."can_confirm" = ("eligibility_evaluations"."decision" = 'ALLOW'))
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"modality" text NOT NULL,
	"patient_location_state" text NOT NULL,
	"payer_plan_id" uuid,
	"site_id" uuid,
	"practitioner_id" uuid,
	"earliest_date" date NOT NULL,
	"latest_date" date NOT NULL,
	"weekdays" smallint[] NOT NULL,
	"after_time" time,
	"before_time" time,
	"priority" smallint DEFAULT 2 NOT NULL,
	"note" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"appointment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "waitlist_entries_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "waitlist_entries_status_ck" CHECK ("waitlist_entries"."status" in ('ACTIVE','OFFERED','BOOKED','CANCELLED')),
	CONSTRAINT "waitlist_entries_dates_ck" CHECK ("waitlist_entries"."latest_date" >= "waitlist_entries"."earliest_date"),
	CONSTRAINT "waitlist_entries_priority_ck" CHECK ("waitlist_entries"."priority" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "waitlist_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"hold_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'OFFERED' NOT NULL,
	"eligibility_evaluation_id" uuid,
	"appointment_id" uuid,
	"responded_at" timestamp with time zone,
	"status_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_offers_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "waitlist_offers_status_ck" CHECK ("waitlist_offers"."status" in ('OFFERED','ACCEPTED','DECLINED','EXPIRED','INVALIDATED'))
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ehr_sync_mode" text DEFAULT 'DEMO' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ehr_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "ehr_freshness_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD COLUMN "purpose" text DEFAULT 'BOOKING' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "eligibility_decision" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "eligibility_evaluation_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "payer_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "eligibility_evaluations" ADD CONSTRAINT "eligibility_evaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_evaluations" ADD CONSTRAINT "eligibility_evaluations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_patient_id_patients_organization_id_id_fk" FOREIGN KEY ("organization_id","patient_id") REFERENCES "public"."patients"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_appointment_type_id_appointment_types_organization_id_id_fk" FOREIGN KEY ("organization_id","appointment_type_id") REFERENCES "public"."appointment_types"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_payer_plan_id_payer_plans_organization_id_id_fk" FOREIGN KEY ("organization_id","payer_plan_id") REFERENCES "public"."payer_plans"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_organization_id_entry_id_waitlist_entries_organization_id_id_fk" FOREIGN KEY ("organization_id","entry_id") REFERENCES "public"."waitlist_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_organization_id_hold_id_appointment_holds_organization_id_id_fk" FOREIGN KEY ("organization_id","hold_id") REFERENCES "public"."appointment_holds"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eligibility_evaluations_appt_idx" ON "eligibility_evaluations" USING btree ("organization_id","appointment_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "waitlist_entries_status_idx" ON "waitlist_entries" USING btree ("organization_id","status","priority");--> statement-breakpoint
CREATE INDEX "waitlist_offers_entry_idx" ON "waitlist_offers" USING btree ("organization_id","entry_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_payer_plan_id_payer_plans_organization_id_id_fk" FOREIGN KEY ("organization_id","payer_plan_id") REFERENCES "public"."payer_plans"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_ehr_mode_ck" CHECK ("sites"."ehr_sync_mode" in ('DEMO','STANDALONE_APPROVED','EHR_MASTER','READ_ONLY'));--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_purpose_ck" CHECK ("appointment_holds"."purpose" in ('BOOKING','WAITLIST_OFFER'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_decision_ck" CHECK ("appointments"."eligibility_decision" is null or "appointments"."eligibility_decision" in ('ALLOW','REVIEW','BLOCK'));
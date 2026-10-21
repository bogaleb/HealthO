CREATE TABLE "authority_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"authority_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"source_name" text,
	"source_url" text,
	"verified_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_deadline_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"authority_id" uuid NOT NULL,
	"threshold_days" text NOT NULL,
	"expires_on" date NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_notices_uq" UNIQUE("organization_id","authority_id","threshold_days","expires_on")
);
--> statement-breakpoint
CREATE TABLE "credentialing_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"case_type" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"owner_user_id" uuid,
	"due_date" date,
	"next_action" text,
	"authority_id" uuid,
	"enrollment_id" uuid,
	"task_id" uuid,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cases_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "cases_status_ck" CHECK ("credentialing_cases"."status" in ('OPEN','IN_PROGRESS','WAITING_EXTERNAL','COMPLETED','CANCELLED')),
	CONSTRAINT "cases_type_ck" CHECK ("credentialing_cases"."case_type" in ('INITIAL_CREDENTIALING','RECREDENTIALING','LICENSE_NEW_STATE','LICENSE_RENEWAL','PAYER_ENROLLMENT'))
);
--> statement-breakpoint
CREATE TABLE "license_policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"rule_version" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"profession" text NOT NULL,
	"service_category" text,
	"modality" text NOT NULL,
	"authorization_basis" text[] NOT NULL,
	"accepted_home_states" text[] DEFAULT '{}'::text[] NOT NULL,
	"provider_states" text[] DEFAULT '{}'::text[] NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"next_review_on" date NOT NULL,
	"source_url" text,
	"source_summary" text NOT NULL,
	"is_demo" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reason" text,
	"retired_by" uuid,
	"retired_at" timestamp with time zone,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_org_key_version_uq" UNIQUE("organization_id","rule_key","rule_version"),
	CONSTRAINT "rules_status_ck" CHECK ("license_policy_rules"."status" in ('DRAFT','APPROVED','RETIRED')),
	CONSTRAINT "rules_modality_ck" CHECK ("license_policy_rules"."modality" in ('IN_PERSON','VIDEO','AUDIO_ONLY')),
	CONSTRAINT "rules_dates_ck" CHECK ("license_policy_rules"."effective_to" is null or "license_policy_rules"."effective_to" > "license_policy_rules"."effective_from"),
	CONSTRAINT "rules_basis_nonempty_ck" CHECK (cardinality("license_policy_rules"."authorization_basis") > 0),
	CONSTRAINT "rules_basis_no_claims_ck" CHECK (not ('COMPACT_MEMBERSHIP_CLAIM' = any("license_policy_rules"."authorization_basis"))),
	CONSTRAINT "rules_approved_meta_ck" CHECK ("license_policy_rules"."status" <> 'APPROVED' or ("license_policy_rules"."approved_by" is not null and "license_policy_rules"."approved_at" is not null and "license_policy_rules"."approval_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "payer_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payer_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"requires_enrollment" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payer_plans_org_code_uq" UNIQUE("organization_id","payer_id","code"),
	CONSTRAINT "payer_plans_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "payers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payers_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "payers_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "practitioner_services" (
	"organization_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "practitioner_services_uq" UNIQUE("practitioner_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "practitioner_sites" (
	"organization_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	CONSTRAINT "practitioner_sites_uq" UNIQUE("practitioner_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "practitioner_specialties" (
	"organization_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"specialty_id" uuid NOT NULL,
	CONSTRAINT "practitioner_specialties_uq" UNIQUE("practitioner_id","specialty_id")
);
--> statement-breakpoint
CREATE TABLE "practitioners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"profession" text NOT NULL,
	"npi" text,
	"user_id" uuid,
	"physical_state" text,
	"telehealth_capable" boolean DEFAULT false NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "practitioners_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "practitioners_profession_ck" CHECK ("practitioners"."profession" in ('PHYSICIAN','APRN','RN','LPN','PSYCHOLOGIST','LCSW','LPC','PA'))
);
--> statement-breakpoint
CREATE TABLE "professional_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"authority_type" text NOT NULL,
	"profession" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"home_state" text,
	"license_number_last4" text,
	"issuing_authority" text,
	"effective_on" date NOT NULL,
	"expires_on" date,
	"restrictions" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"next_review_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "authorities_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "authorities_dates_ck" CHECK ("professional_authorities"."expires_on" is null or "professional_authorities"."expires_on" >= "professional_authorities"."effective_on"),
	CONSTRAINT "authorities_status_ck" CHECK ("professional_authorities"."status" in ('DRAFT','SUBMITTED','VERIFIED','REJECTED','SUSPENDED','REVOKED','EXPIRED')),
	CONSTRAINT "authorities_type_ck" CHECK ("professional_authorities"."authority_type" in ('STATE_LICENSE','MULTISTATE_LICENSE','APIT','TEMPORARY_PERMIT','DOCUMENTED_EXEMPTION','COMPACT_MEMBERSHIP_CLAIM')),
	CONSTRAINT "authorities_last4_ck" CHECK ("professional_authorities"."license_number_last4" is null or char_length("professional_authorities"."license_number_last4") <= 4),
	CONSTRAINT "authorities_verified_has_reviewer_ck" CHECK ("professional_authorities"."status" <> 'VERIFIED' or ("professional_authorities"."verified_by" is not null and "professional_authorities"."verified_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "provider_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"payer_plan_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"submitted_on" date,
	"approved_on" date,
	"effective_on" date,
	"terminated_on" date,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_source" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "enrollments_uq" UNIQUE("organization_id","practitioner_id","payer_plan_id","site_id"),
	CONSTRAINT "enrollments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "enrollments_status_ck" CHECK ("provider_enrollments"."status" in ('NOT_STARTED','SUBMITTED','AWAITING_INFO','APPROVED','DENIED','TERMINATED')),
	CONSTRAINT "enrollments_approved_dates_ck" CHECK ("provider_enrollments"."status" <> 'APPROVED' or ("provider_enrollments"."approved_on" is not null and "provider_enrollments"."effective_on" is not null))
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "services_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialties_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "specialties_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "authority_verifications" ADD CONSTRAINT "authority_verifications_organization_id_authority_id_professional_authorities_organization_id_id_fk" FOREIGN KEY ("organization_id","authority_id") REFERENCES "public"."professional_authorities"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_deadline_notices" ADD CONSTRAINT "credential_deadline_notices_organization_id_authority_id_professional_authorities_organization_id_id_fk" FOREIGN KEY ("organization_id","authority_id") REFERENCES "public"."professional_authorities"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentialing_cases" ADD CONSTRAINT "credentialing_cases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentialing_cases" ADD CONSTRAINT "credentialing_cases_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentialing_cases" ADD CONSTRAINT "credentialing_cases_organization_id_authority_id_professional_authorities_organization_id_id_fk" FOREIGN KEY ("organization_id","authority_id") REFERENCES "public"."professional_authorities"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentialing_cases" ADD CONSTRAINT "credentialing_cases_organization_id_enrollment_id_provider_enrollments_organization_id_id_fk" FOREIGN KEY ("organization_id","enrollment_id") REFERENCES "public"."provider_enrollments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentialing_cases" ADD CONSTRAINT "credentialing_cases_organization_id_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_policy_rules" ADD CONSTRAINT "license_policy_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_plans" ADD CONSTRAINT "payer_plans_organization_id_payer_id_payers_organization_id_id_fk" FOREIGN KEY ("organization_id","payer_id") REFERENCES "public"."payers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payers" ADD CONSTRAINT "payers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_services" ADD CONSTRAINT "practitioner_services_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_services" ADD CONSTRAINT "practitioner_services_organization_id_service_id_services_organization_id_id_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_sites" ADD CONSTRAINT "practitioner_sites_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_sites" ADD CONSTRAINT "practitioner_sites_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_specialties" ADD CONSTRAINT "practitioner_specialties_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_specialties" ADD CONSTRAINT "practitioner_specialties_organization_id_specialty_id_specialties_organization_id_id_fk" FOREIGN KEY ("organization_id","specialty_id") REFERENCES "public"."specialties"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_authorities" ADD CONSTRAINT "professional_authorities_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_enrollments" ADD CONSTRAINT "provider_enrollments_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_enrollments" ADD CONSTRAINT "provider_enrollments_organization_id_payer_plan_id_payer_plans_organization_id_id_fk" FOREIGN KEY ("organization_id","payer_plan_id") REFERENCES "public"."payer_plans"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_enrollments" ADD CONSTRAINT "provider_enrollments_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authority_verifications_auth_idx" ON "authority_verifications" USING btree ("authority_id","created_at");--> statement-breakpoint
CREATE INDEX "cases_org_status_due_idx" ON "credentialing_cases" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE INDEX "rules_lookup_idx" ON "license_policy_rules" USING btree ("organization_id","jurisdiction","profession","modality","status");--> statement-breakpoint
CREATE INDEX "practitioners_org_profession_idx" ON "practitioners" USING btree ("organization_id","profession");--> statement-breakpoint
CREATE INDEX "authorities_org_juris_prof_idx" ON "professional_authorities" USING btree ("organization_id","jurisdiction","profession","effective_on");--> statement-breakpoint
CREATE INDEX "authorities_org_status_exp_idx" ON "professional_authorities" USING btree ("organization_id","status","expires_on");
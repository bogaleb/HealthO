CREATE SEQUENCE "public"."rcm_case_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"resource_type" text,
	"resource_id" uuid,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_uq" UNIQUE("organization_id","user_id","dedupe_key"),
	CONSTRAINT "notifications_link_ck" CHECK ("notifications"."link" is null or "notifications"."link" ~ '^/[A-Za-z0-9/_?=&.-]*$')
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_dedupe_uq" UNIQUE("organization_id","dedupe_key"),
	CONSTRAINT "outbox_status_ck" CHECK ("outbox_events"."status" in ('PENDING','PROCESSING','DONE','FAILED','DEAD'))
);
--> statement-breakpoint
CREATE TABLE "rcm_assignment_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"items" jsonb NOT NULL,
	"case_count" integer NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rcm_batches_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "rcm_case_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"type" text NOT NULL,
	"note" text,
	"from_status" text,
	"to_status" text,
	"from_owner_user_id" uuid,
	"to_owner_user_id" uuid,
	"next_action" text,
	"next_action_due" date,
	"batch_id" uuid,
	"actor_user_id" uuid,
	"actor_system" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rcm_case_actions_actor_ck" CHECK (("rcm_case_actions"."actor_user_id" is not null) or ("rcm_case_actions"."actor_system" is not null))
);
--> statement-breakpoint
CREATE TABLE "rcm_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer DEFAULT nextval('rcm_case_number_seq') NOT NULL,
	"queue_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"site_id" uuid,
	"case_type" text NOT NULL,
	"claim_ref" text NOT NULL,
	"payer_id" uuid NOT NULL,
	"payer_plan_id" uuid,
	"service_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"denial_code" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"owner_user_id" uuid,
	"next_action" text,
	"next_action_due" date,
	"practitioner_id" uuid,
	"credentialing_case_id" uuid,
	"task_id" uuid,
	"escalated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"last_action_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rcm_cases_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "rcm_cases_org_number_uq" UNIQUE("organization_id","number"),
	CONSTRAINT "rcm_cases_status_ck" CHECK ("rcm_cases"."status" in ('OPEN','IN_PROGRESS','WAITING_PAYER','ESCALATED','RESOLVED','CLOSED_NO_ACTION')),
	CONSTRAINT "rcm_cases_priority_ck" CHECK ("rcm_cases"."priority" in ('LOW','MEDIUM','HIGH','URGENT')),
	CONSTRAINT "rcm_cases_type_ck" CHECK ("rcm_cases"."case_type" in ('DENIAL','NO_RESPONSE','UNDERPAYMENT','ENROLLMENT_BLOCKER','CODING_REVIEW','CORRECTED_CLAIM')),
	CONSTRAINT "rcm_cases_claim_ref_ck" CHECK ("rcm_cases"."claim_ref" ~ '^SYN-[A-Z0-9-]{2,30}$'),
	CONSTRAINT "rcm_cases_amount_ck" CHECK ("rcm_cases"."amount_cents" >= 0),
	CONSTRAINT "rcm_cases_resolved_ck" CHECK (("rcm_cases"."status" in ('RESOLVED','CLOSED_NO_ACTION')) = ("rcm_cases"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "rcm_queues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"department_id" uuid NOT NULL,
	"description" text,
	"lead_user_id" uuid,
	"follow_up_days" integer DEFAULT 14 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rcm_queues_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "rcm_queues_org_name_uq" UNIQUE("organization_id","name"),
	CONSTRAINT "rcm_queues_category_ck" CHECK ("rcm_queues"."category" in ('DENIAL_INITIATIVE','AGING_FOLLOW_UP','CREDENTIALING_PAYER','BILLING_QUALITY')),
	CONSTRAINT "rcm_queues_follow_up_ck" CHECK ("rcm_queues"."follow_up_days" between 1 and 90)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_assignment_batches" ADD CONSTRAINT "rcm_assignment_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_assignment_batches" ADD CONSTRAINT "rcm_assignment_batches_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_assignment_batches" ADD CONSTRAINT "rcm_assignment_batches_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_assignment_batches" ADD CONSTRAINT "rcm_assignment_batches_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_case_actions" ADD CONSTRAINT "rcm_case_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_case_actions" ADD CONSTRAINT "rcm_case_actions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_case_actions" ADD CONSTRAINT "rcm_case_actions_organization_id_case_id_rcm_cases_organization_id_id_fk" FOREIGN KEY ("organization_id","case_id") REFERENCES "public"."rcm_cases"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_cases" ADD CONSTRAINT "rcm_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_cases" ADD CONSTRAINT "rcm_cases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_cases" ADD CONSTRAINT "rcm_cases_organization_id_queue_id_rcm_queues_organization_id_id_fk" FOREIGN KEY ("organization_id","queue_id") REFERENCES "public"."rcm_queues"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_cases" ADD CONSTRAINT "rcm_cases_organization_id_department_id_departments_organization_id_id_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_cases" ADD CONSTRAINT "rcm_cases_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_cases" ADD CONSTRAINT "rcm_cases_organization_id_payer_id_payers_organization_id_id_fk" FOREIGN KEY ("organization_id","payer_id") REFERENCES "public"."payers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_cases" ADD CONSTRAINT "rcm_cases_organization_id_payer_plan_id_payer_plans_organization_id_id_fk" FOREIGN KEY ("organization_id","payer_plan_id") REFERENCES "public"."payer_plans"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_cases" ADD CONSTRAINT "rcm_cases_organization_id_practitioner_id_practitioners_organization_id_id_fk" FOREIGN KEY ("organization_id","practitioner_id") REFERENCES "public"."practitioners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_cases" ADD CONSTRAINT "rcm_cases_organization_id_credentialing_case_id_credentialing_cases_organization_id_id_fk" FOREIGN KEY ("organization_id","credentialing_case_id") REFERENCES "public"."credentialing_cases"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_cases" ADD CONSTRAINT "rcm_cases_organization_id_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_queues" ADD CONSTRAINT "rcm_queues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_queues" ADD CONSTRAINT "rcm_queues_lead_user_id_users_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_queues" ADD CONSTRAINT "rcm_queues_organization_id_department_id_departments_organization_id_id_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("organization_id","user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "outbox_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "rcm_case_actions_case_idx" ON "rcm_case_actions" USING btree ("organization_id","case_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_cases_open_claim_uq" ON "rcm_cases" USING btree ("organization_id","claim_ref","case_type") WHERE status not in ('RESOLVED','CLOSED_NO_ACTION');--> statement-breakpoint
CREATE INDEX "rcm_cases_org_queue_status_idx" ON "rcm_cases" USING btree ("organization_id","queue_id","status");--> statement-breakpoint
CREATE INDEX "rcm_cases_org_owner_idx" ON "rcm_cases" USING btree ("organization_id","owner_user_id","status");--> statement-breakpoint
CREATE INDEX "rcm_cases_org_due_idx" ON "rcm_cases" USING btree ("organization_id","next_action_due");
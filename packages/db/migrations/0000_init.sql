CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "departments_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "departments_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"grants" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_status_ck" CHECK ("invites"."status" in ('PENDING','ACCEPTED','REVOKED','EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"professional_role" text,
	"department_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memberships_org_user_uq" UNIQUE("organization_id","user_id"),
	CONSTRAINT "memberships_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "memberships_status_ck" CHECK ("memberships"."status" in ('ACTIVE','SUSPENDED','INVITED'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"slug" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"site_id" uuid,
	"department_id" uuid,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_grants_single_scope" CHECK (not ("role_grants"."site_id" is not null and "role_grants"."department_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roles_org_key_uq" UNIQUE("organization_id","key"),
	CONSTRAINT "roles_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"timezone" text NOT NULL,
	"address_line1" text,
	"city" text,
	"postal_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sites_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "sites_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "sites_state_len" CHECK (char_length("sites"."state") = 2)
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_org_dept_name_uq" UNIQUE("organization_id","department_id","name")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"outcome" text NOT NULL,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_actor_type_ck" CHECK ("audit_events"."actor_type" in ('USER','SYSTEM','ANONYMOUS')),
	CONSTRAINT "audit_outcome_ck" CHECK ("audit_events"."outcome" in ('ALLOW','DENY','ERROR'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_on" date,
	CONSTRAINT "idempotency_org_scope_key_uq" UNIQUE("organization_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "jobs_status_ck" CHECK ("jobs"."status" in ('PENDING','RUNNING','DONE','FAILED','DEAD'))
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestones_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "milestones_status_ck" CHECK ("milestones"."status" in ('OPEN','DONE'))
);
--> statement-breakpoint
CREATE TABLE "project_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_templates_org_name_uq" UNIQUE("organization_id","name"),
	CONSTRAINT "project_templates_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"department_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"health" text DEFAULT 'ON_TRACK' NOT NULL,
	"owner_user_id" uuid,
	"start_date" date,
	"due_date" date,
	"task_seq" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "projects_org_key_uq" UNIQUE("organization_id","key"),
	CONSTRAINT "projects_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "projects_status_ck" CHECK ("projects"."status" in ('PLANNING','ACTIVE','ON_HOLD','COMPLETED','CANCELLED')),
	CONSTRAINT "projects_health_ck" CHECK ("projects"."health" in ('ON_TRACK','AT_RISK','OFF_TRACK')),
	CONSTRAINT "projects_dates_ck" CHECK ("projects"."due_date" is null or "projects"."start_date" is null or "projects"."due_date" >= "projects"."start_date")
);
--> statement-breakpoint
CREATE TABLE "recurring_task_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"owner_user_id" uuid,
	"cadence" text NOT NULL,
	"weekday" integer,
	"month_day" integer,
	"timezone" text NOT NULL,
	"start_on" date NOT NULL,
	"due_in_days" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_generated_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "recurring_cadence_ck" CHECK ("recurring_task_definitions"."cadence" in ('DAILY','WEEKLY','MONTHLY')),
	CONSTRAINT "recurring_cadence_fields_ck" CHECK (("recurring_task_definitions"."cadence" <> 'WEEKLY' or "recurring_task_definitions"."weekday" between 0 and 6) and ("recurring_task_definitions"."cadence" <> 'MONTHLY' or "recurring_task_definitions"."month_day" between 1 and 28))
);
--> statement-breakpoint
CREATE TABLE "task_collaborators" (
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"blocking_task_id" uuid NOT NULL,
	"blocked_task_id" uuid NOT NULL,
	"kind" text DEFAULT 'BLOCKS' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_uq" UNIQUE("organization_id","blocking_task_id","blocked_task_id","kind"),
	CONSTRAINT "task_dependencies_not_self_ck" CHECK ("task_dependencies"."blocking_task_id" <> "task_dependencies"."blocked_task_id"),
	CONSTRAINT "task_dependencies_kind_ck" CHECK ("task_dependencies"."kind" in ('BLOCKS','RELATED'))
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"type" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"milestone_id" uuid,
	"parent_task_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'TODO' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"owner_user_id" uuid,
	"due_date" date,
	"due_timezone" text DEFAULT 'America/New_York' NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"recurring_definition_id" uuid,
	"occurrence_date" date,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tasks_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "tasks_project_number_uq" UNIQUE("project_id","number"),
	CONSTRAINT "tasks_status_ck" CHECK ("tasks"."status" in ('TODO','IN_PROGRESS','IN_REVIEW','BLOCKED','DONE','CANCELLED')),
	CONSTRAINT "tasks_priority_ck" CHECK ("tasks"."priority" in ('LOW','MEDIUM','HIGH','URGENT')),
	CONSTRAINT "tasks_depth_ck" CHECK ("tasks"."depth" in (0, 1)),
	CONSTRAINT "tasks_parent_not_self_ck" CHECK ("tasks"."parent_task_id" is null or "tasks"."parent_task_id" <> "tasks"."id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_department_id_departments_organization_id_id_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_organization_id_role_id_roles_organization_id_id_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."roles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_organization_id_department_id_departments_organization_id_id_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_role_id_roles_organization_id_id_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."roles"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_department_id_departments_organization_id_id_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_organization_id_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_organization_id_department_id_departments_organization_id_id_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_site_id_sites_organization_id_id_fk" FOREIGN KEY ("organization_id","site_id") REFERENCES "public"."sites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_department_id_departments_organization_id_id_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_task_definitions" ADD CONSTRAINT "recurring_task_definitions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_task_definitions" ADD CONSTRAINT "recurring_task_definitions_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_organization_id_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_organization_id_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_organization_id_blocking_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","blocking_task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_organization_id_blocked_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","blocked_task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_organization_id_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_milestone_id_milestones_organization_id_id_fk" FOREIGN KEY ("organization_id","milestone_id") REFERENCES "public"."milestones"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_parent_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","parent_task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_recurring_definition_id_recurring_task_definitions_organization_id_id_fk" FOREIGN KEY ("organization_id","recurring_definition_id") REFERENCES "public"."recurring_task_definitions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invites_org_email_idx" ON "invites" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "role_grants_membership_idx" ON "role_grants" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_pk" ON "role_permissions" USING btree ("role_id","permission");--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_org_resource_idx" ON "audit_events" USING btree ("organization_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "jobs_status_run_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_collaborators_pk" ON "task_collaborators" USING btree ("task_id","user_id");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_events_task_idx" ON "task_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_recurring_occurrence_uq" ON "tasks" USING btree ("organization_id","recurring_definition_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "tasks_org_project_status_idx" ON "tasks" USING btree ("organization_id","project_id","status","position");--> statement-breakpoint
CREATE INDEX "tasks_org_owner_due_idx" ON "tasks" USING btree ("organization_id","owner_user_id","due_date");--> statement-breakpoint
CREATE INDEX "tasks_org_status_due_idx" ON "tasks" USING btree ("organization_id","status","due_date");
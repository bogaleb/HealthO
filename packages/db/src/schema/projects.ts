import { sql } from "drizzle-orm";
import { boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, updatedAt, version } from "./_common";
import { departments, organizations, sites } from "./org";
import { users } from "./auth";

export const projectTemplates = pgTable(
  "project_templates",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    departmentId: uuid("department_id"),
    name: text("name").notNull(),
    description: text("description"),
    /** [{ title, priority, offsetDays, labels[] , milestone? }] */
    tasks: jsonb("tasks").notNull().default([]),
    milestones: jsonb("milestones").notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("project_templates_org_name_uq").on(t.organizationId, t.name),
    unique("project_templates_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.departmentId], foreignColumns: [departments.organizationId, departments.id] }),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    siteId: uuid("site_id"),
    departmentId: uuid("department_id"),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("ACTIVE"),
    health: text("health").notNull().default("ON_TRACK"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    taskSeq: integer("task_seq").notNull().default(0),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: version(),
  },
  (t) => [
    unique("projects_org_key_uq").on(t.organizationId, t.key),
    unique("projects_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
    foreignKey({ columns: [t.organizationId, t.departmentId], foreignColumns: [departments.organizationId, departments.id] }),
    check("projects_status_ck", sql`${t.status} in ('PLANNING','ACTIVE','ON_HOLD','COMPLETED','CANCELLED')`),
    check("projects_health_ck", sql`${t.health} in ('ON_TRACK','AT_RISK','OFF_TRACK')`),
    check("projects_dates_ck", sql`${t.dueDate} is null or ${t.startDate} is null or ${t.dueDate} >= ${t.startDate}`),
  ],
);

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    organizationId: orgId(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    dueDate: date("due_date"),
    status: text("status").notNull().default("OPEN"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("milestones_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete("cascade"),
    check("milestones_status_ck", sql`${t.status} in ('OPEN','DONE')`),
  ],
);

export const recurringTaskDefinitions = pgTable(
  "recurring_task_definitions",
  {
    id: id(),
    organizationId: orgId(),
    projectId: uuid("project_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull().default("MEDIUM"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    cadence: text("cadence").notNull(),
    weekday: integer("weekday"),
    monthDay: integer("month_day"),
    timezone: text("timezone").notNull(),
    startOn: date("start_on").notNull(),
    dueInDays: integer("due_in_days").notNull().default(0),
    active: boolean("active").notNull().default(true),
    lastGeneratedOn: date("last_generated_on"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("recurring_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete("cascade"),
    check("recurring_cadence_ck", sql`${t.cadence} in ('DAILY','WEEKLY','MONTHLY')`),
    check("recurring_cadence_fields_ck", sql`(${t.cadence} <> 'WEEKLY' or ${t.weekday} between 0 and 6) and (${t.cadence} <> 'MONTHLY' or ${t.monthDay} between 1 and 28)`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    organizationId: orgId(),
    projectId: uuid("project_id").notNull(),
    number: integer("number").notNull(),
    milestoneId: uuid("milestone_id"),
    parentTaskId: uuid("parent_task_id"),
    depth: integer("depth").notNull().default(0),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("TODO"),
    priority: text("priority").notNull().default("MEDIUM"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    dueDate: date("due_date"),
    dueTimezone: text("due_timezone").notNull().default("America/New_York"),
    labels: text("labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    position: doublePrecision("position").notNull().default(0),
    recurringDefinitionId: uuid("recurring_definition_id"),
    occurrenceDate: date("occurrence_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: version(),
  },
  (t) => [
    unique("tasks_org_id_uq").on(t.organizationId, t.id),
    unique("tasks_project_number_uq").on(t.projectId, t.number),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.milestoneId], foreignColumns: [milestones.organizationId, milestones.id] }),
    foreignKey({ columns: [t.organizationId, t.parentTaskId], foreignColumns: [t.organizationId, t.id] }),
    foreignKey({
      columns: [t.organizationId, t.recurringDefinitionId],
      foreignColumns: [recurringTaskDefinitions.organizationId, recurringTaskDefinitions.id],
    }),
    uniqueIndex("tasks_recurring_occurrence_uq").on(t.organizationId, t.recurringDefinitionId, t.occurrenceDate),
    check("tasks_status_ck", sql`${t.status} in ('TODO','IN_PROGRESS','IN_REVIEW','BLOCKED','DONE','CANCELLED')`),
    check("tasks_priority_ck", sql`${t.priority} in ('LOW','MEDIUM','HIGH','URGENT')`),
    check("tasks_depth_ck", sql`${t.depth} in (0, 1)`),
    check("tasks_parent_not_self_ck", sql`${t.parentTaskId} is null or ${t.parentTaskId} <> ${t.id}`),
    index("tasks_org_project_status_idx").on(t.organizationId, t.projectId, t.status, t.position),
    index("tasks_org_owner_due_idx").on(t.organizationId, t.ownerUserId, t.dueDate),
    index("tasks_org_status_due_idx").on(t.organizationId, t.status, t.dueDate),
  ],
);

export const taskCollaborators = pgTable(
  "task_collaborators",
  {
    organizationId: orgId(),
    taskId: uuid("task_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex("task_collaborators_pk").on(t.taskId, t.userId),
    foreignKey({ columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }).onDelete("cascade"),
  ],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: id(),
    organizationId: orgId(),
    taskId: uuid("task_id").notNull(),
    text: text("text").notNull(),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [foreignKey({ columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }).onDelete("cascade")],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: id(),
    organizationId: orgId(),
    blockingTaskId: uuid("blocking_task_id").notNull(),
    blockedTaskId: uuid("blocked_task_id").notNull(),
    kind: text("kind").notNull().default("BLOCKS"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("task_dependencies_uq").on(t.organizationId, t.blockingTaskId, t.blockedTaskId, t.kind),
    foreignKey({ columns: [t.organizationId, t.blockingTaskId], foreignColumns: [tasks.organizationId, tasks.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.blockedTaskId], foreignColumns: [tasks.organizationId, tasks.id] }).onDelete("cascade"),
    check("task_dependencies_not_self_ck", sql`${t.blockingTaskId} <> ${t.blockedTaskId}`),
    check("task_dependencies_kind_ck", sql`${t.kind} in ('BLOCKS','RELATED')`),
  ],
);

export const taskComments = pgTable(
  "task_comments",
  {
    id: id(),
    organizationId: orgId(),
    taskId: uuid("task_id").notNull(),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }).onDelete("cascade"),
    index("task_comments_task_idx").on(t.taskId, t.createdAt),
  ],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: id(),
    organizationId: orgId(),
    taskId: uuid("task_id").notNull(),
    actorUserId: uuid("actor_user_id"),
    type: text("type").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }).onDelete("cascade"),
    index("task_events_task_idx").on(t.taskId, t.createdAt),
  ],
);

# Prompt 02 — Working projects and task boards

Read project instructions/progress. Implement Phase 2 fully with real PostgreSQL persistence, permissions and audit. Do not touch patient scheduling yet.

Tables: projects, milestones, tasks, checklist_items, task_dependencies, task_comments, task_events, optional linked_resources; organization/site/department scoped. Task fields: title, description, accountable owner, collaborators, status, priority, due date/timezone, labels, blocking relation, optional parent (max two levels). Project has statuses, start/due, owners and health. Implement reusable task use-cases and list/board/calendar views with filtering and pagination. Create `/projects`, `/projects/[id]/board`, `/projects/[id]/list`, `/tasks/my-work`, project detail and task drawer; drag/drop persistence with keyboard accessible move action. Status changes log activity; reject dependency cycles, cross-org resource links and unauthorized access.

Add basic department templates and recurring task definition with idempotent generation (job can be run manually in tests). Tests: CRUD, permissions, task status persists, duplicate retry, dependency cycle, board E2E smoke. Seed small convincing synthetic projects for Billing Improvement and Provider Onboarding. Run exact commands and update progress.

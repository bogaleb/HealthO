# ADR-0011 — RCM work queues, reconciling reports and the notification outbox

Status: Accepted (Phase 6) · Date: 2026-10-21

## Context
Phase 6 adds revenue-cycle (RCM) work queues, an operations dashboard and due-soon/overdue reminders. The blueprint requires
SQL-derived metrics whose counts reconcile with their drill-downs, transactional permissions for bulk assignment, links to
project and credentialing work without duplicated records, and a Postgres outbox (no Redis, no SMS/email yet).

## Decisions
1. **Not a clearinghouse.** `rcm_cases` hold a *synthetic* claim reference (`SYN-…`, enforced by Zod and a DB CHECK), payer/plan,
   date of service, balance, reason code, status, priority, owner and next action. No claim lines, diagnosis/procedure codes,
   member IDs or patient identity. Real claim data stays out until the PHI go-live gate.
2. **Four queue categories** (`DENIAL_INITIATIVE`, `AGING_FOLLOW_UP`, `CREDENTIALING_PAYER`, `BILLING_QUALITY`). A queue belongs to a
   department and that is the visibility scope: department-scoped `rcm.*` grants see that department's cases; site-scoped grants
   see cases recorded at their site. Queue department is immutable (changing it would silently re-scope cases).
3. **Age category is derived, never stored**: `today − date of service` in the org time zone, buckets 0–30/31–60/61–90/91–120/120+.
   One shared table (`AGE_BUCKET_RANGE`) drives the UI label and the SQL filter; a unit test checks they agree for 0–400 days.
4. **Permissions.** New `rcm.manage` (rcm_supervisor, org_admin; migration 0010 adds it to existing orgs). Analysts (`rcm.edit`) work
   cases that are unassigned or theirs and may claim/release; assigning others, taking over a case, bulk assignment, undo and queue
   configuration need `rcm.manage` *for the case's scope*. The **assignee's own grants** are checked too (must hold `rcm.edit` there).
5. **Bulk assignment is all-or-nothing** in one transaction with `SELECT … FOR UPDATE`: invisible, out-of-scope, closed or stale
   (optional version map) cases abort the whole batch. Each batch is stored (`rcm_assignment_batches`) with previous owners and the
   version after assignment; **undo** restores them only if no case changed since — otherwise nothing changes.
6. **Append-only timeline.** `rcm_case_actions` is protected by the same trigger as `audit_events`. Every mutation also writes an
   audit event (DENY outcomes included).
7. **Links, not copies.** A case may link a credentialing case (the enrollment/licensure blocker) and a project task. The RCM page shows
   the live credentialing status; resolving the RCM case completes the linked task (same pattern as credentialing, ADR-0007).
8. **No duplicate work on retry.** A partial unique index allows one *open* case per (claim ref, case type); `POST /rcm/cases` also accepts
   an `Idempotency-Key` that replays the original case.
9. **Metrics registry** (`packages/reports`). Each metric is one scoped SQL query that returns its source rows plus `count(*) over()`. The
   tile reads the total from that query with `LIMIT 1`; the drill-down pages the same query. Metadata: definition, source tables,
   filters applied/ignored, date basis + default window, `computedAt`, latest source change, and EHR sites that are not current.
   Metrics are permission-filtered (a user only sees domains they can read) and every drill-down read is audited.
10. **Transactional outbox for notifications.** Domain transactions insert `outbox_events` (unique dedupe key); the worker claims rows
    with `FOR UPDATE SKIP LOCKED`, delivers to the in-app `notifications` table with `ON CONFLICT DO NOTHING` on (org, user, key), and
    marks DONE. Failures back off and become DEAD after `max_attempts`; stale PROCESSING rows are recovered; org admins can replay
    FAILED/DEAD outbox events and jobs (`/admin/worker`, audited). Because delivery is idempotent, crash-after-deliver or replay
    never duplicates. Due-soon/overdue reminders (RCM next actions, project tasks) are produced by an idempotent scan whose key
    includes the due date.
11. **No new runtime dependencies.** Accessibility checks are Playwright keyboard-only tests (Tab/Enter/Arrow/Escape) rather than an
    added axe dependency; an automated axe pass is a Phase 8 hardening item.

## Consequences
- Counts can be trusted to match their lists; adding a metric means adding one query, not a separate aggregate.
- Department scoping means org-wide RCM reporting needs an org-wide grant (executive/admin).
- Outbound email/SMS will be another outbox deliverer after a vetted vendor and BAA (Phase 7+); the in-app inbox stays the default.
- Live queries are fine at demo scale; materialized snapshots (with explicit freshness) are the scale-up path.

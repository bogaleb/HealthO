# ADR-0015 — PostgreSQL row-level security bound to the deployment's organization

_Status: accepted · Date: 2026-10-23 · Implements ADR-0002's deferred item and SAAS_EXPANSION_ESTIMATE WP1 (single-org part)_

## Decision
- Migration 0015 enables RLS on **every table with `organization_id`** (60), plus `organizations`. Each gets one `org_isolation` policy: `organization_id = app_current_org()` for reads **and** writes (`WITH CHECK`).
  - On the three tables where system rows have a NULL org (`audit_events`, `jobs`, `ops_drills`), the policy also allows `IS NULL`.
- `app_current_org()` reads the `app.org_id` setting. When it is unset or empty, every policy is false: **fail closed**.
- The runtime role `projectos_app` is bound to one organization with `ALTER ROLE … IN DATABASE … SET app.org_id`. The operator names the organization explicitly (`infra/sql/app-role.sql -v org_slug=…`), because drills create extra synthetic orgs.
- Table owners (migrations, seeds, drills, integration tests) are not subject to RLS (no `FORCE`). The application code did not change.
- Future migrations that add a tenant table must call `select app_enable_org_rls('<table>')`. The integration test `rls.int.test.ts` fails if any tenant table lacks the policy.

## Why this shape
- It needs **zero changes to the application**. There are no per-request transactions, so audit-on-deny and outbox semantics are unchanged. Yet a missing `WHERE organization_id` anywhere — page, API, worker, report or raw SQL — can no longer reveal or change another organization's rows. The same holds for an injected `organization_id` on insert.
- It matches the deployment model: one organization per deployment today, and database-per-tenant as the premium tier later (ADR-0014).
- A shared multi-tenant runtime would keep these policies unchanged and set `SET LOCAL app.org_id` per transaction instead (ADR-0014 WP2/WP8; it needs transaction-mode pooling and per-org worker loops).

## Evidence
- `packages/core/test/rls.int.test.ts` (4 tests, runs in CI):
  - every tenant table has the policy;
  - a role bound to org A sees 0 rows of org B in all 60 tables, while its own rows are visible;
  - updates and deletes of B rows affect 0 rows;
  - inserting a B row, or moving an A row to B, raises an RLS violation;
  - clearing the binding shows nothing.
- The full e2e suite passed 45/45 with the web server and worker connected as the RLS-bound `projectos_app` (fresh `db:reset`).
- The load test passed under RLS: p95 search 358 ms, save 203 ms, page 166 ms; exactly 1 of 20 racing bookings.
- Manual check: after `pnpm ops:rehearsal` created a second synthetic org with 9 appointments, `projectos_app` saw 1 organization and 0 foreign appointments. An `UPDATE` affected 0 rows, and an `INSERT` for a random org was refused.

## Consequences
- Operators must re-run `app-role.sql` (with `org_slug`) after creating the organization, and after a restore into a new database name. A wrongly bound role shows an empty application rather than a leak.
- Owners bypass RLS. Never run the application as the table owner in staging or production (RC SEC-DBROLE already requires this).

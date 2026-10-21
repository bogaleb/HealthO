# Architecture (as built — Phases 0–2)

```
Browser ──► Next.js (apps/web)
             ├─ proxy.ts             request id; cookie-presence redirect to /login (cheap gate only)
             ├─ app/(app)/**          server components → requireContext() → core use-cases
             ├─ app/api/v1/**         api() wrapper: session → AuthContext, same-origin check,
             │                        JSON size limit, Zod via use-case, stable error JSON, request id
             └─ app/api/auth/**       Better Auth (sign-in/out, sessions, rate limiting)
                     │
                     ▼
            packages/core  (use-cases; authorization + audit happen HERE, never only in UI)
                     │
            packages/auth (AuthContext, can/hasAny/scopeFilter)   packages/shared (Zod, errors, logger)
                     │
            packages/db (Drizzle schema + SQL migrations) ──► PostgreSQL 16
                                                                 ▲
apps/worker ── runDueJobs (FOR UPDATE SKIP LOCKED) ──────────────┘
```

## Request flow for a mutation
1. `api()` resolves the Better Auth session from the httpOnly cookie → `loadAuthContext(userId)` reads the active membership and grants fresh from Postgres. No membership → 403.
2. The use-case parses the body with a shared Zod schema (unknown keys such as `organizationId` are stripped).
3. It loads the target **within the caller's org and visibility scope** (404 if not visible), then `authorize(perm, scope)`; denials of sensitive actions write an audit row with outcome `DENY`.
4. The change, its `task_events` row (for tasks) and its `audit_events` row are written in **one transaction**; optimistic `version` checks return 409 on stale writes.

## Authorization model
- Permission catalog in code; roles in DB; role grants are org-wide or scoped to a site or department.
- Projects carry optional `site_id`/`department_id`; visibility = any `projects.read` grant matching that scope (org-wide grants see all). Tasks inherit their project's scope.
- See ADR-0002 for anti-escalation rules.

## Data integrity
- Composite FKs `(organization_id, id)` on all child tables → cross-org references are impossible at the DB level.
- `audit_events` is append-only via trigger (UPDATE/DELETE/TRUNCATE raise).
- Task dependency cycles: recursive CTE under a per-org advisory transaction lock.
- Recurring tasks: unique `(organization_id, recurring_definition_id, occurrence_date)` + row lock on the definition.
- Idempotent create: `idempotency_keys (organization_id, scope, key)` unique.

## Logging
`packages/shared/logger.ts` emits JSON lines and redacts any key matching name/email/password/token/session/body/etc. API logs contain method, route template path, status/code, duration and request id — never bodies.

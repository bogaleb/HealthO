# PROGRESS — ProjectOS Health

_Last updated: 2026-10-20 · Current phase: **Phase 2 complete → next is Phase 3 (Prompt 03_CREDENTIALING)**_

Mode: `DEVELOPMENT`, **synthetic data only**. External EHR: **not connected** (no integration code exists yet). Not approved for PHI.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, Postgres, migrations, seed, auth, health checks, logging, CI, docs | ✅ Done, verified |
| 1 | Org-scoped memberships, sites/departments/teams, roles & scoped grants, invites, staff/roles/sites/audit UI, server-side permission gates, negative tests | ✅ Done, verified |
| 2 | Projects, milestones, tasks (2-level), checklist, comments, dependencies, activity, board/list/calendar/My Work, templates, recurring tasks (idempotent), job worker | ✅ Done, verified |
| 3 | Practitioners, credential evidence, payer readiness | ⏳ Next |
| 4–9 | Scheduling, license-aware eligibility, RCM, EHR, hardening, SaaS | Not started |

## What works (verified in a real browser against PostgreSQL 16)
- Sign in / out (Better Auth, DB sessions, httpOnly cookies), generic error on bad credentials, sign-in rate limiting, redirect when signed out.
- Synthetic banner on every page; `/api/v1/health/live` and `/ready`.
- **Home**: SQL-derived counts with definitions + computed-at timestamp; each tile drills down to `/tasks` with the identical filter.
- **Staff & Permissions**: list/filter by department & status, invite (one-time code) → `/invite` acceptance, edit role grants with org/site/department scope, suspend/reactivate. Anti-escalation enforced server-side.
- **Roles**: built-in catalog + custom roles (org admins), permission checkboxes limited to what you hold.
- **Sites & Departments**: CRUD with IANA time zone + jurisdiction validation, activate/deactivate, departments & teams.
- **Audit log**: ALLOW/DENY/ERROR events with actor, request id, redacted metadata; DB trigger makes it append-only.
- **Projects**: portfolio with live open/overdue/done counts, create from template, scoped by department/site.
- **Board**: drag-and-drop + keyboard-accessible "move to" select and up/down buttons, optimistic update with rollback, blocked badges, filters; persists across reload.
- **List**: server-side filters (in the URL) + pagination. **Calendar**: month grid by due date. **My Work**: overdue/today/upcoming/no-date.
- **Task drawer** (URL `?task=`): edit fields with version check (409 → reload prompt), status, owner, collaborators, labels, due date, checklist, subtasks (max depth 2), dependencies with cycle guard, comments, activity feed, delete with confirmation.
- **Recurring tasks** + **worker** (`pnpm worker`): Postgres job queue, dedupe keys, `SKIP LOCKED`, backoff, dead-letter, stale-lock recovery.

## Verification (commands actually run, 2026-10-20)
| Command | Result |
|---|---|
| `pnpm lint` | ✅ 0 errors / 0 warnings (143 files) |
| `pnpm typecheck` | ✅ all 7 packages |
| `pnpm test` | ✅ 12/12 unit |
| `pnpm test:integration` | ✅ 34/34 (real PostgreSQL 16, includes second synthetic org) |
| `pnpm db:migrate` + `pnpm db:seed` on an empty database | ✅ |
| `pnpm build` | ✅ |
| `pnpm test:e2e` (Chromium 1440×900, fresh `db:reset`) | ✅ 20/20 |
| CI workflow (`.github/workflows/ci.yml`) | written, **not yet executed** (no GitHub repo connected) |
| `docker compose` | file written, **not executed here** (validated Postgres 16 natively instead) |

## Issues found and fixed during verification
- Pre-hydration native submit of React forms would have been a GET (login form → password in the URL). All client-handled forms are now `method="post"`.
- Board columns overflowed a 1440 px laptop screen (Done column off-screen during drag) → min column width 200 px.
- Sidebar "Sign out" was pushed below the fold by the synthetic banner → sticky banner + offset sidebar.
- Windows: migrate/seed "is main module" check failed on `C:\` paths → `pathToFileURL`.

## Known limitations / open items
1. **Invites are simulated** (code shown on screen, no email) — ADR-0006. Must change before any cloud deployment.
2. **No MFA/passkeys** yet — required before PHI (Better Auth plugin available).
3. CSP still allows inline scripts (Next.js runtime) — move to nonces in Phase 8.
4. No OpenAPI document generated yet (API documented in `docs/API.md`).
5. Rate limiting is in-memory per process (single instance only).
6. Board "calendar" view uses due dates only (no start dates/durations).
7. Saved filters per user and global search are not implemented.
8. Scheduling, licensure, credentialing, RCM modules do not exist yet — the UI says so instead of showing dead links.

## Next 3 tasks
1. **Prompt 03 — Credentialing**: `packages/credentialing` (practitioners, professional_authorities, verifications, payer enrollments, readiness), `/providers`, `/credentialing/*`, `/admin/rules` with dual control.
2. Generate OpenAPI from Zod schemas and contract-test `/api/v1`.
3. Push to a private GitHub repo and get CI green on GitHub Actions.

## Accepted ADRs
0001 modular monolith · 0002 single-org SaaS-ready · 0003 appointment source (proposed) · 0004 DB concurrency · 0005 stack selection · 0006 local invite simulation

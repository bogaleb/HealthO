# PROGRESS — ProjectOS Health

_Last updated: 2026-10-21 · Current phase: **Phase 4 complete → next is Phase 5 (Prompt 05_LICENSE_AWARE_MATCHING)**_

Mode: `DEVELOPMENT`, **synthetic data only**. External EHR: **not connected** (no integration code exists yet). Not approved for PHI.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, Postgres, migrations, seed, auth, health checks, logging, CI, docs | ✅ Done, verified |
| 1 | Org-scoped memberships, sites/departments/teams, roles & scoped grants, invites, staff/roles/sites/audit UI, server-side permission gates, negative tests | ✅ Done, verified |
| 2 | Projects, milestones, tasks (2-level), checklist, comments, dependencies, activity, board/list/calendar/My Work, templates, recurring tasks (idempotent), job worker | ✅ Done, verified |
| 3 | Practitioners, professional authorities + verification, license policy rules (dual control), payers/plans/enrollments, credentialing cases, readiness matrix, deadline job | ✅ Done, verified |
| 4 | Scheduling (synthetic demo): appointment types, rooms, working hours, time off/closures, synthetic patients, slot search, holds + expiry worker, booking/reschedule/cancel/status with DB exclusion constraint, calendar/find/new/setup UI | ✅ Done, verified |
| 5 | License-aware eligibility at search/booking/check-in | ⏳ Next |
| 6–9 | RCM, EHR, hardening, SaaS | Not started |

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
- **Providers** (`/providers`, `/providers/:id`): directory with filters and evidence counts; profile with sites/specialties/services, professional authorities (DRAFT → SUBMITTED → VERIFIED/REJECTED, SUSPENDED/REVOKED/EXPIRED; last-4 only), append-only verification history, per-jurisdiction readiness (in-person + video) and payer readiness.
- **Dual control** (default on): the submitter cannot verify evidence, a rule author cannot approve the rule, the person recording a payer approval cannot verify it — enforced server-side (HTTP 403) and in the UI.
- **License Policy Rules** (`/admin/rules`): effective-dated, versioned rules labelled *DEMO — not verified law*; approving v(n+1) retires v(n); approved rules immutable (DB trigger); compact *membership claims* can never be a basis (DB CHECK).
- **Readiness matrix** (`/credentialing/readiness`): practitioner × jurisdiction, ALLOW / REVIEW / BLOCK with reason codes and evidence IDs; fail-closed (no approved rule → "No approved policy"). Payer readiness is site-specific.
- **Payers & Plans** and **enrollments** per provider × plan × site; approval needs confirmation + effective dates and second-person verification.
- **Credentialing cases** (`/credentialing/cases`): queue with owner/due/status; "Link task" creates a project task, and completing the case moves that task to Done.
- **Deadline job** (`credentialing.deadlines`, daily in the worker; `POST /api/v1/jobs/credentialing-deadlines`): expires past-due evidence and creates one renewal task per 90/60/30-day threshold (idempotent across reruns and concurrent workers).
- **Scheduling (synthetic demo, `SCHEDULING_MODE=DEMO_ONLY`)**:
  - `/scheduling/find`: server-side search (working hours, time off, closures, rooms, existing bookings incl. buffers, notice/horizon) grouped by day and provider, every time with "why offered" and zone label; one click holds a time.
  - `/scheduling/appointments/new`: hold countdown, synthetic patient picker/creator, patient location at visit time (proposed/verified), idempotent booking; manual entry flags DST-nonexistent and repeated times.
  - `/scheduling/calendar`: day (by provider) and week views, site/provider filters, zone + DST notice, legend, accessible agenda table; drawer (`?appt=`) with details, append-only history, check-in/complete/no-show, cancel with reason, atomic reschedule.
  - `/scheduling/setup`: appointment types, rooms, weekly working hours, time off/closures (impacted bookings flagged, never auto-cancelled).
  - Eligibility is always shown as **policy pending**; nothing claims a provider is legally eligible.
- **Recurring tasks** + **worker** (`pnpm worker`): Postgres job queue, dedupe keys, `SKIP LOCKED`, backoff, dead-letter, stale-lock recovery.

## Verification (commands actually run, 2026-10-21, Next.js 16.4.2)
| Command | Result |
|---|---|
| `pnpm lint` / `pnpm format:check` | ✅ 0 errors / 0 warnings; formatted |
| `pnpm typecheck` | ✅ all 9 packages |
| `pnpm test` | ✅ 49/49 unit (incl. 11 slot/DST cases) |
| `pnpm test:integration` | ✅ 64/64 (real PostgreSQL 16; 20 scheduling cases: concurrency, rooms, buffers, holds, reschedule atomicity, DST, authz) |
| `pnpm db:reset` (migrations 0000–0006 + core + credentialing + scheduling seed) | ✅ |
| `pnpm build` | ✅ |
| `pnpm test:e2e` (fresh `db:reset`, server with `AUTH_SIGNIN_MAX_PER_MIN=1000`) | ✅ 29/29 on two consecutive fresh runs |
| `pnpm worker -- --once` | ✅ runs recurring, credential deadlines and hold expiry |
| Windows one-click (`START-WINDOWS.cmd`) | ✅ Phases 0–2 verified on the user's PC; later phases delivered via the same script (now also starts the worker) |
| CI workflow (`.github/workflows/ci.yml`) | written, **not yet executed** (no GitHub repo connected) |

## Issues found and fixed during verification
- Pre-hydration native submit of React forms would have been a GET (login form → password in the URL). All client-handled forms are now `method="post"`.
- Board columns overflowed a 1440 px laptop screen (Done column off-screen during drag) → min column width 200 px.
- Sidebar "Sign out" was pushed below the fold by the synthetic banner → sticky banner + offset sidebar.
- Windows: migrate/seed "is main module" check failed on `C:\` paths → `pathToFileURL`.
- Drizzle renders `${column}` unqualified in single-table selects, so correlated subqueries compared the inner table's `id` with itself (provider evidence counts were empty) → `qualified()` helper + regression test.
- Next.js 15.5 intermittently dropped navigation/refresh commits (12–30 % in loops) → upgraded to Next 16.4.2 (ADR-0008) plus a confirmed-refresh fallback.
- E2E tests that navigated before a PATCH finished (case → task sync) now wait for the response.
- Raw SQL with JS `Date` parameters fails under postgres.js → ISO strings with `::timestamptz` casts.
- Hold-expiry sweep and conflict alternatives used the wall clock instead of the injected `now` → threaded `now` through.

## Known limitations / open items
1. **Invites are simulated** (code shown on screen, no email) — ADR-0006. Must change before any cloud deployment.
2. **No MFA/passkeys** yet — required before PHI (Better Auth plugin available).
3. CSP still allows inline scripts (Next.js runtime) — move to nonces in Phase 8.
4. No OpenAPI document generated yet (API documented in `docs/API.md`).
5. Rate limiting is in-memory per process (single instance only).
6. Board "calendar" view uses due dates only (no start dates/durations).
7. Saved filters per user and global search are not implemented.
8. Booking-time license/payer eligibility (Phase 5), RCM and EHR modules do not exist yet. Scheduling is a **synthetic demo**: eligibility is "policy pending".
9. **License policy rules are demo content, not verified law.** A real deployment needs counsel-reviewed rules entered and approved by two people.
10. Credential evidence is entered manually; there is no primary-source (NPDB/state board/NURSYS) integration.
11. E2E tests mutate the demo data: run `pnpm db:reset` before a full run.
12. Scheduling gaps: no waitlist, no group/capacity>1 visits, no equipment reservations UI, no patient notifications, no check-in location re-check (Phase 5), working-hours list is long (no per-provider filter yet).
13. Expired holds are released by `pnpm worker` (or on the next conflicting booking). Without the worker an abandoned hold blocks its slot until then.

## Next 3 tasks
1. **Prompt 05 — License-aware matching** (`prompts/05_LICENSE_AWARE_MATCHING.md`): EligibilityService reusing the Phase 3 evaluators at search, booking, reschedule and check-in; immutable `eligibility_evaluations`; remove POLICY_PENDING.
2. Generate OpenAPI from Zod schemas and contract-test `/api/v1`.
3. Push to a private GitHub repo and get CI green on GitHub Actions.

## Accepted ADRs
0001 modular monolith · 0002 single-org SaaS-ready · 0003 appointment source (proposed) · 0004 DB concurrency · 0005 stack selection · 0006 local invite simulation · 0007 credentialing model · 0008 Next.js 16 upgrade · 0009 scheduling model

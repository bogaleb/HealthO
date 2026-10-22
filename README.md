# ProjectOS Health

Single-organization healthcare operations platform (SaaS-ready data model). This repository currently implements **Phase 0 (bootstrap), Phase 1 (organization security / RBAC) and Phase 2 (projects & task boards)** of `MASTER_BLUEPRINT.md`.

> **SYNTHETIC DATA ONLY.** No real patient information (PHI) may be entered in any environment until every item in `specs/GO_LIVE_CHECKLIST.md` is signed off. This software is not HIPAA-compliant by itself and is not approved for clinical use.

See `docs/PROGRESS.md` for exactly what works, what was verified, and what is next.

## Prerequisites

- **Node.js 22 LTS** (`node -v` → v22.x)
- **pnpm 10** — `corepack enable` (ships with Node) then `corepack prepare pnpm@10.28.0 --activate`
- **Docker Desktop** (or any PostgreSQL 16+ you can reach)
- Git

No paid services, cloud accounts or API keys are required.

## Windows one-click (recommended)

Double-click **`START-WINDOWS.cmd`**. It installs what is missing (Node LTS, pnpm, Docker Desktop via winget), creates `.env`, starts PostgreSQL in Docker on **127.0.0.1:5433**, migrates, seeds synthetic data, starts the app and the background worker (two windows) and opens http://localhost:3000. Progress is written to `setup.log`. Re-run it any time to start the app again.

## First-time setup (manual)

macOS / Linux / Git Bash:

```bash
cp .env.example .env
# Edit .env: set BETTER_AUTH_SECRET (32+ random chars) and DEMO_PASSWORD (12+ chars).
#   Generate a secret:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
docker compose up -d db          # PostgreSQL 16 on 127.0.0.1:5433 (also creates projectos_test)
pnpm install
pnpm db:migrate                  # applies packages/db/migrations to a clean database
pnpm db:seed                     # one SYNTHETIC organization, 3 sites, 6 demo staff, 2 projects
pnpm dev                         # http://localhost:3000
```

Windows PowerShell: same commands, but use `Copy-Item .env.example .env` for the first line.

Sign in at http://localhost:3000 with any seeded account (all use your `DEMO_PASSWORD`):

| Email | Role (scope) | Good for trying |
|---|---|---|
| avery.admin@riverbend.example | Organization Administrator | Staff, roles, sites, audit, everything |
| pat.morgan@riverbend.example | Project Manager + Executive | Boards, list, calendar, My Work |
| riley.shah@riverbend.example | RCM Analyst (Revenue Cycle dept only) | Work queues: claim, follow up, escalate; Billing project |
| drew.patel@riverbend.example | RCM Analyst (Revenue Cycle dept only) | Second analyst (bulk-assign target) |
| taylor.nguyen@riverbend.example | Revenue Cycle Supervisor (Revenue Cycle dept) | Bulk assign + undo, queues, escalations, notifications |
| casey.lin@riverbend.example | Credentialing Specialist (Credentialing dept only) | Sees only the Onboarding project |
| sam.ortiz@riverbend.example | Scheduler (Alexandria site only) | Least privilege: no admin, no projects edit |
| jordan.kim@riverbend.example | Auditor | Audit log (allow + deny events) |

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server on :3000 |
| `pnpm worker` | Background worker (Postgres job queue: recurring tasks, credential deadlines, hold expiry, eligibility rescreen, RCM/task reminders → notification outbox). `pnpm --filter @projectos/worker once` runs one tick. |
| `pnpm build && pnpm start` | Production build / serve |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Seed synthetic demo org (skips if already seeded; refuses outside DEVELOPMENT/DEMO_SYNTHETIC) |
| `pnpm db:reset` | **Drop everything**, re-migrate, re-seed (synthetic modes only) |
| `pnpm db:generate` | Generate a new migration after editing `packages/db/src/schema` |
| `pnpm lint` / `pnpm typecheck` | ESLint (incl. architecture rule) / TypeScript strict across all packages |
| `pnpm test` | Unit tests (no database) |
| `pnpm test:integration` | Integration tests against `TEST_DATABASE_URL` — **wipes that database** |
| `pnpm test:e2e` | Playwright browser tests against the running app + seeded DB |

### Running the E2E suite

```bash
pnpm exec playwright install chromium   # once
pnpm db:reset && pnpm build
AUTH_SIGNIN_MAX_PER_MIN=1000 pnpm start   # the suite signs in many times; default limit is 10/min/IP
pnpm test:e2e                             # in a second terminal
```

### Full stack in containers

```bash
docker compose --profile app up --build   # db + web (runs migrations on start) + worker
docker compose exec web pnpm db:seed
```

## Health checks

- `GET /api/v1/health/live` → process up (no dependencies, no PHI)
- `GET /api/v1/health/ready` → DB reachable within 2 s and migration count; `503` otherwise

## Repository layout

```
apps/web          Next.js App Router: pages, /api/v1 route handlers, UI
apps/worker       Postgres-polling job runner (FOR UPDATE SKIP LOCKED)
packages/db       Drizzle schema, SQL migrations, migrate/reset scripts
packages/auth     Better Auth config + server-derived AuthContext & permission evaluation
packages/core     Use-cases: org/sites/users/roles/invites, projects/tasks, recurring jobs, audit, seed
packages/shared   Permission catalog, Zod schemas, errors, redacting logger, date helpers
packages/ui       Accessible UI primitives (Button, Field, Dialog, Badge, states)
docs/             PROGRESS, ADRs, architecture, API, test matrix
e2e/              Playwright specs
```

Future modules (scheduling, licensing, credentialing, RCM, integrations) are intentionally **not** scaffolded yet.

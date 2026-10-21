# Prompt 00 — Bootstrap a working local app

You are the lead engineer building ProjectOS Health. Read `CLAUDE.md` and `MASTER_BLUEPRINT.md` fully before editing. Follow the non-negotiable one-organization, low-cost and synthetic-only constraints. Do not create a visual-only prototype. Build a **running** web app and database now.

Deliver Phase 0:
1. Inspect the repository. If new, initialize pnpm workspaces and the specified monorepo folder structure. Use Next.js App Router + TypeScript strict + Tailwind + shadcn/ui + PostgreSQL 16+ + Drizzle + Zod + Vitest + Playwright. Select maintained compatible dependency versions, pin package-lock equivalent, record selections.
2. Add PostgreSQL in Docker Compose, a web service and a simple worker shell (can be no-op initially); document local prerequisites. No Redis, Kubernetes, paid auth/email/cloud.
3. Add migration runner and an initial schema for organizations, sites, users/memberships, audit events; seed **one** demo organization, one site and one demonstration admin (synthetic only). Demo credentials in local setup documentation must be environment-defined and never exposed in production or committed as a secret.
4. Add authentication foundation using a maintained auth framework. Render functional `/login`, `/home`, `/admin/sites`. Do not invent login security. For Phase 0 a narrowly scoped local demo-login may be used only behind explicit DEMO mode and with an upgrade task tracked before cloud deployment.
5. Add proper seed banner, home navigation shell, `/api/v1/health/live`, `/api/v1/health/ready`, structured redacted logging.
6. Add ESLint, formatting, TypeScript strict, unit tests, first integration test, basic CI actions, `.env.example`, `/docs/PROGRESS.md`, and `README.md` with exact startup and reset commands.
7. Run commands for startup, migrate, seed, smoke tests, lint, typecheck and build. Fix all failures. If an external runtime is unavailable, explain and leave reproducible commands—not fictional results.

Acceptance: user can start services, sign into a seeded synthetic organization, view a real site from PostgreSQL, reload successfully; tests are green, no PHI transmitted. End with implemented files, verified commands/results and exact next action.

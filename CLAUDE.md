# Claude Code Project Instructions — ProjectOS Health

Read this file, `MASTER_BLUEPRINT.md`, `docs/PROGRESS.md` (if present), and the current phase prompt **before any implementation**.

## Mission
Build a low-cost, maintainable, functioning single-organization healthcare operations system that can later become multi-tenant SaaS. Modules: patient/provider scheduling, licensure-aware eligibility, credentialing, RCM work queues, project/task management. A great-looking nonfunctional mock is not completion.

## Binding decisions
- Next.js App Router + TypeScript strict + pnpm monorepo + PostgreSQL 16+ + Drizzle ORM + Tailwind/shadcn + Zod + Vitest + Playwright.
- Modular monolith; one web deployment, one simple PostgreSQL-backed worker; do not add Redis/Kafka/Kubernetes by default.
- Local `docker compose` first. Online demo permitted only with synthetic data. No PHI until separate security/legal/BAA/EHR go-live gates.
- One seeded organization and multiple sites/teams. Include and enforce `organization_id` in every domain table; no user-controllable tenant ID.
- Clinical/provider eligibility is deterministic and evidence-based. Unknown/unverified -> no routine booking. AI cannot decide licensure.
- Booking concurrency must be backed by DB exclusion constraint plus transaction revalidation.
- Any EHR integration is stub until vendor API access and source-of-truth policy are verified. Never claim confirmed external sync without acknowledgment.
- No third-party AI, text/email, monitoring or analytics receives real PHI without appropriate approval and agreements.
- Build each phase as tested vertical slices: UI + API + DB + authorization + audit + tests.

## Coding discipline
1. At start: `pwd`, list files, read docs, check Git and migrations. Identify current phase and give a short implementation plan.
2. Do not ask for confirmations that have already been decided. If a choice is not essential, choose the lowest-cost maintainable default and document ADR.
3. Implement ONLY the requested phase and dependencies; avoid speculative modules, fake endpoints and uncontrolled package installation.
4. Use clean domain boundaries (`packages/*`); auth at server use-case layer; shared runtime validation with Zod.
5. Do not bypass authorization in direct server actions, report routes, scheduled jobs or import tools.
6. Every migration must apply to a clean PostgreSQL database. Use SQL for exclusion constraints and other PG features when needed.
7. For appointment mutations, re-evaluate license/payer/resource eligibility in the same transactional workflow; no client-side authority.
8. Every significant mutation has an audit event and accountable actor or system identity. Redact patient identity from generic logs.
9. Every feature needs error/empty/loading states and keyboard-accessible controls; no dead UI buttons.
10. Use seed records visibly marked `SYNTHETIC DEMO DATA`; no real names, medical identifiers or imported clinical records.
11. Add targeted tests and run `pnpm lint`, `pnpm typecheck`, `pnpm test`, integration and Playwright as possible. If not runnable, say precisely why.
12. Update `/docs/PROGRESS.md`, `/docs/DECISIONS`, commands and `.env.example` as needed. Always document what really works and what does not.
13. Prefer idempotent retries and explicit external failure states; never quietly drop appointments or retries.
14. Use secure headers, server-side validation and safe error messages; never include tokens or PHI in URLs or logs.
15. Do not say “HIPAA-compliant” or “ready for live patients” without a documented external compliance signoff.

## Default folder layout
```
apps/web                 apps/worker
packages/db              packages/auth
packages/core            packages/scheduling
packages/licensing       packages/credentialing
packages/rcm             packages/notifications
packages/integrations    packages/ui
packages/shared
docs/                    prompts/
```

## At end of every response include
**Implemented:** routes/features tested.  
**Changed files:** paths.  
**Verification:** exact commands and pass/fail.  
**Risks/limitations:** including whether synthetic only and external EHR disconnected.  
**Next action:** exact name of next prompt or smallest next ticket.

## Session restart protocol
1. Read `docs/PROGRESS.md`, last Git commits, failing tests, and current prompt.
2. Continue the smallest incomplete verified task, not a redesign.
3. Do not overwrite previously working files without inspecting current implementation.

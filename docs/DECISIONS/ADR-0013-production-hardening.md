# ADR-0013 — Production hardening without a compliance claim

_Status: accepted (Phase 8) · Date: 2026-10-22_

## Context
Prompt 08 asks for technical hardening based on the documented risk register, infrastructure-as-code for approved
environments, validation drills and a real release-candidate checklist. It also says not to declare compliance for the
organization, not to assume a BAA makes anything compliant, and to keep synthetic data until sign-off.

## Decisions
1. **CSP:** a per-request nonce plus `'strict-dynamic'` for scripts. No `'unsafe-inline'` or `'unsafe-eval'` in production. Consequences:
   - The root layout reads `headers()`, so every page is dynamic. That was already true for every authenticated page.
   - Styles keep `'unsafe-inline'`, because React `style` attributes cannot carry a nonce. The residual risk (CSS injection) is low because there is no user-controlled HTML.
2. **Rate limiting:** stored in Postgres (`rate_limits`, Better Auth `storage: "database"`), not Redis. Counters survive restarts and are shared by every web task without adding a service (CLAUDE.md: no Redis by default). `TRUSTED_PROXY_CIDRS` makes the client IP unspoofable behind the ALB. The worker prunes old rows hourly, and dumps exclude them.
3. **Release images:**
   - Web is the Next.js `standalone` server.
   - Worker and migrate are esbuild bundles (workspace TypeScript compiled in).
   - The runtime images have no pnpm, no source and no dev dependencies, and run as the non-root `node` user.
   - Migrations are a **separate release task**, never run at web start-up.
   - A CI guard keeps the Dockerfile's workspace manifest list complete. That list was the Phase 7 defect.
4. **Database access:**
   - Runtime tasks connect as `projectos_app` (DML only, cannot disable the append-only triggers).
   - Only the migrate task uses the RDS-managed master secret.
   - Cloud tasks build their connection string from `DB_*` variables injected from Secrets Manager, with `sslmode=verify-full` against the RDS CA bundle shipped in the image.
5. **Release safety:**
   - `release:migrate` does an encrypted pre-migration backup, then migrate, then a smoke check (Drizzle schema-contract drift + migration count). On *any* failure it restores the backup **with grants** and proves the data is identical.
   - Expand/contract migrations make "redeploy the previous image" the normal rollback.
   - The clean-deployment restore drill proves a backup can bring up a working deployment: server, sign-in, probes and a worker tick.
6. **Validation suites:**
   - An auto-discovered privilege-escalation matrix over every mutating route.
   - axe WCAG 2.1 A/AA on 22 critical pages.
   - A log scanner that checks real patient identities from the DB.
   - A load test with performance budgets.
   - All of these are recorded as `ops_drills` kinds and readiness checks.
7. **Infrastructure:**
   - Terraform/OpenTofu for a single-region AWS stack: ECS Fargate, RDS, ALB+WAF, KMS, Secrets Manager, AWS Backup, CloudWatch.
   - A **PHI gate** (`terraform_data.phi_gate` preconditions) needs evidence references, not a boolean alone.
   - Validated, tested with a mocked provider and statically scanned. **Not applied.**
8. **Language:**
   - The RC checklist uses PASS/BLOCKED with evidence.
   - "Compliant" or "ready for live patients" is never stated.
   - Items owned by the organization are marked as such.

## Alternatives rejected
- **Redis for rate limits/sessions:** another service to secure, pay for and scope. Postgres is enough at this scale.
- **Running migrations on web boot:** races across tasks, no pre-migration backup, and a failed migration takes the app down.
- **`next start` with full `node_modules` in the image:** about 5× larger, and ships dev tooling (risk register #7).
- **NAT replaced by interface endpoints:** costs more for this footprint (COST_REPORT.md).
- **Kubernetes:** excluded by the blueprint.

## Consequences
- `docker build` could not be executed in the authoring sandbox (no registry access). The release images are therefore BLOCKED in the RC checklist until built on the PC or in CI. The artifacts inside them were run and verified outside Docker.
- CI security workflows are written but unexecuted until the repository is on GitHub.

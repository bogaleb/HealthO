# Changelog

All notable changes. Versions follow SemVer; release images are tagged by git SHA. **Synthetic data only — NOT APPROVED FOR REAL PHI.**

## Unreleased (0.3.0-rc.2)
- **Row-level security** on every tenant table (migration 0015, ADR-0015); runtime role bound to its organization via `infra/sql/app-role.sql -v org_slug=…`; fail closed when unbound.
- Fixed: credential/rule form dates used the browser's time zone instead of the organization's.
- Phase 9 commercial-SaaS estimate and ADR-0014 (proposed; implementation gated on a pilot).
- CI: Node 24 action versions, runner pinned to ubuntu-24.04.

## 0.3.0-rc.1 — 2026-10-22 (Phase 8: production hardening)
### Security
- Nonce-based Content-Security-Policy (no inline/eval scripts in production); HSTS.
- Sign-in / two-factor rate limits stored in Postgres (`rate_limits`, migration 0013) — survive restarts, shared across instances;
  trusted-proxy client-IP resolution (`TRUSTED_PROXY_CIDRS`).
- Fixed: RCM bulk-assign undo and waitlist offer revealed record state (409) to unauthorized users before the permission check.
- Least-privilege runtime DB role (`infra/sql/app-role.sql`); cloud DB connections use `sslmode=verify-full`.
- vitest 4.1.12 and an esbuild override: `pnpm audit --prod` clean; CI audit now fails on high/critical.
- Accessibility: contrast fixes (navigation headings, board counts, tables, calendar labels), focusable calendar scroll region.
### Operations
- Release images: Next.js standalone web, bundled worker and migrate (no dev deps, non-root); compose `app` profile runs migrate → web + worker.
- `/api/v1/health/live` reports `{version, gitSha}`; worker logs its release at start.
- New commands: `release:migrate`, `ops:migration-drill`, `ops:clean-restore`, `ops:load-test`, `security:scan-logs`, `check:dockerfile`, `build:bundles`.
- `ops_drills` kinds LOAD_TEST, MIGRATION_ROLLBACK, CLEAN_DEPLOY_RESTORE (migration 0014) + three readiness checks.
- Worker job `maintenance.prune` (hourly).
### Infrastructure & docs
- `infra/terraform`: AWS reference stack with PHI gate (validated + tested + checkov; not applied).
- `.github/workflows/security.yml` (CodeQL, gitleaks, audit, IaC, image build + Trivy) — not yet executed.
- RC checklist, cost report, operations handbook, release runbook, AWS service-scope worksheet, ADR-0013.

## 0.2.0 — Phases 0–7
Foundation, org/permissions, projects/tasks, credentialing, scheduling, eligibility, RCM + reports + outbox, EHR adapter
with synthetic simulator, PHI-readiness checklist, MFA, restore drill, clinic-day rehearsal.

# Release candidate checklist — v0.3.0-rc.1

_Date: 2026-10-22 · Build: Phase 8 · Scope of this RC: **SYNTHETIC staging deployment only** · Verdict: **NOT APPROVED FOR REAL PHI**_

Each item has one status:

- **PASS** means the evidence was produced for this RC and is reproducible with the command shown.
- **BLOCKED** means the item cannot pass inside this repository. It needs an external party, an executed agreement, a deployed environment, or people.

Nothing here declares the organization compliant with HIPAA or any other regime. Compliance is decided outside the software (docs/compliance/READINESS_REPORT.md).

**Release decision:** this RC may be deployed to a sandbox or staging AWS account that holds synthetic data only (infra/terraform with `phi_approved = false`). It may **not** receive real patient information. The BLOCKED rows are the remaining path. Rows marked *(owner: org)* belong to the organization, not to the software.

## A. Application security

| ID | Item | Status | Evidence |
|---|---|---|---|
| SEC-CSP | Nonce-based CSP: no inline or eval scripts in production | PASS | `apps/web/proxy.ts`. Unit test `apps/web/test/hardening.unit.test.ts`. A standalone production server returned a `script-src 'self' 'nonce-…' 'strict-dynamic'` header, and 0 of the `<script>` tags on /login lacked the nonce. 45/45 e2e passed with the policy active. Styles keep `'unsafe-inline'` (React style attributes), see ADR-0013. |
| SEC-HDR | Security headers: HSTS, frame-deny, nosniff, referrer, permissions, COOP | PASS | `apps/web/next.config.ts`, checked with `curl -I`. |
| SEC-RL | Sign-in rate limit shared across instances and restarts | PASS | Counters live in the `rate_limits` table (migration 0013). Test `rl.sh` sent 10 bad sign-ins (all 401), the 11th got 429, the server restarted, and the next attempt still got 429. Stale rows are pruned by the worker job `maintenance.prune`. |
| SEC-XFF | Client IP behind the load balancer cannot be spoofed with X-Forwarded-For | PASS | `TRUSTED_PROXY_CIDRS` is wired into Better Auth (`packages/auth/src/server.ts`) and set to the VPC CIDR in Terraform. Header `6.6.6.6, 198.51.100.7, 10.40.1.12` with trusted 10.40.0.0/16 resolves to `198.51.100.7`. Without the setting the same chain resolves to *no IP* (the gap this fixes). The edge WAF also rate-limits `/api/auth/*`. |
| SEC-MFA | MFA for privileged roles | PASS | Phase 7 e2e (enrol, second factor, disable). Enforced outside synthetic modes; the ECS task sets `REQUIRE_MFA_FOR_PRIVILEGED=true`. |
| SEC-PRIV | Privilege escalation matrix covering every mutating API route, auto-discovered | PASS | `e2e/authz-matrix.spec.ts`, 3/3 passed. Unauthenticated calls to all 90 mutating handlers (88 route files; invite acceptance is public by design) returned 401. The Auditor role got no 2xx or 5xx, and 0 responses that revealed state before authorization. The scheduler hitting admin-only routes got no 2xx. The audit log shows 0 ALLOW mutations. **Two real defects found and fixed:** RCM bulk-assign *undo* and waitlist *offer* returned 409 (state) before checking permission. |
| SEC-DBROLE | Runtime connects as a least-privilege DB role (DML only) | PASS | `infra/sql/app-role.sql`. The full e2e suite passed 45/45 (fresh `db:reset`) with the web server **and** the worker ticks connected as `projectos_app` (confirmed in `pg_stat_activity`). `ALTER TABLE audit_events DISABLE TRIGGER` as that role is refused with *must be owner*. |
| SEC-LOG | Logs contain no patient identifiers or credentials | PASS | `pnpm security:scan-logs` checked web (incl. load test), worker, e2e and drill logs (660 lines) against all 54 patient identities in the DB plus credential patterns: 0 findings. The scanner was itself tested on a planted name (it reported it). It runs in CI after e2e. |
| SEC-SECRETS | No secrets in the repository | PASS | `pnpm security:scan`. Terraform creates secret *containers* only; values are set out-of-band and never enter state. |
| SEC-DEPS | No known vulnerable production dependencies | PASS | `pnpm audit --prod` reports *No known vulnerabilities found* (vitest 4.1.12, esbuild override). The CI step now fails on high or critical. |
| SEC-SAST | CodeQL + gitleaks (history) + image scan (Trivy) | BLOCKED | `.github/workflows/security.yml` is written and its YAML parses. It has **never executed**, because no GitHub repository is connected. |
| SEC-IMG | Slim, non-root release images (web, worker, migrate) | PASS | Built on the user's PC with Docker Desktop (2026-10-22, `_to_delete/rc-docker-build.cmd`): `projectos-web:rc1` 434 MB, `projectos-worker:rc1` 331 MB, `projectos-migrate:rc1` 332 MB (sizes include the `node:22-bookworm-slim` base; no pnpm, source or dev deps). Smoke against the local Postgres (`rc-docker-smoke.cmd`): runs as `uid=1000(node)`; migrate → *migrations applied*; worker logs release `0.3.0-rc.1 / 36816b3`; web container **healthy**, `/health/ready` 200 with 15 migrations, CSP nonce on 17/17 scripts, synthetic sign-in 200, `/api/v1/me` 200. CI guard `pnpm check:dockerfile`. Trivy scan still pending (SEC-SAST). |
| SEC-ROFS | Read-only root filesystem for web containers | BLOCKED | The worker and migrate tasks are read-only. Web is not yet: Next.js writes `.next/cache`, and Fargate scratch-volume ownership for the non-root user is unverified. Verify in staging. |
| SEC-PEN | Independent penetration test | BLOCKED *(owner: org)* | Not performed. |

## B. Data protection and infrastructure

| ID | Item | Status | Evidence |
|---|---|---|---|
| INF-IAC | Infrastructure as code for approved environments | PASS (validated, not applied) | `infra/terraform`. `tofu validate` reports *configuration is valid*. `tofu test` passed 4/4 with a mocked provider: staging plans, production plans, and the PHI gate refuses `phi_approved=true` without BAA and scope evidence and refuses an approved APP_MODE. checkov 3.2.400 reports 313 passed, 0 failed, 16 skipped, each skip justified in code. Tools: OpenTofu 1.10.6 and AWS provider 6.66.0 (checksums verified). |
| INF-APPLY | Stack applied to a staging account | BLOCKED *(owner: org)* | Needs an AWS account, domain, ACM certificate and state bucket. **Never applied by the authors.** |
| INF-NET | Network restrictions | PASS (in IaC) | Private app subnets and isolated DB subnets with no route out. SG chain ALB→web→DB only, ingress limited to `allowed_ingress_cidrs`, VPC flow logs, default SG emptied. |
| INF-TLS | HTTPS everywhere | BLOCKED | IaC: TLS 1.2/1.3 listener policy, HTTP→HTTPS 301, `rds.force_ssl=1`, app→DB `sslmode=verify-full` with the RDS CA bundle in the image. Not live until applied with a real certificate. |
| INF-ENC | Encryption at rest: DB, backups, logs, secrets, images | PASS locally / BLOCKED in AWS | Locally the restore drill uses AES-256-GCM with a decrypt round-trip verified. In IaC: KMS CMKs with rotation for RDS, Performance Insights, S3, the backup vault, Secrets Manager, ECR, CloudWatch Logs and SNS. Not applied. |
| INF-IAM | Least-privilege IAM | PASS (in IaC) | The execution role can only pull these repos, write these log groups and read these secrets. Task roles have **no** AWS permissions. No ECS Exec. CI deploy uses GitHub OIDC limited to `environment:<env>`. |
| INF-BAA | Executed AWS BAA | BLOCKED *(owner: org)* | Not available to the authors. Terraform refuses `phi_approved=true` without `baa_reference`. **A BAA does not make any service or configuration compliant by itself.** |
| INF-SCOPE | Every service used is HIPAA-eligible, checked on the decision day | BLOCKED *(owner: org)* | The AWS reference page did not render a machine-readable list for us on 2026-10-22, so nothing is asserted. Services to check are listed in docs/ops/AWS_SERVICE_SCOPE.md. |

## C. Operations

| ID | Item | Status | Evidence |
|---|---|---|---|
| OPS-RESTORE | Encrypted backup → verified restore | PASS | `pnpm ops:restore-drill`: PASS, 0 mismatches, audit trigger restored, RTO ≈ 1 s (synthetic size). |
| OPS-CLEAN | DB restore into a **clean deployment** | PASS | `pnpm ops:clean-restore`: PASS. Steps: encrypted dump → decrypt → brand-new DB → release migrations → schema-drift smoke OK (15/15 migrations) → data identical → production server ready → synthetic sign-in 200 → 5 HTTP probes 200 → worker tick exit 0. RTO 7 s. First run found that restored rate-limit counters locked users out, so they are now excluded from dumps. |
| OPS-MIG | Release migration with automatic rollback | PASS | `pnpm release:migrate`: MIGRATED (encrypted pre-migration backup, smoke OK). `pnpm ops:migration-drill`: PASS. (a) a SQL error mid-migration rolled back with data identical; (b) a "successful" destructive migration was caught by the schema-drift smoke (`tasks.description` missing) and restored with data identical and app-role grants intact; (c) a normal release migrated. |
| OPS-LOAD | Concurrency load test | PASS (sandbox scale) | `pnpm ops:load-test`: 20 concurrent bookings of one slot gave **exactly 1 × 201 + 19 × 409**, 0 × 5xx across all 234 requests. Single machine, not production sizing; repeat against staging. |
| OPS-PERF | Performance budget | PASS (sandbox) | p95 slot search 299 ms (≤ 2000), task save 171 ms (≤ 1500), page render 134 ms (≤ 2500). First-load JS gzip 194–240 KB (≤ 300). The ALB p95 alarm uses the same 2 s budget. |
| OPS-EHR | EHR outage behaviour | PASS (simulator) | Phase 7 e2e EHR-01/02 + `pnpm ops:rehearsal` 9/9 (outage → drafts only, recovery → confirmed, exactly-once). The real vendor is BLOCKED (see D). |
| OPS-CLINIC | Clinic outage plan | PASS (document + synthetic drill) / BLOCKED (staff tabletop) | docs/compliance/DOWNTIME_PLAN.md (now includes clinic-site outages). Downtime print tested. A tabletop with real front-desk staff is *(owner: org)*. |
| OPS-A11Y | Accessible critical workflows | PASS (automated) / BLOCKED (manual) | `e2e/a11y-axe.spec.ts`: 22 pages, WCAG 2.1 A/AA, **0 serious/critical** violations after fixing contrast in nav headings, the board, tables and the calendar, plus a non-focusable scroll region. The keyboard-only journeys in `e2e/a11y-keyboard.spec.ts` pass. A manual screen-reader pass (NVDA/VoiceOver) has not been done. |
| OPS-VER | Release versioning | PASS | SemVer `0.3.0-rc.1`. `/api/v1/health/live` returns `{version, gitSha}` and the worker logs it at start. Images are tagged by git SHA (immutable ECR). See CHANGELOG.md. |
| OPS-STAGE | Staging → production migration plan and rollback plan | PASS (written + rehearsed locally) / BLOCKED (executed in AWS) | docs/ops/RELEASE_RUNBOOK.md. The rollback was rehearsed by OPS-MIG and the ECS circuit breaker (IaC). |
| OPS-MON | Monitoring and alerting | PASS (in IaC) / BLOCKED (live) | 8 CloudWatch alarms + a dead-letter metric filter → KMS-encrypted SNS. Container Insights. Each alarm maps to a handbook section. |
| OPS-HANDBOOK | Operations handbook and runbooks | PASS | docs/ops/OPERATIONS_HANDBOOK.md, RELEASE_RUNBOOK.md, docs/compliance/*. |
| OPS-ONCALL | Named on-call, incident commander, privacy officer | BLOCKED *(owner: org)* | Roles are defined in the handbook; no people are assigned. |
| OPS-COST | Realistic cost report | PASS | docs/release/COST_REPORT.md, from `node scripts/ops/cost-model.mjs` with prices checked 2026-10-22. About $127/month staging and about $199/month production, infrastructure only. |

## D. Product and legal gates (unchanged from Phase 7, all external)

| ID | Item | Status |
|---|---|---|
| GATE-DATA | Synthetic or approved test data only until sign-off | PASS (enforced: seeds are synthetic-mode only, banner on every page, Terraform `DataClass=SYNTHETIC`) |
| GATE-PHI | Readiness verdict | **NOT APPROVED FOR REAL PHI**: 0/19 checklist items approved. Technical checks: 7/13 pass on the demo DB (all three Phase 8 drill checks PASS); APP_MODE, MFA enforcement, TLS, DEMO rules, source of truth and dead letters fail. |
| GATE-RULES | Licensure rules reviewed by counsel | BLOCKED *(owner: org)* |
| GATE-EHR | Real EHR vendor adapter, sandbox and capability sign-off | BLOCKED *(owner: org + vendor)* |
| GATE-INVITE | Email invitations through a vetted vendor (with BAA if PHI-adjacent) | BLOCKED *(vendor decision)* |
| GATE-RISK | Formal risk analysis, policies, workforce training | BLOCKED *(owner: org)* |

## E. Rebuilding the release images on the Windows PC (Docker Desktop)
```powershell
cd C:\Users\sinha\Downloads\HealthO
docker build --target web     -t projectos-web:rc1 .
docker build --target worker  -t projectos-worker:rc1 .
docker build --target migrate -t projectos-migrate:rc1 .
docker compose --profile app up -d   # migrate → web + worker; then open http://localhost:3000
```

# infra/terraform — AWS reference stack (Phase 8)

> **Do not apply to an account that will hold real PHI** until docs/release/RC_CHECKLIST.md rows INF-BAA, INF-SCOPE and
> GATE-* are cleared by the organization. Terraform itself refuses `phi_approved = true` without a BAA reference and a
> service-scope check date, and refuses an approved `app_mode` without `phi_approved`. **An AWS BAA does not make any
> service or configuration compliant automatically.**

What it creates:

- **Network:** a VPC across 2 AZs with public (ALB + NAT), private app and isolated DB subnets, plus VPC flow logs.
- **Load balancer and edge:**
  - ALB with TLS 1.2/1.3 and HTTP→HTTPS redirect.
  - WAF: AWS common rules, known-bad-inputs, and an `/api/auth` rate limit. WAF logs are redacted and keep blocks only.
- **Compute:** ECS Fargate (web ×N, worker ×1, a one-off migrate task).
  - Non-root containers with all capabilities dropped and no ECS Exec.
  - Read-only root filesystem for worker and migrate.
- **Database:** RDS PostgreSQL 16 (Multi-AZ in production).
  - KMS encryption, forced TLS, statement logging off.
  - PITR, deletion protection, and a managed master secret.
- **Keys, secrets and images:**
  - KMS CMKs with rotation.
  - Secrets Manager containers (values are set out-of-band).
  - Immutable, scanned, KMS-encrypted ECR repositories.
- **Backups:** an S3 backup bucket (KMS, versioned, TLS-only, access-logged) and an AWS Backup daily plan.
- **IAM and alerts:**
  - Least-privilege IAM; task roles have no AWS permissions.
  - Optional GitHub OIDC deploy role.
  - CloudWatch alarms → KMS-encrypted SNS.

Validated (2026-10-22) — **never applied by the authors**:
```
tofu fmt -check -recursive && tofu init -backend=false && tofu validate     # ✅ valid
tofu test                                                                     # ✅ 4/4 (mocked provider: staging, production, PHI gate ×2)
checkov -d . --framework terraform                                            # ✅ 313 passed / 0 failed / 16 skipped (justified inline)
```
The `.terraform.lock.hcl` is not committed: it was generated from a local provider mirror. Run `tofu init` (or
`terraform init`) once with registry access and commit the lock file from that run.

Usage: see docs/ops/RELEASE_RUNBOOK.md (§2 staging, §6 first production deployment) and the cost estimate in
docs/release/COST_REPORT.md. Least-privilege DB role: `infra/sql/app-role.sql`.

# Release runbook — staging → production, migration and rollback

Applies to the AWS reference stack (infra/terraform). **Synthetic data only** until the go-live gate in docs/release/RC_CHECKLIST.md is cleared.

Every release is one immutable image set (web, worker and migrate) tagged with the **git SHA**, plus a SemVer entry in CHANGELOG.md.

## 0. Rules
- One release at a time. Production deploys only images that passed staging. Never deploy a `latest` tag (ECR is immutable).
- Migrations are **expand → contract**. A release may add tables, columns or indexes that the previous code ignores. It must not drop or rename anything the *previous* release still uses. Destructive changes ship one release later, after nothing reads the old shape. This is what makes "roll back the code, keep the database" safe.
- Every migration must apply to a clean database (CI `db:migrate`) and to a copy of the current data (staging).
- Freeze windows: no production release during clinic hours, or within 24 h of a known EHR maintenance window.

## 1. Build (CI, on merge to `main`)
1. `ci.yml` must be green. It covers lint, types, unit, integration, migrations on a clean DB, build, e2e, log PHI scan, load test, migration-rollback drill and clean-deployment restore drill.
2. `security.yml` must be green: CodeQL, gitleaks, dependency audit, tofu validate/test + checkov, image build + Trivy.
3. Build and push `web`, `worker` and `migrate` with `--build-arg APP_VERSION=<semver> --build-arg GIT_SHA=<sha>` to ECR using the OIDC deploy role.

## 2. Staging
1. `tofu apply -var-file=environments/staging.tfvars -var image_tag=<sha>` (or update only the task definitions).
2. **Run the release migration as a one-off task** before the services roll:
   ```
   aws ecs run-task --cluster projectos-staging --launch-type FARGATE \
     --task-definition projectos-staging-migrate \
     --network-configuration "awsvpcConfiguration={subnets=[<app subnets>],securityGroups=[<worker sg>],assignPublicIp=DISABLED}"
   ```
   Wait for exit code 0 (CloudWatch `/projectos/staging/migrate`).
3. The services roll with the ECS deployment circuit breaker (auto-rollback on failed health checks). Check:
   - `GET /api/v1/health/live` shows the new `release.gitSha`.
   - `/api/v1/health/ready` returns 200 and `migrationsApplied` equals the journal count.
4. Smoke from a CI runner with network access to staging:
   - `E2E_BASE_URL=https://staging… pnpm test:e2e` against the synthetic seed. Use a staging-only DEMO_PASSWORD from Secrets Manager.
   - `E2E_BASE_URL=… pnpm ops:load-test`.
5. Watch the alarms for 30 minutes. The release is promotable when there are no 5xx, no dead letters, and p95 is under 2 s.

## 3. Production
1. Change ticket with the SHA, CHANGELOG entry, migration list, the expand/contract statement and the staging evidence links.
2. **Pre-migration recovery point:** take a manual RDS snapshot `projectos-production-pre-<sha>` (`aws rds create-db-snapshot`). PITR is also on (35 days).
3. Run the `migrate` task (as in staging). If it fails, **stop**: the code was not rolled and migrations run in one transaction. Investigate. Do not retry blindly.
4. Roll the services (update the task definitions to `<sha>`). The circuit breaker rolls back automatically if health checks fail.
5. Verify `health/live` (SHA) and `health/ready`. Then do a synthetic sign-in on a dedicated non-PHI test account (only once real data exists).

## 4. Rollback plan

| Situation | Action | Data impact |
|---|---|---|
| New tasks fail health checks | Automatic (ECS circuit breaker) | None |
| Bug found after rollout; migrations were expand-only | Redeploy the previous SHA's task definitions (`aws ecs update-service --task-definition <previous revision>`) | None; the new columns are ignored |
| Migration failed | Nothing to roll back (the transaction aborted). Fix forward. | None |
| Migration succeeded but corrupted or broke data | **Restore**: (a) stop web + worker (desired count 0); (b) restore the pre-release snapshot to a **new** instance, or PITR to just before the migrate task; (c) point the services at it (Terraform `snapshot_identifier`, or rename instances); (d) deploy the previous SHA; (e) reconcile the EHR (Integration Health → Sync + Reconcile) because external writes may have happened in between | Writes since the snapshot are lost and must be re-entered from audit, the EHR or paper; record as an incident |

The local equivalent of the restore path is `pnpm release:migrate`: encrypted backup → migrate → schema-drift smoke → automatic restore with grants. It is rehearsed by `pnpm ops:migration-drill` (SQL error and destructive-migration cases, data verified identical).

## 5. Environment promotion of configuration
- Secrets (`better-auth-secret`, `backup-encryption-key`, `db-app-password`) are **per environment** and never copied from staging to production.
- The least-privilege DB role is created once per environment with `infra/sql/app-role.sql -v org_slug=<org>` (operator, master credential), after the first migrate task **and after the organization exists**: it binds the role to that organization for row-level security (ADR-0015). Re-run it after any restore into a new database.
- `APP_MODE` stays `DEMO_SYNTHETIC` until the go-live signoff. Terraform refuses `PILOT_APPROVED`/`PRODUCTION_APPROVED` without `phi_approved`, a BAA reference and a scope-check date.

## 6. First production deployment (empty account)
1. Account baseline (outside this repo): CloudTrail organization trail, GuardDuty, AWS Config, Security Hub, the S3 state bucket, the GitHub OIDC provider, and the ACM certificate for the domain.
2. `tofu init -backend-config=environments/production.backend.hcl`, then `tofu apply -var-file=environments/production.tfvars -var image_tag=<sha>`.
3. Set the secret values (`aws secretsmanager put-secret-value`), run `migrate`, create the organization, run `app-role.sql -v org_slug=<org>` (binds row-level security to it), then set web/worker desired counts.
4. Production starts **empty** (no synthetic seed). Staff accounts are created by invitation once email invites exist (GATE-INVITE).

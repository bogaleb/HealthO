# Operations handbook — ProjectOS Health

_For the people who run the system. Pairs with RELEASE_RUNBOOK.md (deploys), docs/compliance/BACKUP_RESTORE_RUNBOOK.md, DOWNTIME_PLAN.md and INCIDENT_RESPONSE.md._

**Current status: synthetic data only. NOT APPROVED FOR REAL PHI.**

## 1. System at a glance
- **web:** Next.js app, ECS Fargate × 2 behind the ALB and WAF.
- **worker:** one task that polls the Postgres job queue. It handles reminders, hold release, EHR sync/writes, rescreens, credential deadlines and housekeeping.
- **migrate:** one-off release task.
- **database:** RDS PostgreSQL 16, Multi-AZ, encrypted, PITR 35 days, plus AWS Backup daily.
- **No other runtime dependencies:** no Redis, no queue service, no email or SMS. External EHR only through the adapter (synthetic simulator today).
- **Health:**
  - `/api/v1/health/live` reports the process and its release `{version, gitSha}`.
  - `/api/v1/health/ready` reports DB reachable plus the migration count (the ALB target health uses it).
- **In-app operations pages (org admins):**
  - Admin › Worker: jobs, outbox, dead letters, replay.
  - Admin › Integrations: EHR health, conflicts, write queue.
  - Admin › PHI Readiness: checklist, technical checks, drills.
  - Admin › Audit.

## 2. Roles (to be named by the organization — RC item OPS-ONCALL)

| Role | Responsibility |
|---|---|
| System owner | Approves releases and risk acceptance |
| On-call engineer (primary / secondary) | Responds to alarms within 30 min during clinic hours, 2 h otherwise |
| Privacy / security officer | Incident classification, breach assessment, access reviews, PHI readiness approvals (second person) |
| Clinic operations lead | Downtime procedures at the sites, paper schedule, staff communication |

## 3. Alarm → action

| Alarm (CloudWatch) | Meaning | First actions |
|---|---|---|
| `alb_5xx` | Web errors | 1. Find the release (`health/live`). 2. Check `/projectos/<env>/web` logs by `requestId` (no PHI in logs by design). 3. If the error started with a deploy, roll back to the previous task definition (RELEASE_RUNBOOK §4). |
| `unhealthy_targets` | `/health/ready` failing | DB reachable? (`db_connections`, RDS events). Migrations missing? (ready shows the count; run the `migrate` task). |
| `p95_latency` | Above the 2 s budget | Check RDS CPU and Performance Insights top SQL, then web CPU. Scale web desired count to 3 temporarily. |
| `worker_down` | No worker task | ECS service events, then logs. **Impact:** reminders stop, EHR writes queue up (bookings stay *Pending* — never falsely confirmed), expired holds keep blocking slots (no double booking). Restart via `aws ecs update-service --force-new-deployment`. |
| `dead_letters` | A job or outbox event exhausted its retries | Admin › Worker shows the item and error. Fix the cause, then **Replay**. EHR write dead letters also appear as Integration Health conflicts. |
| `db_cpu` / `db_storage` / `db_connections` | Database pressure | Storage autoscaling is on (up to 5× allocated). For connections, check for a pool leak after a release (each web task uses ≤ 10). |

## 4. Routine tasks

| Cadence | Task | How |
|---|---|---|
| Daily (clinic days, 07:30) | Print the downtime schedule for EHR_MASTER sites | Scheduling › Downtime Schedule (audited) |
| Daily | Glance at Admin › Worker and Integrations | Dead letters 0, conflicts triaged, EHR "current" |
| Weekly | Restore drill | `pnpm ops:restore-drill` locally/staging; in AWS, restore the latest snapshot to a temporary instance and run `pnpm ops:clean-restore`-style checks against it. The readiness check requires a PASS within 7 days. |
| Weekly | Dependency and image advisories | `security.yml` weekly schedule; triage in SECURITY_RISK_REGISTER |
| Monthly | Clinic-day rehearsal | `pnpm ops:rehearsal` (synthetic org) — readiness requires ≤ 30 days |
| Monthly | Release drills | `pnpm ops:migration-drill`, `pnpm ops:load-test` against staging |
| Monthly | **Access review** | Admin › Staff: suspend leavers, check privileged grants and MFA (Admin › PHI Readiness lists privileged users without MFA). Record the review as checklist evidence. |
| Monthly | **Patient-access audit review** | Admin › Audit: filter `patient.read*` and look for unusual volume or out-of-scope reads |
| Quarterly | Restore from the **AWS Backup** vault into a scratch instance | Proves the vault, not just PITR |
| Quarterly | Secret rotation (see §5) | |
| Yearly | Disaster-recovery tabletop and downtime tabletop with clinic staff | DOWNTIME_PLAN.md |

## 5. Secrets and keys

| Secret | Rotation | Procedure / impact |
|---|---|---|
| RDS master password | Managed by RDS (Secrets Manager) | Used only by the `migrate` task |
| `db-app-password` | Quarterly or on staff change | 1. `ALTER ROLE projectos_app PASSWORD …` 2. update the secret 3. force-new-deployment of web and worker (tasks read the secret at start) |
| `better-auth-secret` | Yearly or on suspicion | Rotating it **signs everyone out** and invalidates MFA secrets encrypted with it, so users must re-enrol MFA. Plan with clinic operations. |
| `backup-encryption-key` | Yearly | Keep the old key until every backup encrypted with it has expired. Store the key **separately** from the backup location. |
| KMS CMKs | Automatic yearly rotation | Nothing to do |

Never paste secret values into tickets, chat, logs or URLs. Read them only with `aws secretsmanager get-secret-value` on an approved admin workstation.

## 6. Backups and recovery objectives (proposed — approval belongs to the organization)
- **RPO:** ≤ 5 minutes (RDS PITR). **RTO:** ≤ 4 hours for a full region-local restore. The observed local drill RTO is seconds at synthetic size, which does not represent production.
- Backups: RDS automated backups (35 days) plus AWS Backup daily (35 days, separate KMS vault). Logical encrypted dumps on demand (`pnpm release:migrate` before each release).
- Cross-region copy is **not configured** (cost/DR decision; checkov skip CKV_AWS_144 documents it).

## 7. Logging rules
- Application logs are structured JSON with `requestId`. They never contain patient names, MRNs, dates of birth, tokens or passwords. CI enforces this with `pnpm security:scan-logs`, which checks every identity in the patient table.
- Audit evidence (who did what, including patient reads) lives in the **append-only `audit_events` table**, not in logs.
- RDS statement logging is off (bound parameters could contain PHI). WAF logs keep blocked requests only, with cookie, authorization and query string redacted.

## 8. Incidents
Follow docs/compliance/INCIDENT_RESPONSE.md. On-call specifics:
- **Severity 1:** app down during clinic hours, or a suspected data exposure. Page the incident commander and the privacy officer, and start the DOWNTIME_PLAN at the sites.
- Preserve evidence: do not delete log groups or snapshots. Export the audit rows for the time window.
- A suspected PHI exposure is assessed by the privacy officer for breach notification. The software team does not decide that.

## 9. Local and Windows operations (synthetic)
- `START-WINDOWS.cmd` installs prerequisites, starts PostgreSQL in Docker Desktop, migrates, seeds, and starts web and worker.
- Release-style containers: `docker compose --profile app up --build` (migrate → web + worker).
- Drills: `pnpm ops:restore-drill`, `ops:rehearsal`, `ops:migration-drill`, `ops:clean-restore`, `ops:load-test`, `release:migrate`.

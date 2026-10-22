# AWS service scope check (required before any PHI)

**Status: NOT VERIFIED.** The organization's security officer must fill this in on the day of the go-live decision.

An executed AWS BAA covers only the services AWS lists as HIPAA-eligible *at that time*. Even for those services, it does not make our configuration compliant: configuration, access control, logging review and workforce practices remain the organization's responsibility (shared responsibility model).

**How to check:**

1. Open the current HIPAA Eligible Services Reference (aws.amazon.com/compliance/hipaa-eligible-services-reference/) and the BAA in AWS Artifact.
2. Record the date and the reviewer for each row below.
3. Put the date in `service_scope_verified_on` and the BAA id in `baa_reference` (infra/terraform). Without both, Terraform refuses `phi_approved = true`.

On 2026-10-22 the reference page did not render a readable list for the authors' tooling, so **no service is asserted as eligible here**.

| Service used by infra/terraform | Holds or processes PHI? | Eligible on check date? | Checked by / date |
|---|---|---|---|
| Amazon ECS on AWS Fargate (web, worker, migrate tasks) | Yes (in memory) | ☐ | |
| Amazon RDS for PostgreSQL (+ Performance Insights, Enhanced Monitoring) | Yes | ☐ | |
| Elastic Load Balancing (ALB) + access logs | In transit; logs hold metadata | ☐ | |
| AWS WAF (+ logs, cookies/authorization/query redacted) | In transit | ☐ | |
| Amazon S3 (backups, logs) | Yes (backups) | ☐ | |
| AWS Backup | Yes | ☐ | |
| AWS KMS | Keys only | ☐ | |
| AWS Secrets Manager | Credentials only | ☐ | |
| Amazon ECR | No (images contain no data) | ☐ | |
| Amazon CloudWatch / CloudWatch Logs | Should be none (scanned); treat as possible | ☐ | |
| Amazon VPC (NAT gateway, flow logs) | In transit / metadata | ☐ | |
| Amazon SNS (alarm notifications — no PHI by design) | No | ☐ | |
| AWS Certificate Manager | No | ☐ | |
| IAM / STS (GitHub OIDC deploy role) | No | ☐ | |

**Not used, by design:** third-party APM or analytics, email or SMS providers, AI services. Adding any of them needs a new scope check and, where applicable, a BAA with that vendor (CLAUDE.md binding decision).

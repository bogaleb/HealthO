# Cost report — AWS reference deployment (v0.3.0-rc.1)

_Prices checked 2026-10-22 · Region us-east-1 · On-demand USD, before tax, credits and discounts · Reproduce with `node scripts/ops/cost-model.mjs --markdown`_

**Bottom line:**

- **Staging (synthetic):** about **$127 per month**.
- **Production** (Multi-AZ database, 2 web tasks, WAF, 35-day backups, one organization with roughly 50 staff users): about **$199 per month**.

Both figures are for infrastructure only. They are not a quote. AWS changes prices, and real usage (log volume, traffic, Container Insights metrics) must be confirmed in Cost Explorer after the first week of a staging deployment.

The largest single line in both environments is the **NAT gateway plus public IPv4 addresses**, about $44 per month. That networking is the fixed price of private subnets.

## Estimate

### Staging (synthetic) — ≈ $127/month

| Item | USD/month | Basis |
|---|---:|---|
| Fargate web | 18.02 | 1 × 0.5 vCPU / 1 GB, 24×7 |
| Fargate worker | 9.01 | 1 × 0.25 vCPU / 0.5 GB, 24×7 |
| RDS PostgreSQL instance | 11.68 | db.t4g.micro Single-AZ |
| RDS gp3 storage | 2.30 | 20 GB |
| RDS + AWS Backup snapshots | 0.48 | ~5 GB billable beyond the free allowance (7-day retention) |
| Application Load Balancer | 19.35 | 1 ALB + 0.5 LCU average |
| NAT gateway | 33.08 | 1 NAT + 5 GB processed |
| Public IPv4 addresses | 10.95 | ALB (2 AZ) + NAT EIP |
| AWS WAF | 8.30 | 1 web ACL + 3 rules + 0.5M requests |
| CloudWatch logs (app + flow + WAF) | 1.36 | 2 GB/month ingested, ~6 months resident |
| CloudWatch alarms | 0.80 | 8 standard alarms |
| Container Insights (enhanced) | 5.00 | estimate — billed per metric; verify in Cost Explorer after 1 week |
| Secrets Manager | 1.60 | 3 app secrets + RDS-managed master secret |
| KMS keys | 4.00 | 2 CMKs; first two yearly rotations add $1/key each (upper bound) |
| ECR images | 0.60 | ~6 GB (30 releases retained) |
| S3 (backups, logs) | 0.12 | ~5 GB |
| **Total** | **127** | infrastructure only |

### Production (single organization, ≤ ~50 staff users) — ≈ $199/month

| Item | USD/month | Basis |
|---|---:|---|
| Fargate web | 36.04 | 2 × 0.5 vCPU / 1 GB, 24×7 (two tasks for zero-downtime deploys and AZ resilience) |
| Fargate worker | 9.01 | 1 × 0.25 vCPU / 0.5 GB, 24×7 |
| RDS PostgreSQL instance | 46.72 | db.t4g.small Multi-AZ (×2 of Single-AZ — assumption, see below) |
| RDS gp3 storage | 4.60 | 20 GB × 2 AZ |
| RDS + AWS Backup snapshots | 3.80 | ~40 GB billable beyond the free allowance (35-day retention) |
| Application Load Balancer | 22.27 | 1 ALB + 1 LCU average |
| NAT gateway | 33.75 | 1 NAT + 20 GB processed |
| Public IPv4 addresses | 10.95 | ALB (2 AZ) + NAT EIP |
| AWS WAF | 9.80 | 1 web ACL + 3 rules + 3M requests |
| CloudWatch logs (app + flow + WAF) | 4.08 | 6 GB/month ingested, ~6 months resident |
| CloudWatch alarms | 0.80 | 8 standard alarms |
| Container Insights (enhanced) | 10.00 | estimate — verify |
| Secrets Manager | 1.60 | 4 secrets |
| KMS keys | 4.00 | upper bound |
| ECR images | 0.90 | ~9 GB |
| S3 (backups, logs) | 0.69 | ~30 GB |
| **Total** | **199** | infrastructure only |

## Unit prices used (us-east-1)

| Price | Value | Source (accessed 2026-10-22) |
|---|---|---|
| Fargate Linux/x86 | $0.0404784 per vCPU-hour, $0.004446 per GB-hour | [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/) (per-second rates × 3600) |
| RDS PostgreSQL db.t4g.micro / db.t4g.small, Single-AZ | $0.016 / $0.032 per hour | [cloudprice.net db.t4g.small](https://cloudprice.net/aws/rds/instances/db.t4g.small) (data updated 2026-10-19), [cloudprice.net db.t4g.micro](https://cloudprice.net/aws/rds/instances/db.t4g.micro); consistent with [swyftstack, Jul 2026](https://swyftstack.com/blog/aws-rds-pricing-explained). The AWS page's tables did not render for us. |
| RDS gp3 storage / backup storage beyond free | ≈ $0.115 / ≈ $0.095 per GB-month | [swyftstack, Jul 2026](https://swyftstack.com/blog/aws-rds-pricing-explained) (secondary source; verify in the AWS calculator) |
| RDS T4g unlimited CPU credits | $0.075 per vCPU-hour above baseline | [AWS RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/) — not in the estimate; watch `CPUCreditBalance` |
| ALB | $0.0225 per hour + $0.008 per LCU-hour | [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) (us-east-1 examples) |
| NAT gateway | $0.045 per hour + $0.045 per GB | [cloudburn.io, updated Oct 2026](https://cloudburn.io/blog/aws-nat-gateway-pricing); [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/) shows the same rates for US East (Ohio) |
| Public IPv4 address | $0.005 per hour (in use or idle) | [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/) |
| AWS WAF | $5 per web ACL-month, $1 per rule or rule group-month, $0.60 per million requests | [AWS WAF pricing](https://aws.amazon.com/waf/pricing) |
| CloudWatch | Logs $0.50 per GB ingested, $0.03 per GB-month; $0.10 per alarm-month; Container Insights (enhanced, ECS) $0.07 per metric-month (example) | [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/) |
| Secrets Manager | $0.40 per secret-month, $0.05 per 10k calls | [AWS Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/) |
| KMS | $1 per key-month (+$1 for each of the first two rotations), $0.03 per 10k requests, 20k free | [AWS KMS pricing](https://aws.amazon.com/kms/pricing/) |
| AWS Support | Business Support+ from **$29/month minimum** per account (Business/Developer plans end 2027-01-01) | [AWS Support — Getting started](https://docs.aws.amazon.com/awssupport/latest/user/getting-started.md) |

## Assumptions and what is *not* included
- **Multi-AZ = 2× Single-AZ** for both instance and storage. That is the usual RDS Multi-AZ (one standby) billing. The exact Multi-AZ rate was not shown in the sources we could read, so verify it.
- No free tier, Savings Plans or Reserved Instances are applied. Staging may qualify for free-tier hours in a new account.
- Data transfer out to the internet is not included. The app serves HTML/JSON to a few dozen staff, so a few GB per month adds well under $1.
- **Not included:**
  - Account baseline (CloudTrail organization trail, GuardDuty, AWS Config, Security Hub). These are usually priced at the account or organization level and are prerequisites in RC_CHECKLIST (INF-SCOPE/INF-APPLY).
  - Route 53 hosted zone and domain.
  - An AWS Support plan. Business Support+ starts at $29/month and is recommended for production.
- **People and third parties are the dominant real cost and are not estimated here.** That covers security officer and privacy officer time, the formal risk analysis, a penetration test, legal review of licensure rules, the EHR vendor's API or sandbox fees, an email vendor for invites (with a BAA if needed), and on-call. Get quotes. Do not budget from this report.

## Cost levers (each is a trade-off, not a recommendation)

| Lever | Saves ≈ | Trade-off |
|---|---:|---|
| Staging: scale web/worker to 0 outside working hours (scheduled ECS desired count) | ~$15/mo | The worker stops, so reminders and hold release pause. Acceptable for synthetic staging only. |
| Staging: drop WAF | ~$8/mo | Staging then differs from production. |
| Production: Compute Savings Plan (1 yr) on Fargate | ~15–20 % of Fargate | Commitment. |
| Production: RDS reserved instance (1 yr) | ~30 % of the instance | Commitment, and the instance class is locked. |
| Replace the NAT gateway with VPC interface endpoints | Usually **more** expensive here | About 4 endpoints × 2 AZ at ~$7.30/month each; only worth it under strict no-egress policies. |
| Single web task in production | ~$18/mo | Deploys briefly drop capacity, and an AZ outage takes the app down until the task restarts. |

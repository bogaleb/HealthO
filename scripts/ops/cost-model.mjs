#!/usr/bin/env node
// Reproducible monthly cost model for the Terraform stack (infra/terraform). Prices: us-east-1, on-demand, USD,
// checked 2026-10-22 — sources in docs/release/COST_REPORT.md. Re-check before any budget decision; AWS changes prices.
// Usage: node scripts/ops/cost-model.mjs [--markdown]
const H = 730; // hours per month
const P = {
  fargateVcpuHr: 0.0404784, // Linux/x86
  fargateGbHr: 0.004446,
  rdsT4gMicroHr: 0.016, // PostgreSQL Single-AZ
  rdsT4gSmallHr: 0.032,
  multiAzFactor: 2, // Multi-AZ (one standby) bills instance + storage twice — an assumption, see report
  rdsGp3GbMo: 0.115,
  rdsBackupGbMo: 0.095, // beyond the free 100% of provisioned storage
  albHr: 0.0225,
  lcuHr: 0.008,
  natHr: 0.045,
  natGb: 0.045,
  ipv4Hr: 0.005,
  wafAcl: 5,
  wafRule: 1,
  wafPerMillion: 0.6,
  logsIngestGb: 0.5,
  logsStoreGbMo: 0.03,
  alarm: 0.1,
  secret: 0.4,
  kmsKey: 1,
  ecrGbMo: 0.1,
  s3GbMo: 0.023,
};

function env(name, o) {
  const lines = [];
  const add = (item, usd, basis) => lines.push({ item, usd: Math.round(usd * 100) / 100, basis });
  add("Fargate web", o.webTasks * (o.webVcpu * P.fargateVcpuHr + o.webGb * P.fargateGbHr) * H, `${o.webTasks} × ${o.webVcpu} vCPU / ${o.webGb} GB, 24×7`);
  add("Fargate worker", (0.25 * P.fargateVcpuHr + 0.5 * P.fargateGbHr) * H, "1 × 0.25 vCPU / 0.5 GB, 24×7");
  const az = o.multiAz ? P.multiAzFactor : 1;
  add("RDS PostgreSQL instance", o.dbHr * az * H, `${o.dbClass}${o.multiAz ? " Multi-AZ (×2 assumption)" : " Single-AZ"}`);
  add("RDS gp3 storage", o.dbGb * P.rdsGp3GbMo * az, `${o.dbGb} GB${o.multiAz ? " × 2 AZ" : ""}`);
  add("RDS + AWS Backup snapshots", o.backupGb * P.rdsBackupGbMo, `~${o.backupGb} GB billable beyond the free allowance (${o.retention}-day retention)`);
  add("Application Load Balancer", (P.albHr + o.lcu * P.lcuHr) * H, `1 ALB + ${o.lcu} LCU average`);
  add("NAT gateway", P.natHr * H + o.natGb * P.natGb, `1 NAT + ${o.natGb} GB processed`);
  add("Public IPv4 addresses", 3 * P.ipv4Hr * H, "ALB (2 AZ) + NAT EIP");
  add("AWS WAF", P.wafAcl + 3 * P.wafRule + o.requestsM * P.wafPerMillion, `1 web ACL + 3 rules + ${o.requestsM}M requests`);
  add("CloudWatch logs (app + flow + WAF)", o.logGb * P.logsIngestGb + o.logGb * 6 * P.logsStoreGbMo, `${o.logGb} GB/month ingested, ~6 months resident`);
  add("CloudWatch alarms", 8 * P.alarm, "8 standard alarms");
  add("Container Insights (enhanced)", o.insights, "estimate — billed per metric; verify in Cost Explorer after 1 week");
  add("Secrets Manager", 4 * P.secret, "3 app secrets + RDS-managed master secret");
  add("KMS keys", 2 * P.kmsKey * 2, "2 CMKs; first two yearly rotations add $1/key each (upper bound)");
  add("ECR images", o.ecrGb * P.ecrGbMo, `~${o.ecrGb} GB (30 releases retained)`);
  add("S3 (backups, logs)", o.s3Gb * P.s3GbMo, `~${o.s3Gb} GB`);
  const total = lines.reduce((s, l) => s + l.usd, 0);
  return { name, lines, total: Math.round(total) };
}

const staging = env("Staging (synthetic)", {
  webTasks: 1,
  webVcpu: 0.5,
  webGb: 1,
  dbClass: "db.t4g.micro",
  dbHr: P.rdsT4gMicroHr,
  multiAz: false,
  dbGb: 20,
  backupGb: 5,
  retention: 7,
  lcu: 0.5,
  natGb: 5,
  requestsM: 0.5,
  logGb: 2,
  insights: 5,
  ecrGb: 6,
  s3Gb: 5,
});
const production = env("Production (single organization, ≤ ~50 staff users)", {
  webTasks: 2,
  webVcpu: 0.5,
  webGb: 1,
  dbClass: "db.t4g.small",
  dbHr: P.rdsT4gSmallHr,
  multiAz: true,
  dbGb: 20,
  backupGb: 40,
  retention: 35,
  lcu: 1,
  natGb: 20,
  requestsM: 3,
  logGb: 6,
  insights: 10,
  ecrGb: 9,
  s3Gb: 30,
});

if (process.argv.includes("--markdown")) {
  for (const e of [staging, production]) {
    console.log(`\n### ${e.name} — ≈ $${e.total}/month\n\n| Item | USD/month | Basis |\n|---|---:|---|`);
    for (const l of e.lines) console.log(`| ${l.item} | ${l.usd.toFixed(2)} | ${l.basis} |`);
    console.log(`| **Total** | **${e.total}** | infrastructure only, before tax/support/credits |`);
  }
} else console.log(JSON.stringify({ staging, production }, null, 2));

#!/usr/bin/env node
// Minimal secret scanner for tracked files (CI + `pnpm security:scan`). Fails on likely real credentials.
// It is a guard rail, not a replacement for a dedicated scanner (gitleaks/trufflehog) in Phase 8.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !/(^|\/)(pnpm-lock\.yaml|.*\.png|.*\.jpg|.*\.ico|.*\.zip)$/.test(f));
const RULES = [
  ["private key", /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["Stripe live key", /\b(sk|rk)_live_[A-Za-z0-9]{16,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Generic bearer token", /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{30,}/i],
  // A database URL with a password that is not one of the documented local/CI throwaway values.
  ["Database URL with password", /postgres(ql)?:\/\/[^:\s/]+:(?!projectos_dev_password|ci_only_password|\*\*\*|\$\{|<)[^@\s/]{6,}@/],
];
const ALLOW_FILE = /^(\.env\.example|scripts\/security\/scan-secrets\.mjs)$/;
const findings = [];
for (const f of files) {
  if (ALLOW_FILE.test(f)) continue;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line)) findings.push(`${f}:${i + 1}: ${name}`);
  });
}
if (findings.length) {
  console.error(`Possible secrets found (${findings.length}):\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`Secret scan: ${files.length} tracked files, no findings.`);

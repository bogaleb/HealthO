#!/usr/bin/env node
// Phase 8: scan application/worker logs for patient identifiers and credentials (CLAUDE.md rule 14).
// Usage: node scripts/security/scan-logs.mjs <log file>... (exit 1 on any finding).
// Literal patient names + MRNs are read from DATABASE_URL when set, so it checks the actual seeded identities,
// not only patterns. Findings print the rule + line number, never the matched value.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: scan-logs.mjs <log file>...");
  process.exit(2);
}
const RULES = [
  ["synthetic patient name", /Demo Patient \d+/],
  ["MRN", /\bDEMO-\d{4}\b/],
  ["date of birth field", /"(dob|dateOfBirth|birthDate|birthYear)"\s*:/i],
  ["session token", /better-auth\.session_token=|"(token|sessionToken)"\s*:\s*"[A-Za-z0-9._-]{16,}"/],
  ["password field", /"password"\s*:\s*"[^"]+"/i],
  ["TOTP secret / otpauth URI", /otpauth:\/\/|"(secret|totpSecret)"\s*:\s*"[A-Z2-7]{16,}"/],
  ["bearer token", /Bearer\s+[A-Za-z0-9._-]{20,}/],
];

let literals = [];
if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql`select display_name, mrn from patients`;
    literals = rows.flatMap((r) => [r.display_name, r.mrn]).filter((v) => typeof v === "string" && v.length >= 6);
  } catch {
    console.error(JSON.stringify({ level: "warn", msg: "could not read patient identities; pattern checks only" }));
  } finally {
    await sql.end();
  }
}

const findings = [];
let lines = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8").split("\n");
  text.forEach((line, i) => {
    lines++;
    for (const [rule, re] of RULES) if (re.test(line)) findings.push({ file: f, line: i + 1, rule });
    if (literals.some((l) => line.includes(l))) findings.push({ file: f, line: i + 1, rule: "patient identity (literal from DB)" });
  });
}
const out = {
  level: findings.length ? "error" : "info",
  msg: "log PHI/credential scan",
  files: files.length,
  lines,
  patientIdentitiesChecked: literals.length,
  findings: findings.slice(0, 50),
};
console.log(JSON.stringify(out));
process.exit(findings.length ? 1 : 0);

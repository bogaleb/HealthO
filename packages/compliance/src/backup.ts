import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

/** Shared backup/restore primitives for the restore drill and the Phase 8 release tooling. Synthetic data only. */
export const TABLES = [
  "organizations",
  "users",
  "memberships",
  "audit_events",
  "projects",
  "tasks",
  "practitioners",
  "credentialing_cases",
  "appointments",
  "appointment_events",
  "rcm_cases",
  "outbox_events",
];

export function have(cmd: string) {
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  return r.status === 0;
}

export function run(cmd: string, args: string[], opts: { input?: Buffer; env?: NodeJS.ProcessEnv } = {}) {
  const r = spawnSync(cmd, args, { input: opts.input, env: { ...process.env, ...opts.env }, maxBuffer: 1024 * 1024 * 1024, shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ""} failed: ${r.stderr?.toString().slice(0, 400)}`);
  return r.stdout as Buffer;
}

export function encrypt(buf: Buffer, keyHex: string) {
  const key = createHash("sha256").update(keyHex).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from("POSB1"), iv, c.getAuthTag(), body]);
}
export function decrypt(buf: Buffer, keyHex: string) {
  if (buf.subarray(0, 5).toString() !== "POSB1") throw new Error("Not an encrypted ProjectOS backup");
  const key = createHash("sha256").update(keyHex).digest();
  const iv = buf.subarray(5, 17);
  const tag = buf.subarray(17, 33);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(33)), d.final()]);
}

/**
 * pg_dump (custom format) of a database — local client tools, or `docker compose exec db` on Docker Desktop.
 * Rate-limit counters are ephemeral and excluded (a restored deployment must not inherit lock-outs).
 * keepPrivileges: include GRANTs (same-server rollback, so the least-privilege app role keeps its access);
 * omit them for a restore into a different/clean server where those roles may not exist.
 */
export function dumpDatabase(url: URL, opts: { keepPrivileges?: boolean } = {}): Buffer {
  const pgEnv = { PGPASSWORD: decodeURIComponent(url.password) };
  const flags = ["--format=custom", "--no-owner", "--exclude-table-data=rate_limits", ...(opts.keepPrivileges ? [] : ["--no-privileges"])];
  return have("pg_dump")
    ? run("pg_dump", [...flags, "--dbname", url.toString()], { env: pgEnv })
    : run("docker", ["compose", "exec", "-T", "db", "pg_dump", ...flags, "-U", decodeURIComponent(url.username), url.pathname.slice(1)]);
}

/** pg_restore a custom-format dump into an (empty) database. */
export function restoreDump(url: URL, dump: Buffer, opts: { keepPrivileges?: boolean } = {}) {
  const pgEnv = { PGPASSWORD: decodeURIComponent(url.password) };
  const flags = ["--no-owner", "--exit-on-error", ...(opts.keepPrivileges ? [] : ["--no-privileges"])];
  if (have("pg_restore")) run("pg_restore", [...flags, "--dbname", url.toString()], { input: dump, env: pgEnv });
  else run("docker", ["compose", "exec", "-T", "db", "pg_restore", ...flags, "-U", decodeURIComponent(url.username), "-d", url.pathname.slice(1)], { input: dump });
}

/**
 * Empty a database in place (application schemas only) so a backup can be restored into it. Unlike DROP DATABASE
 * this keeps database-level grants and role settings, and works while the database is the operator's target.
 */
export async function resetSchemas(url: URL) {
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await db.unsafe(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.unsafe(`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.unsafe(`CREATE SCHEMA public`);
  } finally {
    await db.end();
  }
}

/** Drop (terminating other sessions) and re-create a database, connecting through the server's maintenance DB. */
export async function recreateDatabase(url: URL) {
  const maint = new URL(url.toString());
  maint.pathname = "/postgres";
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Unexpected database name");
  const admin = postgres(maint.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${name} and pid <> pg_backend_pid()`;
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

export async function dropDatabase(url: URL) {
  const maint = new URL(url.toString());
  maint.pathname = "/postgres";
  const name = url.pathname.slice(1);
  const admin = postgres(maint.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${name} and pid <> pg_backend_pid()`;
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await admin.end();
  }
}

/** Row counts of the key tables + a content checksum of the append-only audit log (detects silent data changes). */
export async function fingerprint(url: URL) {
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const counts: Record<string, number> = {};
    for (const t of TABLES) counts[t] = ((await db.unsafe(`select count(*)::int as n from "${t}"`))[0]!.n as number) ?? 0;
    const [sum] = await db.unsafe(`select md5(coalesce(string_agg(id::text || action || outcome, ',' order by id), '')) as h from audit_events`);
    const [tasksSum] = await db.unsafe(`select md5(coalesce(string_agg(id::text || title || status || version::text, ',' order by id), '')) as h from tasks`);
    const [mig] = await db.unsafe(`select count(*)::int as n from drizzle.__drizzle_migrations`);
    return { counts, auditChecksum: sum!.h as string, tasksChecksum: tasksSum!.h as string, migrations: mig!.n as number };
  } finally {
    await db.end();
  }
}

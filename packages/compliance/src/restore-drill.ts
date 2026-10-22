import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { createDb, isMain, loadRootEnv } from "@projectos/db";
import { recordDrill } from "./service";

/**
 * Backup + restore drill (blueprint §9.4). Dumps the database, optionally encrypts the dump (AES-256-GCM with
 * BACKUP_ENCRYPTION_KEY), decrypts it again, restores it into a scratch database, compares row counts of the
 * key tables and the append-only audit trigger, measures the time taken (observed RTO) and records the result.
 *
 * Works with local PostgreSQL client tools, or — on Windows/Docker Desktop — through `docker compose exec db`.
 * Synthetic data only. The off-host copy of the encrypted file is an external operational step.
 */
const TABLES = [
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

function have(cmd: string) {
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  return r.status === 0;
}

function run(cmd: string, args: string[], opts: { input?: Buffer; env?: NodeJS.ProcessEnv } = {}) {
  const r = spawnSync(cmd, args, { input: opts.input, env: { ...process.env, ...opts.env }, maxBuffer: 1024 * 1024 * 1024, shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ""} failed: ${r.stderr?.toString().slice(0, 400)}`);
  return r.stdout as Buffer;
}

function encrypt(buf: Buffer, keyHex: string) {
  const key = createHash("sha256").update(keyHex).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from("POSB1"), iv, c.getAuthTag(), body]);
}
function decrypt(buf: Buffer, keyHex: string) {
  if (buf.subarray(0, 5).toString() !== "POSB1") throw new Error("Not an encrypted ProjectOS backup");
  const key = createHash("sha256").update(keyHex).digest();
  const iv = buf.subarray(5, 17);
  const tag = buf.subarray(17, 33);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(33)), d.final()]);
}

export async function runRestoreDrill(opts: { databaseUrl?: string; outDir?: string; runBy?: string } = {}) {
  const url = new URL(opts.databaseUrl ?? process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const drillDb = `${dbName}_restore_drill`;
  const targetUrl = new URL(url.toString());
  targetUrl.pathname = `/${drillDb}`;
  const started = new Date();
  const outDir = resolve(opts.outDir ?? join(process.cwd(), "backups"));
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = started.toISOString().replace(/[:.]/g, "-");
  const useLocal = have("pg_dump") && have("pg_restore");
  const pgEnv = { PGPASSWORD: decodeURIComponent(url.password) };
  const summary: Record<string, unknown> = { tool: useLocal ? "local pg_dump/pg_restore" : "docker compose exec db", database: dbName };
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    // 1. Backup
    const t0 = Date.now();
    const dump = useLocal
      ? run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--dbname", url.toString()], { env: pgEnv })
      : run("docker", ["compose", "exec", "-T", "db", "pg_dump", "--format=custom", "--no-owner", "--no-privileges", "-U", decodeURIComponent(url.username), dbName]);
    summary.dumpMs = Date.now() - t0;
    summary.dumpBytes = dump.length;
    // 2. Encrypt (if a key is configured) and verify the round trip before relying on it.
    const key = process.env.BACKUP_ENCRYPTION_KEY;
    let file: string;
    let restoreFrom = dump;
    if (key && key.length >= 32) {
      file = join(outDir, `projectos-${stamp}.dump.enc`);
      writeFileSync(file, encrypt(dump, key));
      restoreFrom = decrypt(readFileSync(file), key);
      summary.encryption = "AES-256-GCM (key from BACKUP_ENCRYPTION_KEY); decrypt verified";
    } else {
      file = join(outDir, `projectos-${stamp}.dump`);
      writeFileSync(file, dump);
      summary.encryption = "NOT CONFIGURED — set BACKUP_ENCRYPTION_KEY (≥32 chars) before storing backups off-host";
    }
    summary.file = file;
    summary.fileBytes = statSync(file).size;
    // 3. Restore into a scratch database.
    await admin.unsafe(`DROP DATABASE IF EXISTS "${drillDb}"`);
    await admin.unsafe(`CREATE DATABASE "${drillDb}"`);
    const t1 = Date.now();
    if (useLocal) run("pg_restore", ["--no-owner", "--no-privileges", "--dbname", targetUrl.toString()], { input: restoreFrom, env: pgEnv });
    else
      run("docker", ["compose", "exec", "-T", "db", "pg_restore", "--no-owner", "--no-privileges", "-U", decodeURIComponent(url.username), "-d", drillDb], { input: restoreFrom });
    summary.restoreMs = Date.now() - t1;
    // 4. Verify.
    const target = postgres(targetUrl.toString(), { max: 1, onnotice: () => {} });
    const mismatches: string[] = [];
    const counts: Record<string, [number, number]> = {};
    try {
      for (const t of TABLES) {
        const [a] = await admin.unsafe(`select count(*)::int as n from "${t}"`);
        const [b] = await target.unsafe(`select count(*)::int as n from "${t}"`);
        counts[t] = [a!.n as number, b!.n as number];
        if (a!.n !== b!.n) mismatches.push(t);
      }
      const [trig] = await target.unsafe(`select count(*)::int as n from pg_trigger where tgname = 'audit_events_no_update'`);
      summary.auditTriggerRestored = (trig!.n as number) === 1;
      const [mig] = await target.unsafe(`select count(*)::int as n from drizzle.__drizzle_migrations`);
      summary.migrationsRestored = mig!.n;
    } finally {
      await target.end();
    }
    summary.counts = counts;
    summary.mismatches = mismatches;
    summary.observedRtoSeconds = Math.round((Date.now() - started.getTime()) / 1000);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${drillDb}"`);
    const pass = mismatches.length === 0 && summary.auditTriggerRestored === true;
    return { pass, summary, started };
  } finally {
    await admin.end();
  }
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  const { db, sql } = createDb(undefined, 2);
  const startedAt = new Date();
  runRestoreDrill({ runBy: process.env.USER ?? process.env.USERNAME ?? "operator" })
    .then(async (r) => {
      await recordDrill(db, {
        organizationId: null,
        kind: "BACKUP_RESTORE",
        status: r.pass ? "PASS" : "FAIL",
        startedAt: r.started,
        summary: r.summary,
        runBy: "pnpm ops:restore-drill",
      });
      console.log(JSON.stringify({ level: r.pass ? "info" : "error", msg: `restore drill ${r.pass ? "PASSED" : "FAILED"}`, ...r.summary }, null, 2));
      if (!r.pass) process.exitCode = 1;
    })
    .catch(async (e) => {
      await recordDrill(db, {
        organizationId: null,
        kind: "BACKUP_RESTORE",
        status: "FAIL",
        startedAt,
        summary: { error: e instanceof Error ? e.message : String(e) },
        runBy: "pnpm ops:restore-drill",
      }).catch(() => {});
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}

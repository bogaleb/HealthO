import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import postgres from "postgres";
import { join, resolve } from "node:path";
import { createDb, driftIsEmpty, isMain, loadRootEnv, schemaDrift, type SchemaDrift } from "@projectos/db";
import { MIGRATIONS_DIR, runMigrations } from "@projectos/db/migrate";
import { decrypt, dropDatabase, dumpDatabase, encrypt, fingerprint, recreateDatabase, resetSchemas, restoreDump } from "./backup";
import { recordDrill } from "./service";

/**
 * Phase 8 release tooling (synthetic data only until the go-live gate is signed):
 *  - releaseMigrate():        encrypted pre-migration backup → migrate → smoke (schema drift + invariants)
 *                             → on ANY failure restore the pre-migration backup and prove the data is unchanged.
 *  - migrationRollbackDrill(): rehearses both failure modes on a scratch copy (SQL error, and a migration that
 *                             succeeds but breaks the app's schema contract).
 *  - cleanDeployRestoreDrill(): restore the latest backup into a brand-new database, run the release migrations,
 *                             start a production web server + one worker tick against it, and smoke test over HTTP.
 * On AWS the equivalent primitives are RDS snapshots / point-in-time restore (docs/ops/RELEASE_RUNBOOK.md).
 */
const ROOT = resolve(import.meta.dirname, "../../..");

type Fingerprint = Awaited<ReturnType<typeof fingerprint>>;
const sameData = (a: Fingerprint, b: Fingerprint) => JSON.stringify(a) === JSON.stringify(b);

function journalEntries(folder: string) {
  return (JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as { entries: unknown[] }).entries.length;
}

/** Post-migration smoke: the code's schema contract holds and every migration in the folder is recorded. */
export async function releaseSmoke(url: URL, migrationsFolder = MIGRATIONS_DIR) {
  const { db, sql } = createDb(url.toString(), 1);
  try {
    const drift: SchemaDrift = await schemaDrift(db);
    const fp = await fingerprint(url);
    const expected = journalEntries(migrationsFolder);
    const ok = driftIsEmpty(drift) && fp.migrations === expected;
    return { ok, drift, migrationsApplied: fp.migrations, migrationsExpected: expected };
  } finally {
    await sql.end();
  }
}

export type ReleaseMigrateResult = {
  status: "MIGRATED" | "ROLLED_BACK" | "ROLLBACK_FAILED";
  backupFile: string;
  encrypted: boolean;
  error?: string;
  smoke?: Awaited<ReturnType<typeof releaseSmoke>>;
  dataRestoredIdentical?: boolean;
  ms: number;
};

export async function releaseMigrate(opts: { databaseUrl: string; migrationsFolder?: string; outDir?: string }): Promise<ReleaseMigrateResult> {
  const t0 = Date.now();
  const url = new URL(opts.databaseUrl);
  const folder = opts.migrationsFolder ?? MIGRATIONS_DIR;
  const outDir = resolve(opts.outDir ?? join(ROOT, "backups"));
  mkdirSync(outDir, { recursive: true });
  // 1. Pre-migration backup (encrypted when BACKUP_ENCRYPTION_KEY is set). Kept as the release's rollback point.
  const pre = await fingerprint(url);
  const dump = dumpDatabase(url, { keepPrivileges: true });
  const key = process.env.BACKUP_ENCRYPTION_KEY ?? "";
  const encrypted = key.length >= 32;
  const backupFile = join(outDir, `pre-release-${new Date().toISOString().replace(/[:.]/g, "-")}.dump${encrypted ? ".enc" : ""}`);
  writeFileSync(backupFile, encrypted ? encrypt(dump, key) : dump);
  // 2. Migrate + smoke.
  let error: string | undefined;
  let smoke: Awaited<ReturnType<typeof releaseSmoke>> | undefined;
  try {
    await runMigrations(url.toString(), folder);
    smoke = await releaseSmoke(url, folder);
    if (!smoke.ok) error = `post-migration smoke failed: ${JSON.stringify(smoke.drift)}; migrations ${smoke.migrationsApplied}/${smoke.migrationsExpected}`;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : null;
    error = `migration failed: ${cause ?? (e instanceof Error ? e.message.split("\n")[0] : String(e))}`;
  }
  if (!error) return { status: "MIGRATED", backupFile, encrypted, smoke, ms: Date.now() - t0 };
  // 3. Roll back: empty the application schemas, restore the pre-migration backup (with grants) and prove equality.
  try {
    await resetSchemas(url);
    restoreDump(url, dump, { keepPrivileges: true });
    const after = await fingerprint(url);
    const identical = sameData(pre, after);
    return { status: identical ? "ROLLED_BACK" : "ROLLBACK_FAILED", backupFile, encrypted, error, smoke, dataRestoredIdentical: identical, ms: Date.now() - t0 };
  } catch (e) {
    return { status: "ROLLBACK_FAILED", backupFile, encrypted, error: `${error}; restore failed: ${e instanceof Error ? e.message : String(e)}`, smoke, ms: Date.now() - t0 };
  }
}

/** Copy the real migrations and append one drill migration (registered in the journal like a real one). */
function migrationsWithExtra(tag: string, sqlText: string) {
  const dir = mkdtempSync(join(tmpdir(), "projectos-migdrill-"));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const jp = join(dir, "meta/_journal.json");
  const j = JSON.parse(readFileSync(jp, "utf8")) as { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] };
  const last = j.entries[j.entries.length - 1]!;
  j.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1000, tag, breakpoints: true });
  writeFileSync(jp, JSON.stringify(j, null, 2));
  writeFileSync(join(dir, `${tag}.sql`), sqlText);
  return dir;
}

export async function migrationRollbackDrill(sourceUrl: string) {
  const src = new URL(sourceUrl);
  const scratch = new URL(src.toString());
  scratch.pathname = `/${src.pathname.slice(1)}_migration_drill`;
  const outDir = mkdtempSync(join(tmpdir(), "projectos-migdrill-bak-"));
  const summary: Record<string, unknown> = {};
  const dirs: string[] = [];
  try {
    // Scratch copy of the current database (never the live one).
    await recreateDatabase(scratch);
    restoreDump(scratch, dumpDatabase(src, { keepPrivileges: true }), { keepPrivileges: true });
    const base = await fingerprint(scratch);
    // A) The migration itself errors half-way (a statement after a successful one fails).
    const a = migrationsWithExtra("9998_drill_sql_error", 'CREATE TABLE "drill_tmp" ("id" int);--> statement-breakpoint\nSELECT 1 / 0;');
    dirs.push(a);
    const ra = await releaseMigrate({ databaseUrl: scratch.toString(), migrationsFolder: a, outDir });
    summary.sqlError = { status: ra.status, error: ra.error?.slice(0, 160), dataRestoredIdentical: ra.dataRestoredIdentical };
    // B) The migration succeeds but breaks the schema contract the code relies on (destructive change).
    const b = migrationsWithExtra("9999_drill_destructive", 'ALTER TABLE "tasks" DROP COLUMN "description";');
    dirs.push(b);
    const rb = await releaseMigrate({ databaseUrl: scratch.toString(), migrationsFolder: b, outDir });
    summary.destructive = { status: rb.status, error: rb.error?.slice(0, 200), dataRestoredIdentical: rb.dataRestoredIdentical };
    const after = await fingerprint(scratch);
    summary.scratchMatchesSourceCopy = sameData(base, after);
    // The least-privilege runtime role (if this server has it) must still have its grants after the rollback.
    const pg = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
    try {
      const [r] = await pg<{ has: boolean | null }[]>`
        select case when exists (select 1 from pg_roles where rolname = 'projectos_app')
          then has_table_privilege('projectos_app', 'public.tasks', 'SELECT,INSERT,UPDATE') end as has`;
      summary.appRoleGrantsAfterRollback = r?.has ?? "no app role on this server";
    } finally {
      await pg.end();
    }
    // C) A normal release (no new migration) on the same copy passes the smoke and changes nothing.
    const rc = await releaseMigrate({ databaseUrl: scratch.toString(), outDir });
    summary.normalRelease = { status: rc.status, smokeOk: rc.smoke?.ok };
    const pass =
      ra.status === "ROLLED_BACK" &&
      ra.dataRestoredIdentical === true &&
      rb.status === "ROLLED_BACK" &&
      rb.dataRestoredIdentical === true &&
      summary.scratchMatchesSourceCopy === true &&
      summary.appRoleGrantsAfterRollback !== false &&
      rc.status === "MIGRATED";
    return { pass, summary };
  } finally {
    await dropDatabase(scratch).catch(() => {});
    for (const d of [...dirs, outDir]) rmSync(d, { recursive: true, force: true });
  }
}

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Restore into a clean deployment: brand-new database from the (encrypted) backup, release migrations, a production
 * web server + one worker tick against it, HTTP smoke as a synthetic user. Requires `pnpm build` first.
 */
export async function cleanDeployRestoreDrill(sourceUrl: string, port = 3210) {
  const src = new URL(sourceUrl);
  const target = new URL(src.toString());
  target.pathname = `/${src.pathname.slice(1)}_clean_deploy`;
  const t0 = Date.now();
  const summary: Record<string, unknown> = {};
  let server: ChildProcess | undefined;
  try {
    if (!existsSync(join(ROOT, "apps/web/.next/BUILD_ID"))) throw new Error("No production build — run `pnpm build` first.");
    const pre = await fingerprint(src);
    const key = process.env.BACKUP_ENCRYPTION_KEY ?? "";
    let dump = dumpDatabase(src);
    summary.backupEncrypted = key.length >= 32;
    // Restore from what would be stored off-host: the encrypted file, decrypted with the key (round trip verified).
    if (key.length >= 32) dump = decrypt(encrypt(dump, key), key);
    await recreateDatabase(target);
    restoreDump(target, dump);
    await runMigrations(target.toString());
    const smoke = await releaseSmoke(target);
    summary.schemaSmoke = smoke;
    summary.dataIdentical = sameData(pre, await fingerprint(target));
    summary.restoreAndMigrateMs = Date.now() - t0;
    // Production server against the restored database (env overrides the repo .env).
    const base = `http://localhost:${port}`;
    const env = { ...process.env, DATABASE_URL: target.toString(), BETTER_AUTH_URL: base, PORT: String(port), NODE_ENV: "production" };
    server = spawn("pnpm", ["--filter", "@projectos/web", "exec", "next", "start", "-p", String(port)], {
      cwd: ROOT,
      env,
      stdio: "ignore",
      detached: process.platform !== "win32",
      shell: process.platform === "win32",
    });
    const up = await waitFor(`${base}/api/v1/health/ready`, 60_000);
    summary.serverReady = up;
    const ready = up ? ((await (await fetch(`${base}/api/v1/health/ready`)).json()) as { checks?: { migrationsApplied?: number } }) : null;
    summary.readyMigrations = ready?.checks?.migrationsApplied;
    const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ email: "avery.admin@riverbend.example", password: process.env.DEMO_PASSWORD ?? "" }),
    });
    summary.signIn = signIn.status;
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const probes: Record<string, number> = {};
    for (const p of ["/api/v1/me", "/api/v1/scheduling/reference", "/api/v1/dashboards/operations", "/api/v1/compliance/readiness", "/home"])
      probes[p] = (await fetch(`${base}${p}`, { headers: { cookie }, redirect: "manual" })).status;
    summary.httpProbes = probes;
    const worker = spawnSync("pnpm", ["--filter", "@projectos/worker", "once"], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000, shell: process.platform === "win32" });
    summary.workerTickExit = worker.status;
    summary.observedRtoSeconds = Math.round((Date.now() - t0) / 1000);
    const pass = smoke.ok && summary.dataIdentical === true && up && signIn.status === 200 && Object.values(probes).every((s) => s === 200) && worker.status === 0;
    return { pass, summary };
  } finally {
    if (server?.pid) {
      try {
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
        else process.kill(-server.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    await dropDatabase(target).catch(() => {});
  }
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  const cmd = process.argv[2];
  const { db, sql } = createDb(undefined, 2);
  const started = new Date();
  const url = process.env.DATABASE_URL!;
  const go = async () => {
    if (cmd === "migrate") {
      const r = await releaseMigrate({ databaseUrl: url });
      console.log(JSON.stringify({ level: r.status === "MIGRATED" ? "info" : "error", msg: `release migrate: ${r.status}`, ...r }, null, 2));
      if (r.status !== "MIGRATED") process.exitCode = 1;
      return;
    }
    const kind = cmd === "migration-drill" ? "MIGRATION_ROLLBACK" : cmd === "clean-restore" ? "CLEAN_DEPLOY_RESTORE" : null;
    if (!kind) throw new Error("usage: release.ts migrate | migration-drill | clean-restore");
    const r = kind === "MIGRATION_ROLLBACK" ? await migrationRollbackDrill(url) : await cleanDeployRestoreDrill(url);
    await recordDrill(db, { organizationId: null, kind, status: r.pass ? "PASS" : "FAIL", startedAt: started, summary: r.summary, runBy: `pnpm ops:${cmd}` });
    console.log(JSON.stringify({ level: r.pass ? "info" : "error", msg: `${kind} ${r.pass ? "PASS" : "FAIL"}`, ...r.summary }, null, 2));
    if (!r.pass) process.exitCode = 1;
  };
  go()
    .catch(async (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}

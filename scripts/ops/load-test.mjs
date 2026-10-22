#!/usr/bin/env node
// Phase 8 concurrency load test + performance budget (SYNTHETIC data, local or staging only — never production).
//   pnpm ops:load-test            (server on E2E_BASE_URL or http://localhost:3000, DATABASE_URL for the drill record)
// Checks:
//   1. N schedulers race for the SAME slot (different synthetic patients) → exactly one 201, the rest 409, no 5xx.
//   2. Slot search under concurrency: p95 ≤ 2000 ms   (blueprint performance budget)
//   3. Task save (PATCH) under concurrency: p95 ≤ 1500 ms
//   4. Page render (calendar, my work, RCM queue HTML): p95 ≤ 2500 ms server time
//   5. No 5xx anywhere.
// The result is recorded in the append-only ops_drills table (kind LOAD_TEST) and printed as JSON.
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import postgres from "postgres";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.DEMO_PASSWORD;
const RACERS = Number(process.env.LOAD_RACERS ?? 20);
const ROUNDS = Number(process.env.LOAD_ROUNDS ?? 60);
const CONC = Number(process.env.LOAD_CONCURRENCY ?? 10);
const BUDGET = { searchP95: 2000, saveP95: 1500, pageP95: 2500, firstLoadJsGzipKb: 300 };
if (!PASSWORD) throw new Error("DEMO_PASSWORD is required (synthetic accounts only).");

const started = new Date();
const statuses = {};
const count = (s) => (statuses[s] = (statuses[s] ?? 0) + 1);

async function session(email) {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (r.status !== 200) throw new Error(`sign-in failed for a synthetic user: HTTP ${r.status}`);
  const cookie = r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const call = async (path, init = {}) => {
    const t0 = performance.now();
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { cookie, origin: BASE, "content-type": "application/json", ...(init.headers ?? {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const ms = performance.now() - t0;
    count(res.status);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* html */
    }
    return { status: res.status, json, ms };
  };
  call.cookie = cookie;
  return call;
}

const p95 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? 0);
};
async function pool(n, conc, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (i < n) out.push(await fn(i++));
    }),
  );
  return out;
}
const day = (n) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const admin = await session("avery.admin@riverbend.example");
const ref = (await admin("/api/v1/scheduling/reference")).json.data;
const site = ref.sites.find((s) => s.code === "ALX") ?? ref.sites[0];
const type = ref.appointmentTypes.find((t) => t.code === "BH_THERAPY") ?? ref.appointmentTypes[0];
const searchBody = (offset) => ({ appointmentTypeId: type.id, modality: "VIDEO", siteId: site.id, fromDate: day(offset), days: 7, patientState: "VA" });

// 1. Same-slot race -----------------------------------------------------------------------------------------------
const search = await admin("/api/v1/scheduling/search", { method: "POST", body: searchBody(20 + Math.floor(Math.random() * 20)) });
const slot = search.json?.data?.slots?.find((s) => s.eligibility?.decision === "ALLOW");
if (!slot) throw new Error("no eligible synthetic slot found for the race");
const patients = ((await admin("/api/v1/patients?q=Demo%20Patient")).json?.data ?? []).filter((p) => p.mrn !== "DEMO-0015");
const schedulers = await Promise.all(["sam.ortiz@riverbend.example", "quinn.park@riverbend.example", "avery.admin@riverbend.example"].map(session));
const race = await Promise.all(
  Array.from({ length: RACERS }, (_, i) =>
    schedulers[i % schedulers.length]("/api/v1/appointments", {
      method: "POST",
      body: {
        practitionerId: slot.practitionerId,
        siteId: slot.siteId ?? site.id,
        appointmentTypeId: type.id,
        modality: "VIDEO",
        startAt: slot.startAt,
        patientId: patients[i % patients.length].id,
        patientLocationState: "VA",
      },
      headers: { "idempotency-key": `load-${started.getTime()}-${i}` },
    }),
  ),
);
const raceCreated = race.filter((r) => r.status === 201).length;
const raceConflicts = race.filter((r) => r.status === 409).length;
const raceOther = race.filter((r) => r.status !== 201 && r.status !== 409).map((r) => r.status);

// 2. Search latency under concurrency ----------------------------------------------------------------------------
const searches = await pool(ROUNDS, CONC, (i) => schedulers[i % schedulers.length]("/api/v1/scheduling/search", { method: "POST", body: searchBody(1 + (i % 14)) }));

// 3. Task saves (PATCH with optimistic version) under concurrency ------------------------------------------------
const tasks = ((await admin("/api/v1/tasks?limit=50")).json?.data?.items ?? []).slice(0, 20);
const saves = await pool(Math.min(ROUNDS, tasks.length * 3), CONC, async (i) => {
  const t = tasks[i % tasks.length];
  const cur = (await admin(`/api/v1/tasks/${t.id}`)).json?.data;
  const task = cur?.task ?? cur;
  return admin(`/api/v1/tasks/${t.id}`, { method: "PATCH", body: { version: task.version, description: `SYNTHETIC load-test edit ${i}` } });
});
const saveOk = saves.filter((r) => r.status === 200);
const saveStale = saves.filter((r) => r.status === 409).length; // concurrent edits of the same task: expected optimistic-lock conflicts

// 4. Page render -------------------------------------------------------------------------------------------------
const pages = await pool(30, 5, (i) => admin(["/scheduling/calendar", "/tasks/my-work", "/rcm/queues"][i % 3]));

// 5. Client JS budget: gzip size of every script a critical page loads -------------------------------------------
const jsKb = {};
for (const path of ["/login", "/scheduling/find", "/scheduling/calendar", "/tasks/my-work", "/rcm/queues"]) {
  const html = await (await fetch(`${BASE}${path}`, { headers: { cookie: admin.cookie } })).text();
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  let bytes = 0;
  for (const src of new Set(srcs)) bytes += gzipSync(Buffer.from(await (await fetch(new URL(src, BASE))).arrayBuffer())).length;
  jsKb[path] = Math.round(bytes / 1024);
}

const fivexx = Object.entries(statuses).filter(([s]) => Number(s) >= 500);
const results = {
  race: { racers: RACERS, created: raceCreated, conflicts: raceConflicts, other: raceOther },
  searchP95Ms: p95(searches.map((r) => r.ms)),
  searchErrors: searches.filter((r) => r.status !== 200).length,
  saveP95Ms: p95(saveOk.map((r) => r.ms)),
  saves: saves.length,
  saveVersionConflicts: saveStale,
  pageP95Ms: p95(pages.map((r) => r.ms)),
  pageErrors: pages.filter((r) => r.status !== 200).length,
  firstLoadJsGzipKb: jsKb,
  statuses,
  budget: BUDGET,
  base: BASE,
};
const checks = {
  exactlyOneBooking: raceCreated === 1 && raceConflicts === RACERS - 1,
  searchBudget: results.searchP95Ms <= BUDGET.searchP95 && results.searchErrors === 0,
  saveBudget: saveOk.length > 0 && results.saveP95Ms <= BUDGET.saveP95,
  pageBudget: results.pageP95Ms <= BUDGET.pageP95 && results.pageErrors === 0,
  jsBudget: Object.values(jsKb).every((kb) => kb > 0 && kb <= BUDGET.firstLoadJsGzipKb),
  no5xx: fivexx.length === 0,
};
const pass = Object.values(checks).every(Boolean);

if (process.env.DATABASE_URL && !process.env.LOAD_NO_RECORD) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const [org] = await sql`select id from organizations where slug = 'riverbend-demo'`;
  await sql`insert into ops_drills (organization_id, kind, status, started_at, finished_at, summary, run_by)
            values (${org?.id ?? null}, 'LOAD_TEST', ${pass ? "PASS" : "FAIL"}, ${started}, now(), ${sql.json({ checks, results })}, 'pnpm ops:load-test')`;
  await sql.end();
}
console.log(JSON.stringify({ level: pass ? "info" : "error", msg: `load test ${pass ? "PASS" : "FAIL"}`, checks, results }, null, 2));
process.exit(pass ? 0 : 1);

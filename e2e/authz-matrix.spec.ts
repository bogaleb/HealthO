import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import postgres from "postgres";
import { expect, request as pwRequest, test } from "@playwright/test";
import { USERS, apiLogin } from "./helpers";

/**
 * Phase 8 privilege-escalation matrix. Every mutating API route in apps/web/app/api/v1 is discovered from the file
 * system (a new route is covered automatically) and called with REAL resource ids of the synthetic org:
 *  - unauthenticated → 401 everywhere (no data, no mutation);
 *  - the least-privileged role (Auditor: audit.read + projects.read) → never 2xx, never 5xx;
 *  - a scheduler on admin-only routes (roles, users, replay, compliance, integrations, policy approval) → never 2xx;
 *  - afterwards the audit log holds no ALLOW mutation by either user in the window (nothing changed).
 */
const BASE = "http://localhost:3000";
const ORIGIN = { origin: BASE };
const API_DIR = join(process.cwd(), "apps/web/app/api/v1");
/** POST endpoints that are reads (search/evaluate) or act only on the caller's own data. */
const NOT_A_PRIVILEGED_MUTATION = new Set(["scheduling/search", "scheduling/evaluate", "notifications/read", "invites/accept"]);
const ADMIN_ONLY = /^(roles|users|admin|compliance|integrations|policy-rules\/\[id\]\/approve|jobs|auth\/invite|departments|teams)/;

const TABLE_FOR: Record<string, string> = {
  "admin/jobs": "jobs",
  "admin/outbox": "outbox_events",
  "appointment-types": "appointment_types",
  "appointments/holds": "appointment_holds",
  appointments: "appointments",
  authorities: "professional_authorities",
  "compliance/items": "compliance_items",
  "credentialing/cases": "credentialing_cases",
  enrollments: "provider_enrollments",
  "integrations/conflicts": "integration_conflicts",
  "integrations/connections": "ehr_connections",
  "integrations/sites": "sites",
  "policy-rules": "license_policy_rules",
  practitioners: "practitioners",
  projects: "projects",
  "rcm/assignments": "rcm_assignment_batches",
  "rcm/cases": "rcm_cases",
  "rcm/queues": "rcm_queues",
  roles: "roles",
  "schedule-exceptions": "schedule_exceptions",
  "schedule-templates": "schedule_templates",
  sites: "sites",
  tasks: "tasks",
  users: "users",
  "waitlist/offers": "waitlist_offers",
  waitlist: "waitlist_entries",
};
const CHILD_TABLE: Record<string, string> = { itemId: "checklist_items", depId: "task_dependencies" };

type Route = { path: string; methods: string[] };
function discover(dir = API_DIR): Route[] {
  const out: Route[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...discover(p));
    else if (name === "route.ts") {
      const src = readFileSync(p, "utf8");
      const methods = [...src.matchAll(/export (?:async )?(?:function|const) (POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]!);
      if (methods.length) out.push({ path: relative(API_DIR, dir).replaceAll("\\", "/"), methods });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function idMap() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const [org] = await sql<{ id: string }[]>`select id from organizations where slug = 'riverbend-demo'`;
    const ids: Record<string, string> = {};
    for (const table of new Set([...Object.values(TABLE_FOR), ...Object.values(CHILD_TABLE)])) {
      const orgScoped = table !== "users";
      const rows = orgScoped
        ? await sql<{ id: string }[]>`select id from ${sql(table)} where organization_id = ${org!.id} order by id limit 1`
        : await sql<{ id: string }[]>`select id from users where email = ${USERS.admin}`;
      ids[table] = rows[0]?.id ?? "00000000-0000-4000-8000-000000000000";
    }
    return ids;
  } finally {
    await sql.end();
  }
}

function concretePath(route: string, ids: Record<string, string>) {
  const segs = route.split("/");
  return segs
    .map((seg, i) => {
      const m = /^\[(\w+)\]$/.exec(seg);
      if (!m) return seg;
      if (CHILD_TABLE[m[1]!]) return ids[CHILD_TABLE[m[1]!]!];
      const prefix = segs.slice(0, i).join("/");
      const key = Object.keys(TABLE_FOR)
        .filter((k) => prefix.endsWith(k))
        .sort((a, b) => b.length - a.length)[0];
      return ids[TABLE_FOR[key ?? ""] ?? ""] ?? "00000000-0000-4000-8000-000000000000";
    })
    .join("/");
}

async function sweep(email: string | null, filter: (r: Route) => boolean) {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  if (email) await apiLogin(ctx, email);
  const ids = await idMap();
  const results: { route: string; method: string; status: number }[] = [];
  for (const r of discover().filter(filter))
    for (const method of r.methods) {
      const url = `/api/v1/${concretePath(r.path, ids)}`;
      const res = await ctx.fetch(url, { method, data: { version: 1, name: "SYNTHETIC escalation probe", roleIds: [], status: "DONE" }, headers: ORIGIN });
      results.push({ route: r.path, method, status: res.status() });
    }
  await ctx.dispose();
  return results;
}

test("discovers the mutating API surface", () => {
  const routes = discover();
  expect(routes.length).toBeGreaterThan(80);
  for (const k of ["roles", "users/[id]/roles", "compliance/items/[id]", "admin/outbox/[id]/replay"]) expect(routes.map((r) => r.path)).toContain(k);
});

test("unauthenticated: every mutating route → 401", async () => {
  const res = await sweep(null, (r) => !r.path.startsWith("invites/accept") && !r.path.startsWith("health"));
  const bad = res.filter((r) => r.status !== 401);
  expect(bad, JSON.stringify(bad)).toEqual([]);
});

test("Auditor (read-only) cannot mutate anything; scheduler cannot reach admin-only routes; nothing changed", async () => {
  const started = new Date(Date.now() - 1000);
  const auditor = await sweep(USERS.auditor, (r) => !NOT_A_PRIVILEGED_MUTATION.has(r.path));
  const allowed = auditor.filter((r) => r.status >= 200 && r.status < 300);
  const crashed = auditor.filter((r) => r.status >= 500);
  expect(allowed, `2xx for Auditor: ${JSON.stringify(allowed)}`).toEqual([]);
  expect(crashed, `5xx for Auditor: ${JSON.stringify(crashed)}`).toEqual([]);
  // Only refusals that reveal nothing: 403 (denied), 404 (outside scope = indistinguishable from absent),
  // 400/422 (malformed probe). A 409 would mean the route read business state before authorizing.
  const leaky = auditor.filter((r) => ![400, 403, 404, 422].includes(r.status));
  expect(leaky, `state revealed before authorization: ${JSON.stringify(leaky)}`).toEqual([]);
  expect(auditor.filter((r) => r.status === 403).length).toBeGreaterThan(30);

  const sched = await sweep(USERS.scheduler, (r) => ADMIN_ONLY.test(r.path));
  const schedAllowed = sched.filter((r) => (r.status >= 200 && r.status < 300) || r.status >= 500);
  expect(schedAllowed, JSON.stringify(schedAllowed)).toEqual([]);
  expect(sched.length).toBeGreaterThan(15);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql<{ action: string }[]>`
      select a.action from audit_events a join users u on u.id = a.actor_user_id
      where u.email in (${USERS.auditor}, ${USERS.scheduler}) and a.created_at >= ${started} and a.outcome = 'ALLOW'
        and a.action not like 'auth.%' and a.action not like 'patient.read%' and a.action not like '%.view%'`;
    expect(rows.map((r) => r.action)).toEqual([]);
  } finally {
    await sql.end();
  }
  test.info().annotations.push({
    type: "matrix",
    description: `auditor: ${auditor.length} calls (${auditor.filter((r) => r.status === 403).length}×403); scheduler admin-only: ${sched.length} calls`,
  });
});

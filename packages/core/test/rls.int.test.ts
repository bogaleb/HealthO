import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { createProject } from "../src/projects/projects";
import { createTask } from "../src/projects/tasks";
import { makeOrg, testDb, type Fixture } from "./helpers";

/**
 * Row-level security (migration 0015) as a second wall: a least-privilege role bound to org A sees, changes and
 * creates ONLY org A rows in every tenant table — even with queries that "forget" the organization filter.
 * Mirrors infra/sql/app-role.sql (role bound with ALTER ROLE … IN DATABASE … SET app.org_id).
 */
const { db, end } = testDb();
let A: Fixture;
let B: Fixture;
const role = `rls_probe_${randomBytes(4).toString("hex")}`;
const password = randomBytes(16).toString("hex");
let probe: postgres.Sql;
let orgTables: string[] = [];

beforeAll(async () => {
  A = await makeOrg(db, "A");
  B = await makeOrg(db, "B");
  for (const o of [A, B]) {
    const ctx = await o.users.admin.ctx();
    const p = (await createProject(db, ctx, { key: "RLS", name: "RLS probe" }))!;
    await createTask(db, ctx, { projectId: p.id, title: "RLS task" });
  }
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  await db.execute(sql.raw(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`));
  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${role}`));
  await db.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`));
  await db.execute(sql.raw(`ALTER ROLE ${role} IN DATABASE "${dbName}" SET app.org_id = '${A.org.id}'`));
  url.username = role;
  url.password = password;
  probe = postgres(url.toString(), { max: 1, onnotice: () => {} });
  orgTables = (
    await db.execute<{ table_name: string }>(sql`
      select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'organization_id' order by 1`)
  ).map((r) => r.table_name);
});

afterAll(async () => {
  await probe?.end();
  await db.execute(sql.raw(`DROP OWNED BY ${role}`));
  await db.execute(sql.raw(`DROP ROLE ${role}`));
  await end();
});

describe("row-level security — every tenant table", () => {
  it("guard: every table with organization_id (and organizations) has RLS enabled with the org_isolation policy", async () => {
    expect(orgTables.length).toBeGreaterThan(50);
    const rows = await db.execute<{ relname: string; rls: boolean; policies: number }>(sql`
      select c.relname, c.relrowsecurity as rls, (select count(*)::int from pg_policies p where p.tablename = c.relname and p.policyname = 'org_isolation') as policies
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`);
    const byName = new Map(rows.map((r) => [r.relname, r]));
    const missing = [...orgTables, "organizations"].filter((t) => !byName.get(t)?.rls || byName.get(t)?.policies !== 1);
    expect(missing, "add `select app_enable_org_rls('<table>')` to the migration that creates these tables").toEqual([]);
  });

  it("a role bound to org A never sees org B rows, even without a WHERE on organization_id", async () => {
    const leaks: string[] = [];
    for (const t of orgTables) {
      const [r] = await probe.unsafe(`select count(*)::int as n from "${t}" where organization_id = $1`, [B.org.id]);
      if ((r!.n as number) > 0) leaks.push(t);
    }
    expect(leaks).toEqual([]);
    // …while its own data is fully visible (unfiltered queries return A's rows only).
    const [own] = await probe`select count(*)::int as n, count(distinct organization_id)::int as orgs from tasks`;
    expect(own!.n).toBeGreaterThan(0);
    expect(own!.orgs).toBe(1);
    const orgs = await probe`select id from organizations`;
    expect(orgs.map((o) => o.id)).toEqual([A.org.id]);
  });

  it("cannot change or delete org B rows, nor create rows for org B", async () => {
    const upd = await probe`update sites set name = 'pwned' where organization_id = ${B.org.id}`;
    expect(upd.count).toBe(0);
    const del = await probe`delete from tasks where organization_id = ${B.org.id}`;
    expect(del.count).toBe(0);
    await expect(probe`insert into departments (organization_id, code, name) values (${B.org.id}, 'EVIL', 'Injected')`).rejects.toThrow(/row-level security/);
    // Moving an own row into org B is also refused.
    await expect(probe`update departments set organization_id = ${B.org.id} where organization_id = ${A.org.id}`).rejects.toThrow(/row-level security/);
    // Org A can still write its own rows.
    const ok = await probe`insert into departments (organization_id, code, name) values (${A.org.id}, 'OK', 'Allowed') returning id`;
    expect(ok).toHaveLength(1);
  });

  it("fails closed when the organization binding is missing", async () => {
    // Same role, binding cleared for one transaction (as a pooled multi-tenant runtime would before SET LOCAL).
    const r = await probe.begin(async (t) => {
      await t`select set_config('app.org_id', '', true)`;
      const [row] = await t`select (select count(*)::int from sites) as sites, (select count(*)::int from organizations) as orgs`;
      return row;
    });
    expect(r).toEqual({ sites: 0, orgs: 0 });
  });
});

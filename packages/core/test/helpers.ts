import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@projectos/db";
import { departments, sites } from "@projectos/db/schema";
import { loadAuthContext, type AuthContext } from "@projectos/auth";
import { bootstrapOrganization, createMemberDirect } from "../src/seed/bootstrap";

let shared: { db: Db; end: () => Promise<void> } | undefined;
export function testDb() {
  if (!shared) {
    const { db, sql } = createDb(process.env.TEST_DATABASE_URL!, 10);
    shared = { db, end: () => sql.end() };
  }
  return shared;
}

export type Fixture = Awaited<ReturnType<typeof makeOrg>>;

/** A fully isolated synthetic organization with sites, departments and role-holding users. */
export async function makeOrg(db: Db, label = "A") {
  const suffix = randomUUID().slice(0, 8);
  const { org, roleIds } = await bootstrapOrganization(db, { name: `Test Org ${label} (SYNTHETIC)`, slug: `test-${label.toLowerCase()}-${suffix}` });
  const [s1, s2] = await db
    .insert(sites)
    .values([
      { organizationId: org.id, code: "S1", name: "Site One", state: "VA", timezone: "America/New_York" },
      { organizationId: org.id, code: "S2", name: "Site Two", state: "MD", timezone: "America/New_York" },
    ])
    .returning();
  const [rcm, cred] = await db
    .insert(departments)
    .values([
      { organizationId: org.id, code: "RCM", name: "Revenue Cycle" },
      { organizationId: org.id, code: "CRED", name: "Credentialing" },
    ])
    .returning();
  const user = async (name: string, grants: { roleId: string; siteId?: string; departmentId?: string }[]) => {
    const m = await createMemberDirect(db, {
      organizationId: org.id,
      email: `${name}-${suffix}@test.example`,
      displayName: `${name} ${label}`,
      passwordHash: "not-a-real-hash",
      grants,
    });
    return { ...m, ctx: async (): Promise<AuthContext> => (await loadAuthContext(db, m.userId))! };
  };
  const admin = await user("admin", [{ roleId: roleIds.org_admin! }]);
  const pm = await user("pm", [{ roleId: roleIds.project_manager! }]);
  const scheduler = await user("scheduler", [{ roleId: roleIds.scheduler!, siteId: s1!.id }]);
  const rcmAnalyst = await user("rcm", [{ roleId: roleIds.rcm_analyst!, departmentId: rcm!.id }]);
  const auditor = await user("auditor", [{ roleId: roleIds.auditor! }]);
  return { org, roleIds, sites: { s1: s1!, s2: s2! }, depts: { rcm: rcm!, cred: cred! }, users: { admin, pm, scheduler, rcmAnalyst, auditor }, user, suffix };
}

export async function expectAppError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string };
    if (err.code !== code) throw new Error(`Expected AppError ${code} but got ${err.code ?? String(e)}`);
    return e;
  }
  throw new Error(`Expected AppError ${code} but promise resolved`);
}

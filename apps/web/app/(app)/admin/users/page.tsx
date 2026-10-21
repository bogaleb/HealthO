import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { listDepartments, listInvites, listMembers, listRoles, listSites } from "@projectos/core";
import { hasAny } from "@projectos/auth";
import { PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { Forbidden } from "@/components/Forbidden";
import { UsersAdmin } from "@/components/admin/UsersAdmin";

export const metadata: Metadata = { title: "Staff & Permissions" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ departmentId?: string; status?: string }> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "users.manage")) return <Forbidden what="staff administration" />;
  const sp = await searchParams;
  const filters = {
    departmentId: /^[0-9a-f-]{36}$/.test(sp.departmentId ?? "") ? sp.departmentId : undefined,
    status: sp.status === "ACTIVE" || sp.status === "SUSPENDED" ? sp.status : undefined,
  };
  const db = getDb();
  const [members, invites, roles, sites, departments] = await Promise.all([listMembers(db, ctx, filters), listInvites(db, ctx), listRoles(db, ctx), listSites(db, ctx), listDepartments(db, ctx)]);
  return (
    <div>
      <PageHeader title="Staff & Permissions" description="Memberships, role grants and their site/department scope. Every change is enforced on the server and written to the audit log." />
      <UsersAdmin
        members={members}
        invites={invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))}
        refs={{ roles, sites, departments }}
        me={ctx.membershipId}
        filters={filters}
      />
    </div>
  );
}

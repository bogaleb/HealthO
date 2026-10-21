import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { listRoles } from "@projectos/core";
import { hasAny, hasOrgWide } from "@projectos/auth";
import { PERMISSIONS } from "@projectos/shared";
import { PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { Forbidden } from "@/components/Forbidden";
import { RolesAdmin } from "@/components/admin/RolesAdmin";

export const metadata: Metadata = { title: "Roles" };

export default async function RolesPage() {
  const ctx = await requireContext();
  if (!hasAny(ctx, "users.manage") && !hasAny(ctx, "org.manage")) return <Forbidden what="roles" />;
  const roles = await listRoles(getDb(), ctx);
  return (
    <div>
      <PageHeader title="Roles" description="Deny-by-default permission bundles. Built-in roles are fixed; custom roles require Organization Administrator rights." />
      <RolesAdmin roles={roles} canManage={hasOrgWide(ctx, "org.manage")} held={PERMISSIONS.filter((p) => hasOrgWide(ctx, p))} />
    </div>
  );
}

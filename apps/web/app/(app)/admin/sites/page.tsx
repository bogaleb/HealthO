import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { listDepartments, listSites, listTeams, manageableSiteIds } from "@projectos/core";
import { hasOrgWide } from "@projectos/auth";
import { PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { DepartmentsAdmin, SitesAdmin } from "@/components/admin/SitesAdmin";

export const metadata: Metadata = { title: "Sites & Departments" };

export default async function SitesPage() {
  const ctx = await requireContext();
  const db = getDb();
  const [sites, departments, teams] = await Promise.all([listSites(db, ctx, { includeInactive: true }), listDepartments(db, ctx), listTeams(db, ctx)]);
  const canCreate = hasOrgWide(ctx, "sites.manage");
  return (
    <div className="space-y-5">
      <PageHeader title="Sites & Departments" description="Organization reference data, read live from PostgreSQL. Editing requires the Sites permission (org-wide, or for your own site)." />
      <SitesAdmin sites={sites} canCreate={canCreate} manageable={manageableSiteIds(ctx, sites)} />
      <DepartmentsAdmin departments={departments} teams={teams} sites={sites.filter((s) => s.active)} canManage={canCreate} />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { listDepartments, listMemberDirectory, listProjects, listSites, listTemplates } from "@projectos/core";
import { hasAny } from "@projectos/auth";
import { PROJECT_STATUSES } from "@projectos/shared";
import { Badge, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { HEALTH_LABEL, HEALTH_TONE, PROJECT_STATUS_LABEL, formatDate } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { NewProjectButton } from "@/components/projects/NewProjectButton";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "projects.read")) return <Forbidden what="projects" />;
  const { status } = await searchParams;
  const st = PROJECT_STATUSES.includes(status as never) ? status : undefined;
  const db = getDb();
  const [projects, members, departments, sites, templates] = await Promise.all([
    listProjects(db, ctx, { status: st }),
    listMemberDirectory(db, ctx),
    listDepartments(db, ctx),
    listSites(db, ctx),
    listTemplates(db, ctx),
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  return (
    <div>
      <PageHeader
        title="Projects"
        description="Projects you can see based on your role scope. Counts are live from the database."
        actions={hasAny(ctx, "projects.edit") && <NewProjectButton members={members} departments={departments} sites={sites} templates={templates} />}
      />
      <nav aria-label="Filter by status" className="mb-3 flex flex-wrap gap-1.5 text-[13px]">
        {[undefined, ...PROJECT_STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/projects?status=${s}` : "/projects"}
            aria-current={st === s ? "page" : undefined}
            className={`rounded-full border px-2.5 py-0.5 ${st === s ? "border-ink-900 bg-ink-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {s ? PROJECT_STATUS_LABEL[s] : "All"}
          </Link>
        ))}
      </nav>
      {projects.length === 0 ? (
        <EmptyState title="No projects to show" description={st ? "No projects with this status." : "Create a project or start from a department template."} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)]">
          <table className="w-full text-left text-[13.5px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Project
                </th>
                <th scope="col" className="px-3 py-2">
                  Department
                </th>
                <th scope="col" className="px-3 py-2">
                  Owner
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
                <th scope="col" className="px-3 py-2">
                  Health
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Open
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Overdue
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Done
                </th>
                <th scope="col" className="px-3 py-2">
                  Due
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5">
                    <Link href={`/projects/${p.id}/board`} className="font-medium text-slate-900 hover:text-teal-800 hover:underline">
                      {p.name}
                    </Link>
                    <div className="font-mono text-[11.5px] text-slate-500">{p.key}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{p.departmentId ? deptName.get(p.departmentId) : "Organization-wide"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{p.ownerName ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <Badge>{PROJECT_STATUS_LABEL[p.status]}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={HEALTH_TONE[p.health]}>{HEALTH_LABEL[p.health]}</Badge>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{p.openTasks}</td>
                  <td className={`tabular px-3 py-2.5 text-right ${p.overdueTasks ? "font-semibold text-red-700" : ""}`}>{p.overdueTasks}</td>
                  <td className="tabular px-3 py-2.5 text-right">{p.doneTasks}</td>
                  <td className="tabular px-3 py-2.5 text-slate-600">{formatDate(p.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

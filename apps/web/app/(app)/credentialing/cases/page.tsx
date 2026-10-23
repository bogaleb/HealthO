import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { listMemberDirectory, listProjects } from "@projectos/core";
import { listCases, listPractitioners } from "@projectos/credentialing";
import { can, hasAny } from "@projectos/auth";
import { CASE_STATUSES, CASE_TYPES, TASK_STATUS_LABEL, todayIn, type TaskStatus } from "@projectos/shared";
import { Badge, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { CASE_STATUS_TONE, TASK_STATUS_TONE, formatDate, humanize } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { NewCaseButton } from "@/components/credentialing/ProviderForms";
import { CaseRowActions } from "@/components/credentialing/CaseRowActions";

export const metadata: Metadata = { title: "Credentialing Cases" };

export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "credentialing.read")) return <Forbidden what="credentialing cases" />;
  const sp = await searchParams;
  const q = {
    status: CASE_STATUSES.includes(sp.status as never) ? sp.status : undefined,
    caseType: CASE_TYPES.includes(sp.caseType as never) ? sp.caseType : undefined,
    practitionerId: /^[0-9a-f-]{36}$/.test(sp.practitionerId ?? "") ? sp.practitionerId : undefined,
    open: sp.open === "false" ? undefined : "true",
  };
  const db = getDb();
  const [cases, practitioners, members, projects] = await Promise.all([
    load(listCases(db, ctx, Object.fromEntries(Object.entries(q).filter(([, v]) => v)))),
    listPractitioners(db, ctx, {}),
    listMemberDirectory(db, ctx),
    hasAny(ctx, "projects.read") ? listProjects(db, ctx) : Promise.resolve([]),
  ]);
  const editableProjects = projects
    .filter((p) => can(ctx, "projects.edit", { siteId: p.siteId, departmentId: p.departmentId }))
    .map((p) => ({ id: p.id, label: `${p.key} — ${p.name}` }));
  const today = todayIn("America/New_York");
  const canEdit = hasAny(ctx, "credentialing.edit");
  const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";
  return (
    <div>
      <PageHeader
        title="Credentialing cases"
        description="Work queue for licensure, renewal and payer-enrollment cases. Pending is never treated as approved."
        actions={canEdit && <NewCaseButton practitioners={practitioners} members={members} />}
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label="Filter cases">
        <div>
          <label htmlFor="cf-status" className="block text-xs font-medium text-slate-600">
            Status
          </label>
          <select id="cf-status" name="status" defaultValue={q.status ?? ""} className={sel}>
            <option value="">Any</option>
            {CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cf-type" className="block text-xs font-medium text-slate-600">
            Type
          </label>
          <select id="cf-type" name="caseType" defaultValue={q.caseType ?? ""} className={sel}>
            <option value="">Any</option>
            {CASE_TYPES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cf-open" className="block text-xs font-medium text-slate-600">
            Show
          </label>
          <select id="cf-open" name="open" defaultValue={q.open ? "true" : "false"} className={sel}>
            <option value="true">Open only</option>
            <option value="false">All</option>
          </select>
        </div>
        {q.practitionerId && <input type="hidden" name="practitionerId" value={q.practitionerId} />}
        <button
          type="submit"
          className="press sheen h-9 rounded-full bg-ink-900 px-4 text-sm font-medium text-white shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_8px_20px_-10px_rgb(43_51_105/0.55)] hover:bg-ink-800"
        >
          Apply
        </button>
        <Link href="/credentialing/cases" className="px-2 py-2 text-sm text-slate-600 hover:underline">
          Clear
        </Link>
      </form>
      {cases.length === 0 ? (
        <EmptyState title="No cases match" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)]">
          <table className="w-full text-left text-[13.5px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Case
                </th>
                <th scope="col" className="px-3 py-2">
                  Provider
                </th>
                <th scope="col" className="px-3 py-2">
                  Owner
                </th>
                <th scope="col" className="px-3 py-2">
                  Due
                </th>
                <th scope="col" className="px-3 py-2">
                  Next action
                </th>
                <th scope="col" className="px-3 py-2">
                  Linked task
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cases.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{c.title}</div>
                    <Badge className="mt-1">{humanize(c.caseType)}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link className="text-teal-800 hover:underline" href={`/providers/${c.practitionerId}`}>
                      {c.practitionerName}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{c.ownerName ?? "Unassigned"}</td>
                  <td className={`tabular px-3 py-2.5 ${c.dueDate && c.dueDate < today && !["COMPLETED", "CANCELLED"].includes(c.status) ? "font-semibold text-red-700" : ""}`}>
                    {formatDate(c.dueDate)}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{c.nextAction ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    {c.taskId ? (
                      <Link href={`/projects/${c.taskProjectId}/list?task=${c.taskId}`} className="hover:underline">
                        <Badge tone={TASK_STATUS_TONE[c.taskStatus ?? "TODO"]}>
                          #{c.taskNumber} {TASK_STATUS_LABEL[(c.taskStatus ?? "TODO") as TaskStatus]}
                        </Badge>
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500">None</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={CASE_STATUS_TONE[c.status]} className="mb-1">
                      {humanize(c.status)}
                    </Badge>
                    <CaseRowActions c={c} canEdit={canEdit} projects={editableProjects} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

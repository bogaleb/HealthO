import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { getProjectDetail, listMemberDirectory, listRecurringDefinitions } from "@projectos/core";
import { BOARD_COLUMNS, TASK_STATUS_LABEL, todayIn } from "@projectos/shared";
import { Badge, Card, CardHeader, EmptyState } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { AddMilestoneForm, AddRecurringForm, ProjectSettingsForm } from "@/components/projects/ProjectControls";

export const metadata: Metadata = { title: "Project overview" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function ProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const db = getDb();
  const [d, members, recurring] = await Promise.all([load(getProjectDetail(db, ctx, id)), listMemberDirectory(db, ctx), load(listRecurringDefinitions(db, ctx, id))]);
  const total = Object.values(d.statusCounts).reduce((a, b) => a + b, 0);
  const done = d.statusCounts.DONE ?? 0;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="Progress" description={`${done} of ${total} tasks done (cancelled excluded from the board).`} />
          <div className="p-4">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Tasks done">
              <div className="h-full bg-emerald-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <dl className="mt-3 grid grid-cols-5 gap-2 text-center">
              {BOARD_COLUMNS.map((s) => (
                <div key={s}>
                  <dt className="text-[11.5px] text-slate-500">{TASK_STATUS_LABEL[s]}</dt>
                  <dd className="tabular text-lg font-semibold">
                    <Link className="hover:underline" href={`/projects/${id}/list?status=${s}`}>
                      {d.statusCounts[s] ?? 0}
                    </Link>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Card>
        <Card>
          <CardHeader title="Blocked work" description="Open tasks with status Blocked or an unfinished blocking dependency" />
          {d.blockedTasks.length ? (
            <ul className="divide-y divide-slate-100">
              {d.blockedTasks.map((t) => (
                <li key={t.id}>
                  <Link href={`/projects/${id}?task=${t.id}`} scroll={false} className="block px-4 py-2 text-[13.5px] hover:bg-slate-50">
                    <span className="mr-2 font-mono text-[12px] text-slate-500">
                      {d.project.key}-{t.number}
                    </span>
                    {t.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-slate-500">Nothing is blocked.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Milestones" />
          {d.milestones.length ? (
            <ul className="divide-y divide-slate-100">
              {d.milestones.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
                  <span className="flex-1 font-medium">{m.name}</span>
                  <span className="tabular text-slate-600">
                    {m.done}/{m.total} done
                  </span>
                  <span className="tabular w-28 text-right text-slate-600">{formatDate(m.dueDate)}</span>
                  {m.dueDate && m.dueDate < todayIn("America/New_York") && m.done < m.total && <Badge tone="red">Past due</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4">
              <EmptyState title="No milestones yet" />
            </div>
          )}
          {d.canEdit && <AddMilestoneForm projectId={id} />}
        </Card>
        <Card>
          <CardHeader title="Recurring tasks" description="Generated idempotently by the background worker (America/New_York). Re-running never creates duplicates." />
          {recurring.length ? (
            <ul className="divide-y divide-slate-100">
              {recurring.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
                  <span className="flex-1 font-medium">{r.title}</span>
                  <Badge tone="teal">{r.cadence === "WEEKLY" ? `Weekly · ${WEEKDAYS[r.weekday ?? 0]}` : r.cadence === "MONTHLY" ? `Monthly · day ${r.monthDay}` : "Daily"}</Badge>
                  <span className="text-[12px] text-slate-500">last generated {formatDate(r.lastGeneratedOn)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-slate-500">No recurring tasks.</p>
          )}
          {d.canEdit && <AddRecurringForm projectId={id} members={members} defaultStart={todayIn("America/New_York")} />}
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="About" />
          <p className="whitespace-pre-wrap px-4 py-3 text-[13.5px] text-slate-700">{d.project.description || "No description."}</p>
        </Card>
        {d.canEdit ? (
          <Card>
            <CardHeader title="Project settings" description="Changes are version-checked and audited." />
            <ProjectSettingsForm project={d.project} members={members} />
          </Card>
        ) : (
          <p className="text-[13px] text-slate-500">You have read-only access to this project.</p>
        )}
      </div>
    </div>
  );
}

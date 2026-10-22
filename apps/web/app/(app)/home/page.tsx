import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { getHomeSummary, getMyWork, recentProjects } from "@projectos/core";
import { hasAny } from "@projectos/auth";
import { addDays } from "@projectos/shared";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { HEALTH_LABEL, HEALTH_TONE, formatDate, formatInstant } from "@/lib/format";
import { TaskRowLink } from "@/components/tasks/TaskRowLink";

export const metadata: Metadata = { title: "Home" };

function Metric({ label, value, href, definition }: { label: string; value: number; href?: string; definition: string }) {
  const body = (
    <>
      <div className="text-[12.5px] font-medium text-slate-600">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-[11.5px] leading-snug text-slate-500">{definition}</div>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-teal-600 hover:shadow-sm">
      {body}
      <span className="sr-only">— view the {value} records</span>
    </Link>
  ) : (
    <div className="rounded-lg border border-slate-200 bg-white p-4">{body}</div>
  );
}

export default async function HomePage() {
  const ctx = await requireContext();
  const db = getDb();
  const summary = await getHomeSummary(db, ctx);
  const canProjects = hasAny(ctx, "projects.read");
  const [work, recent] = canProjects ? await Promise.all([getMyWork(db, ctx, summary.organization?.timezone), recentProjects(db, ctx, 5)]) : [null, []];
  const yesterday = addDays(summary.today, -1);
  const pm = summary.projectMetrics;
  const focus = work ? [...work.overdue, ...work.dueToday].slice(0, 8) : [];

  return (
    <div>
      <PageHeader
        eyebrow={summary.organization?.name}
        title={`Welcome, ${ctx.displayName}`}
        description={
          <>
            Counts are computed live from the database at {formatInstant(summary.computedAt, summary.organization?.timezone)} for the projects you are permitted to see. “Today” is{" "}
            {formatDate(summary.today)} ({summary.organization?.timezone}).
          </>
        }
      />
      {pm ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric label="My open tasks" value={pm.myOpen} href="/tasks?open=true&mine=true" definition="Owned by or shared with you; not Done/Cancelled." />
          <Metric label="My overdue" value={pm.myOverdue} href={`/tasks?open=true&mine=true&dueTo=${yesterday}`} definition="Your open tasks due before today." />
          <Metric label="Open tasks" value={pm.openTasks} href="/tasks?open=true" definition="All open tasks in projects visible to you." />
          <Metric label="Overdue tasks" value={pm.overdueTasks} href={`/tasks?open=true&dueTo=${yesterday}`} definition="Open tasks due before today." />
          <Metric label="Active projects" value={pm.activeProjects} href="/projects?status=ACTIVE" definition="Projects with status Active." />
        </div>
      ) : (
        <EmptyState title="No project access" description="Your role doesn’t include project visibility." />
      )}

      {canProjects && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Needs attention"
              description="Your overdue and due-today tasks"
              actions={
                <Link className="text-[13px] font-medium text-teal-700 hover:underline" href="/tasks/my-work">
                  My Work →
                </Link>
              }
            />
            {focus.length ? (
              <ul className="divide-y divide-slate-100">
                {focus.map((t) => (
                  <TaskRowLink key={t.id} task={t} today={summary.today} />
                ))}
              </ul>
            ) : (
              <div className="p-4">
                <EmptyState title="Nothing overdue or due today" description="Tasks assigned to you will appear here." />
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Recently updated projects" />
            {recent.length ? (
              <ul className="divide-y divide-slate-100">
                {recent.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50">
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium text-slate-800">{p.name}</span>
                        <span className="text-xs text-slate-500">
                          {p.key} · due {formatDate(p.dueDate)}
                        </span>
                      </span>
                      <Badge tone={HEALTH_TONE[p.health]}>{HEALTH_LABEL[p.health]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4">
                <EmptyState
                  title="No projects yet"
                  action={
                    <Link className="text-sm font-medium text-teal-700 underline" href="/projects">
                      Create a project
                    </Link>
                  }
                />
              </div>
            )}
          </Card>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader title="Organization" description="Reference data from PostgreSQL" />
        <dl className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">Active sites</dt>
            <dd className="tabular text-lg font-semibold">
              <Link className="hover:underline" href="/admin/sites">
                {summary.activeSites}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Active staff memberships</dt>
            <dd className="tabular text-lg font-semibold">{summary.activeMembers}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-slate-500">Modules in this build</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone="green">Projects &amp; tasks</Badge>
              <Badge tone="green">Staff, roles &amp; sites</Badge>
              <Badge tone="green">Audit log</Badge>
              <Badge tone="green">Scheduling &amp; eligibility (demo)</Badge>
              <Badge tone="green">Credentialing &amp; readiness</Badge>
              <Badge tone="green">Revenue-cycle queues &amp; reports</Badge>
              <Badge>EHR integration — Phase 7</Badge>
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

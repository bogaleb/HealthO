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
import { CountUp } from "@/components/motion/CountUp";

export const metadata: Metadata = { title: "Home" };

function Metric({ label, value, href, definition, index }: { label: string; value: number; href?: string; definition: string; index: number }) {
  const body = (
    <>
      <div className="text-[13px] font-medium text-slate-600">{label}</div>
      <div className="display-title tabular mt-2 text-[40px] leading-none">
        <CountUp value={value} delay={index * 70 + 200} />
      </div>
      <div className="mt-2.5 text-[12px] leading-snug text-slate-500">{definition}</div>
    </>
  );
  const shell = "rise group relative block overflow-hidden rounded-2xl border border-[var(--hairline)] bg-white p-5 shadow-[var(--shadow-card)]";
  const edge = (
    <span
      aria-hidden
      className="pearl-bg absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 transition-transform duration-700 [transition-timing-function:var(--ease-out-expo)] group-hover:scale-x-100"
    />
  );
  return href ? (
    <Link href={href} className={`${shell} lift`} style={{ ["--i" as string]: index }}>
      {edge}
      {body}
      <span className="sr-only">— view the {value} records</span>
    </Link>
  ) : (
    <div className={shell} style={{ ["--i" as string]: index }}>
      {body}
    </div>
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
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
          <Metric index={0} label="My open tasks" value={pm.myOpen} href="/tasks?open=true&mine=true" definition="Owned by or shared with you; not Done/Cancelled." />
          <Metric index={1} label="My overdue" value={pm.myOverdue} href={`/tasks?open=true&mine=true&dueTo=${yesterday}`} definition="Your open tasks due before today." />
          <Metric index={2} label="Open tasks" value={pm.openTasks} href="/tasks?open=true" definition="All open tasks in projects visible to you." />
          <Metric index={3} label="Overdue tasks" value={pm.overdueTasks} href={`/tasks?open=true&dueTo=${yesterday}`} definition="Open tasks due before today." />
          <Metric index={4} label="Active projects" value={pm.activeProjects} href="/projects?status=ACTIVE" definition="Projects with status Active." />
        </div>
      ) : (
        <EmptyState title="No project access" description="Your role doesn’t include project visibility." />
      )}

      {canProjects && (
        <div className="mt-7 grid gap-5 lg:grid-cols-3">
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

      <Card className="mt-7">
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

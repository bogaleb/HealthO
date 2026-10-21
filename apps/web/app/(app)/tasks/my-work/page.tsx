import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@projectos/db";
import { organizations } from "@projectos/db/schema";
import { getMyWork } from "@projectos/core";
import { hasAny } from "@projectos/auth";
import { Card, CardHeader, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { TaskRowLink, type TaskLite } from "@/components/tasks/TaskRowLink";

export const metadata: Metadata = { title: "My Work" };

function Group({ title, items, today, empty }: { title: string; items: TaskLite[]; today: string; empty: string }) {
  return (
    <Card>
      <CardHeader title={`${title} (${items.length})`} />
      {items.length ? (
        <ul className="divide-y divide-slate-100">
          {items.map((t) => (
            <TaskRowLink key={t.id} task={t} today={today} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-slate-500">{empty}</p>
      )}
    </Card>
  );
}

export default async function MyWorkPage() {
  const ctx = await requireContext();
  if (!hasAny(ctx, "projects.read")) return <Forbidden what="projects" />;
  const db = getDb();
  const [org] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.organizationId));
  const w = await getMyWork(db, ctx, org?.tz);
  const total = w.overdue.length + w.dueToday.length + w.upcoming.length + w.noDate.length;
  return (
    <div>
      <PageHeader title="My Work" description={`Open tasks you own or collaborate on, grouped by due date. Today is ${formatDate(w.today)} (${org?.tz}).`} />
      {total === 0 ? (
        <EmptyState title="You have no open tasks" description="Tasks assigned to you or shared with you will show up here." />
      ) : (
        <div className="space-y-4">
          <Group title="Overdue" items={w.overdue} today={w.today} empty="Nothing overdue." />
          <Group title="Due today" items={w.dueToday} today={w.today} empty="Nothing due today." />
          <Group title="Upcoming" items={w.upcoming} today={w.today} empty="Nothing scheduled." />
          <Group title="No due date" items={w.noDate} today={w.today} empty="Every task has a due date." />
        </div>
      )}
    </div>
  );
}

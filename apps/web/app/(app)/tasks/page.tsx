import type { Metadata } from "next";
import { Suspense } from "react";
import { getDb } from "@projectos/db";
import { listMemberDirectory, listTasks } from "@projectos/core";
import { hasAny } from "@projectos/auth";
import { todayIn } from "@projectos/shared";
import { PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { pickFilters, TASK_FILTER_KEYS } from "@/lib/params";
import { Forbidden } from "@/components/Forbidden";
import { TaskTable } from "@/components/tasks/TaskTable";
import { TaskDrawerHost } from "@/components/tasks/TaskDrawerHost";

export const metadata: Metadata = { title: "All tasks" };

export default async function AllTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "projects.read")) return <Forbidden what="tasks" />;
  const sp = await searchParams;
  const db = getDb();
  const filters = pickFilters(sp, TASK_FILTER_KEYS);
  const [members, result] = await Promise.all([listMemberDirectory(db, ctx), load(listTasks(db, ctx, Object.fromEntries(Object.entries(filters).filter(([, v]) => v))))]);
  return (
    <div>
      <PageHeader title="Tasks" description="All tasks across projects you can see. Dashboard tiles link here with the same filters they count with." />
      <TaskTable basePath="/tasks" filters={filters} result={result} members={members} today={todayIn("America/New_York")} showProject />
      <Suspense>
        <TaskDrawerHost members={members} />
      </Suspense>
    </div>
  );
}

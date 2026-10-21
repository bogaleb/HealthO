import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { getProjectDetail, listMemberDirectory, listTasks } from "@projectos/core";
import { todayIn } from "@projectos/shared";
import { requireContext, load } from "@/lib/session";
import { pickFilters, TASK_FILTER_KEYS } from "@/lib/params";
import { TaskTable } from "@/components/tasks/TaskTable";
import { NewTaskButton } from "@/components/tasks/NewTaskButton";

export const metadata: Metadata = { title: "Task list" };

export default async function ProjectListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  const db = getDb();
  const filters = pickFilters(sp, TASK_FILTER_KEYS);
  const [detail, members, result] = await Promise.all([
    load(getProjectDetail(db, ctx, id)),
    listMemberDirectory(db, ctx),
    load(listTasks(db, ctx, { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), projectId: id })),
  ]);
  return (
    <div>
      {detail.canEdit && (
        <div className="mb-3 flex justify-end">
          <NewTaskButton projectId={id} members={members} milestones={detail.milestones} />
        </div>
      )}
      <TaskTable basePath={`/projects/${id}/list`} filters={filters} result={result} members={members} today={todayIn("America/New_York")} />
    </div>
  );
}

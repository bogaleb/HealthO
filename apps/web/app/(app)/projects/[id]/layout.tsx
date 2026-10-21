import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@projectos/db";
import { getProject, listMemberDirectory } from "@projectos/core";
import { Badge } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { HEALTH_LABEL, HEALTH_TONE, PROJECT_STATUS_LABEL, formatDate } from "@/lib/format";
import { ProjectTabs } from "@/components/tasks/ProjectTabs";
import { TaskDrawerHost } from "@/components/tasks/TaskDrawerHost";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const db = getDb();
  const [project, members] = await Promise.all([load(getProject(db, ctx, id)), listMemberDirectory(db, ctx)]);
  return (
    <div>
      <div className="mb-1 text-[12.5px] text-slate-500">
        <Link href="/projects" className="hover:underline">
          Projects
        </Link>{" "}
        / <span className="font-mono">{project.key}</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
        <Badge>{PROJECT_STATUS_LABEL[project.status]}</Badge>
        <Badge tone={HEALTH_TONE[project.health]}>{HEALTH_LABEL[project.health]}</Badge>
        <span className="text-[12.5px] text-slate-500">
          {formatDate(project.startDate)} → {formatDate(project.dueDate)}
        </span>
      </div>
      <ProjectTabs projectId={project.id} />
      {children}
      <Suspense>
        <TaskDrawerHost members={members} />
      </Suspense>
    </div>
  );
}

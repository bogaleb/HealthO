import Link from "next/link";
import { Lock } from "lucide-react";
import { Badge } from "@projectos/ui";
import { TASK_STATUS_LABEL, type TaskStatus } from "@projectos/shared";
import { PRIORITY_LABEL, PRIORITY_TONE, TASK_STATUS_TONE, formatDate } from "@/lib/format";

export interface TaskLite {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  projectId: string;
  projectKey: string;
  isBlocked: boolean;
  ownerName: string | null;
}

/** Single task line used by Home and My Work. Opens the task drawer on its project board. */
export function TaskRowLink({ task: t, today }: { task: TaskLite; today: string }) {
  const overdue = t.dueDate && t.dueDate < today;
  return (
    <li>
      <Link href={`/projects/${t.projectId}/list?task=${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
        <span className="w-16 shrink-0 font-mono text-[12px] text-slate-500">
          {t.projectKey}-{t.number}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-slate-800">{t.title}</span>
        {t.isBlocked && (
          <Badge tone="red" icon={<Lock className="h-3 w-3" aria-hidden />}>
            Blocked
          </Badge>
        )}
        <Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status as TaskStatus]}</Badge>
        <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
        <span className={`tabular w-24 shrink-0 text-right text-[12.5px] ${overdue ? "font-semibold text-red-700" : "text-slate-600"}`}>
          {overdue && <span className="sr-only">Overdue, </span>}
          {formatDate(t.dueDate, { withYear: false })}
        </span>
      </Link>
    </li>
  );
}

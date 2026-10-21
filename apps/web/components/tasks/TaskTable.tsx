import Link from "next/link";
import { Lock } from "lucide-react";
import { Badge, EmptyState } from "@projectos/ui";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from "@projectos/shared";
import type { TaskListItem } from "@projectos/core";
import { PRIORITY_LABEL, PRIORITY_TONE, TASK_STATUS_TONE, formatDate } from "@/lib/format";

type Filters = Record<string, string | undefined>;

/** Server-rendered, server-paginated task table. All filter state lives in the query string. */
export function TaskTable({
  basePath,
  filters,
  result,
  members,
  today,
  showProject,
}: {
  basePath: string;
  filters: Filters;
  result: { items: TaskListItem[]; total: number; page: number; pageSize: number };
  members: { userId: string; displayName: string }[];
  today: string;
  showProject?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const qs = (over: Filters) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";
  return (
    <div>
      <form method="get" action={basePath} className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filter tasks">
        <div>
          <label htmlFor="f-q" className="block text-xs font-medium text-slate-600">
            Search
          </label>
          <input id="f-q" name="q" defaultValue={filters.q} placeholder="Title contains…" className={`${sel} w-52`} />
        </div>
        <div>
          <label htmlFor="f-status" className="block text-xs font-medium text-slate-600">
            Status
          </label>
          <select id="f-status" name="status" defaultValue={filters.status ?? ""} className={sel}>
            <option value="">Any</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-open" className="block text-xs font-medium text-slate-600">
            Open only
          </label>
          <select id="f-open" name="open" defaultValue={filters.open ?? ""} className={sel}>
            <option value="">No</option>
            <option value="true">Yes</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-priority" className="block text-xs font-medium text-slate-600">
            Priority
          </label>
          <select id="f-priority" name="priority" defaultValue={filters.priority ?? ""} className={sel}>
            <option value="">Any</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-owner" className="block text-xs font-medium text-slate-600">
            Owner
          </label>
          <select id="f-owner" name="ownerUserId" defaultValue={filters.ownerUserId ?? ""} className={sel}>
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-label" className="block text-xs font-medium text-slate-600">
            Label
          </label>
          <input id="f-label" name="label" defaultValue={filters.label} className={`${sel} w-28`} />
        </div>
        <div>
          <label htmlFor="f-dueTo" className="block text-xs font-medium text-slate-600">
            Due on/before
          </label>
          <input id="f-dueTo" type="date" name="dueTo" defaultValue={filters.dueTo} className={sel} />
        </div>
        {filters.mine && <input type="hidden" name="mine" value={filters.mine} />}
        <button type="submit" className="h-9 rounded-md bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800">
          Apply
        </button>
        <Link href={basePath} className="h-9 px-2 py-2 text-sm text-slate-600 hover:underline">
          Clear
        </Link>
      </form>

      <p className="mb-2 text-[12.5px] text-slate-500" aria-live="polite">
        {result.total} task{result.total === 1 ? "" : "s"}
        {filters.mine === "true" ? " owned by or shared with you" : ""} · page {result.page} of {pages}
      </p>
      {result.items.length === 0 ? (
        <EmptyState
          title="No tasks match these filters"
          description="Clear or relax a filter to see more."
          action={
            <Link href={basePath} className="text-sm font-medium text-teal-700 underline">
              Clear filters
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-[13.5px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  ID
                </th>
                <th scope="col" className="px-3 py-2">
                  Title
                </th>
                {showProject && (
                  <th scope="col" className="px-3 py-2">
                    Project
                  </th>
                )}
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
                <th scope="col" className="px-3 py-2">
                  Priority
                </th>
                <th scope="col" className="px-3 py-2">
                  Owner
                </th>
                <th scope="col" className="px-3 py-2">
                  Due
                </th>
                <th scope="col" className="px-3 py-2">
                  Labels
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.items.map((t) => {
                const overdue = t.dueDate && t.dueDate < today && t.status !== "DONE" && t.status !== "CANCELLED";
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px] text-slate-500">
                      {t.projectKey}-{t.number}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={showProject ? `/projects/${t.projectId}/list?task=${t.id}` : qs({ task: t.id })}
                        scroll={false}
                        className="font-medium text-slate-800 hover:text-teal-800 hover:underline"
                      >
                        {t.title}
                      </Link>
                      {t.isBlocked && (
                        <Badge tone="red" className="ml-2" icon={<Lock className="h-3 w-3" aria-hidden />}>
                          Blocked
                        </Badge>
                      )}
                    </td>
                    {showProject && <td className="px-3 py-2 text-slate-600">{t.projectName}</td>}
                    <td className="px-3 py-2">
                      <Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status as TaskStatus]}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{t.ownerName ?? <span className="text-slate-400">Unassigned</span>}</td>
                    <td className={`tabular whitespace-nowrap px-3 py-2 ${overdue ? "font-semibold text-red-700" : "text-slate-700"}`}>
                      {overdue && <span className="sr-only">Overdue, </span>}
                      {formatDate(t.dueDate)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {t.labels.map((l) => (
                          <Badge key={l} tone="teal">
                            {l}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-3 flex items-center gap-2 text-sm">
          {result.page > 1 ? (
            <Link className="rounded border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50" href={qs({ page: String(result.page - 1), task: undefined })}>
              ← Previous
            </Link>
          ) : (
            <span className="px-2.5 py-1 text-slate-400">← Previous</span>
          )}
          {result.page < pages ? (
            <Link className="rounded border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50" href={qs({ page: String(result.page + 1), task: undefined })}>
              Next →
            </Link>
          ) : (
            <span className="px-2.5 py-1 text-slate-400">Next →</span>
          )}
        </nav>
      )}
    </div>
  );
}

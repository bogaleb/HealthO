import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { assignableMembers, listCases, listQueues, ownerWorkload, rcmReference, recentBatches } from "@projectos/rcm";
import { can, hasAny } from "@projectos/auth";
import {
  RCM_AGE_BUCKETS,
  RCM_CASE_STATUSES,
  RCM_CASE_TYPES,
  RCM_CASE_TYPE_LABEL,
  RCM_QUEUE_CATEGORY_LABEL,
  RCM_STATUS_LABEL,
  TASK_PRIORITIES,
  type RcmQueueCategory,
} from "@projectos/shared";
import { Badge, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { formatInstant, formatMoney } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { CaseTable } from "@/components/rcm/CaseTable";
import { NewCaseButton, NewQueueButton } from "@/components/rcm/RcmForms";

export const metadata: Metadata = { title: "RCM Work Queues" };

const KEYS = ["queueId", "status", "priority", "caseType", "owner", "age", "due", "payerId", "q", "page"] as const;

export default async function QueuesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "rcm.read")) return <Forbidden what="revenue-cycle work queues" />;
  const sp = await searchParams;
  const q: Record<string, string> = {};
  for (const k of KEYS) if (sp[k]) q[k] = sp[k]!;
  const db = getDb();
  const [{ queues, today, computedAt }, workload, list, ref, batches] = await Promise.all([
    listQueues(db, ctx),
    ownerWorkload(db, ctx, { queueId: /^[0-9a-f-]{36}$/i.test(q.queueId ?? "") ? q.queueId : undefined }),
    load(listCases(db, ctx, q)),
    rcmReference(db, ctx),
    recentBatches(db, ctx, 1),
  ]);
  const deptIds = [...new Set(queues.map((x) => x.departmentId))];
  const memberLists = await Promise.all(deptIds.map((d) => assignableMembers(db, ctx, { departmentId: d })));
  const members = [...new Map(memberLists.flat().map((m) => [m.userId, { value: m.userId, label: m.displayName }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const leadOptions = members;
  const canManageAny = queues.some((x) => x.canManage);
  const canEdit = hasAny(ctx, "rcm.edit");
  const recent = batches[0] && !batches[0].undoneAt && Date.now() - new Date(batches[0].createdAt).getTime() < 60 * 60_000 ? batches[0] : null;
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...q, page: undefined, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/rcm/queues${s ? `?${s}` : ""}`;
  };
  const clear = Object.fromEntries(Object.keys(q).map((k) => [k, undefined])) as Record<string, undefined>;
  const activeQueue = queues.find((x) => x.id === q.queueId);
  const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));

  return (
    <div>
      <PageHeader
        eyebrow="Revenue cycle · SYNTHETIC DEMO DATA"
        title="Work queues"
        description={
          <>
            Internal follow-up work on synthetic claim references (not a clearinghouse). Counts are live SQL over the cases you may see, computed {formatInstant(computedAt)}; every
            number links to exactly those rows.
          </>
        }
        actions={
          <div className="flex gap-2">
            {canManageAny && <NewQueueButton departments={ref.departments} members={leadOptions} />}
            {canEdit && queues.length > 0 && (
              <NewCaseButton
                queues={queues}
                payers={ref.payers}
                plans={ref.plans}
                sites={ref.sites}
                credentialingCases={ref.credentialingCases}
                members={members}
                canAssignOthers={canManageAny}
                selfId={ctx.userId}
                defaultQueueId={activeQueue?.id}
              />
            )}
          </div>
        }
      />

      <section aria-labelledby="queues-h" className="mb-6">
        <h2 id="queues-h" className="sr-only">
          Queues
        </h2>
        {queues.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">No queues are visible to you yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {queues.map((x) => {
              const n = x.counts;
              const active = x.id === q.queueId;
              return (
                <div key={x.id} className={`rounded-lg border bg-white p-3.5 ${active ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`} data-testid="queue-card">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={href({ queueId: active ? undefined : x.id })}
                      className="text-[14px] font-semibold text-slate-900 hover:underline"
                      aria-current={active ? "true" : undefined}
                    >
                      {x.name}
                    </Link>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone="teal">{RCM_QUEUE_CATEGORY_LABEL[x.category as RcmQueueCategory] ?? x.category}</Badge>
                    <Badge>{x.departmentName}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-x-2 gap-y-1.5 text-[12px]">
                    {(
                      [
                        ["Open", n.open, { queueId: x.id }],
                        ["Unassigned", n.unassigned, { queueId: x.id, owner: "none" }],
                        ["Overdue", n.overdue, { queueId: x.id, due: "overdue" }],
                        ["Due soon", n.dueSoon, { queueId: x.id, due: "soon" }],
                        ["> 90 days", n.aged90, { queueId: x.id, age: "over90" }],
                        ["Escalated", n.escalated, { queueId: x.id, status: "ESCALATED" }],
                      ] as const
                    ).map(([label, value, patch]) => (
                      <div key={label}>
                        <dt className="text-slate-500">{label}</dt>
                        <dd
                          className={`tabular text-base font-semibold ${value && label !== "Open" ? (label === "> 90 days" || label === "Escalated" ? "text-red-700" : "text-amber-800") : "text-slate-800"}`}
                        >
                          <Link className="hover:underline" href={href({ ...clear, ...patch })} aria-label={`${value} ${label.replace(">", "over")} in ${x.name}`}>
                            {value}
                          </Link>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 text-[11.5px] text-slate-500">
                    Open balance {formatMoney(n.openCents)} · resolved last 30 d: {n.resolved30} · lead {x.leadName ?? "—"} · follow-up {x.followUpDays} d
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-6 2xl:grid-cols-[1fr_300px]">
        <section aria-labelledby="cases-h" className="min-w-0 2xl:col-start-1 2xl:row-start-1">
          <h2 id="cases-h" className="mb-2 text-[15px] font-semibold">
            Cases {activeQueue ? `— ${activeQueue.name}` : ""} <span className="tabular text-sm font-normal text-slate-500">({list.total})</span>
          </h2>
          <form method="get" className="mb-3 flex flex-wrap items-end gap-2" aria-label="Filter cases">
            {q.queueId && <input type="hidden" name="queueId" value={q.queueId} />}
            <div>
              <label htmlFor="f-status" className="block text-xs font-medium text-slate-600">
                Status
              </label>
              <select id="f-status" name="status" defaultValue={q.status ?? ""} className={sel}>
                <option value="">Open (any)</option>
                {RCM_CASE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {RCM_STATUS_LABEL[s]}
                  </option>
                ))}
                <option value="ALL">All</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-owner" className="block text-xs font-medium text-slate-600">
                Owner
              </label>
              <select id="f-owner" name="owner" defaultValue={q.owner ?? ""} className={sel}>
                <option value="">Anyone</option>
                <option value="me">Me</option>
                <option value="none">Unassigned</option>
                {members.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-due" className="block text-xs font-medium text-slate-600">
                Next action
              </label>
              <select id="f-due" name="due" defaultValue={q.due ?? ""} className={sel}>
                <option value="">Any</option>
                <option value="overdue">Overdue</option>
                <option value="soon">Due today/tomorrow</option>
                <option value="none">No date</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-age" className="block text-xs font-medium text-slate-600">
                Age (days)
              </label>
              <select id="f-age" name="age" defaultValue={q.age ?? ""} className={sel}>
                <option value="">Any</option>
                {RCM_AGE_BUCKETS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
                <option value="over90">Over 90</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-priority" className="block text-xs font-medium text-slate-600">
                Priority
              </label>
              <select id="f-priority" name="priority" defaultValue={q.priority ?? ""} className={sel}>
                <option value="">Any</option>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-type" className="block text-xs font-medium text-slate-600">
                Type
              </label>
              <select id="f-type" name="caseType" defaultValue={q.caseType ?? ""} className={sel}>
                <option value="">Any</option>
                {RCM_CASE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RCM_CASE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-payer" className="block text-xs font-medium text-slate-600">
                Payer
              </label>
              <select id="f-payer" name="payerId" defaultValue={q.payerId ?? ""} className={sel}>
                <option value="">Any</option>
                {ref.payers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-q" className="block text-xs font-medium text-slate-600">
                Case # or claim ref
              </label>
              <input id="f-q" name="q" defaultValue={q.q ?? ""} placeholder="RCM-0012 or SYN-…" className={`${sel} w-44`} />
            </div>
            <button type="submit" className="h-9 rounded-md bg-teal-700 px-3 text-sm font-medium text-white">
              Apply
            </button>
            <Link href="/rcm/queues" className="px-2 py-2 text-sm text-slate-600 hover:underline">
              Clear
            </Link>
          </form>
          <CaseTable
            rows={list.items}
            showQueue={!activeQueue}
            today={today}
            canBulk={canManageAny}
            members={members}
            lastBatch={recent ? { id: recent.id, caseCount: recent.caseCount, ownerName: recent.ownerName } : null}
          />
          {pages > 1 && (
            <nav aria-label="Pagination" className="mt-3 flex items-center gap-3 text-sm">
              {list.page > 1 && <Link href={href({ page: String(list.page - 1) })}>← Previous</Link>}
              <span className="text-slate-500">
                Page {list.page} of {pages}
              </span>
              {list.page < pages && <Link href={href({ page: String(list.page + 1) })}>Next →</Link>}
            </nav>
          )}
        </section>

        <aside aria-labelledby="workload-h" className="2xl:order-2 2xl:col-start-2 2xl:row-start-1">
          <h2 id="workload-h" className="mb-2 text-[15px] font-semibold">
            Owner workload {activeQueue ? "(this queue)" : ""}
          </h2>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white 2xl:max-w-none max-w-xl">
            <table className="w-full text-left text-[12.5px]" data-testid="workload-table">
              <thead className="bg-slate-50 text-[11.5px] font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-1.5">
                    Owner
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right">
                    Open
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right">
                    Overdue
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right">
                    &gt;90 d
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workload.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-slate-500">
                      No open work.
                    </td>
                  </tr>
                )}
                {workload.map((w) => (
                  <tr key={w.ownerUserId ?? "none"}>
                    <td className="px-3 py-1.5">
                      <Link className="hover:underline" href={href({ owner: w.ownerUserId ?? "none", due: undefined })}>
                        {w.ownerName ?? "Unassigned"}
                      </Link>
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">{w.open}</td>
                    <td className={`tabular px-2 py-1.5 text-right ${w.overdue ? "font-semibold text-red-700" : ""}`}>
                      <Link className="hover:underline" href={href({ owner: w.ownerUserId ?? "none", due: "overdue" })}>
                        {w.overdue}
                      </Link>
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">{w.aged90}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {can(ctx, "rcm.manage", {}) || canManageAny
              ? "Select cases to bulk-assign; assignments can be undone."
              : "Supervisors assign work. You can claim unassigned cases from the case page."}
          </p>
        </aside>
      </div>
    </div>
  );
}

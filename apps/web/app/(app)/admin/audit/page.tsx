import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { listAuditEvents } from "@projectos/core";
import { hasOrgWide } from "@projectos/auth";
import { Badge, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { formatInstant } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";

export const metadata: Metadata = { title: "Audit Log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ outcome?: string; resourceType?: string; action?: string; page?: string }> }) {
  const ctx = await requireContext();
  if (!hasOrgWide(ctx, "audit.read")) return <Forbidden what="the audit log" />;
  const sp = await searchParams;
  const q = {
    outcome: ["ALLOW", "DENY", "ERROR"].includes(sp.outcome ?? "") ? sp.outcome : undefined,
    resourceType: sp.resourceType && /^[a-z_]{1,60}$/.test(sp.resourceType) ? sp.resourceType : undefined,
    action: sp.action && /^[a-z_.]{1,80}$/.test(sp.action) ? sp.action : undefined,
    page: sp.page,
  };
  const r = await load(listAuditEvents(getDb(), ctx, Object.fromEntries(Object.entries(q).filter(([, v]) => v))));
  const qs = (page: number) => {
    const p = new URLSearchParams(Object.entries({ ...q, page: String(page) }).filter(([, v]) => v) as [string, string][]);
    return `/admin/audit?${p}`;
  };
  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Append-only (enforced by a database trigger). Metadata holds IDs and field names only — never patient data. Viewing this page is itself audited only on denial."
      />
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2" aria-label="Filter audit events">
        <div>
          <label htmlFor="a-outcome" className="block text-xs font-medium text-slate-600">
            Outcome
          </label>
          <select id="a-outcome" name="outcome" defaultValue={q.outcome ?? ""} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
            <option value="">Any</option>
            <option value="ALLOW">Allowed</option>
            <option value="DENY">Denied</option>
            <option value="ERROR">Error</option>
          </select>
        </div>
        <div>
          <label htmlFor="a-rt" className="block text-xs font-medium text-slate-600">
            Resource type
          </label>
          <select id="a-rt" name="resourceType" defaultValue={q.resourceType ?? ""} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
            <option value="">Any</option>
            {["task", "project", "site", "department", "team", "membership", "role", "invite", "milestone", "recurring_task_definition", "audit_event", "job"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="a-action" className="block text-xs font-medium text-slate-600">
            Action
          </label>
          <input id="a-action" name="action" defaultValue={q.action} placeholder="e.g. task.status" className="h-9 w-40 rounded-md border border-slate-300 bg-white px-2 text-sm" />
        </div>
        <button
          type="submit"
          className="press sheen h-9 rounded-full bg-ink-900 px-4 text-sm font-medium text-white shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_8px_20px_-10px_rgb(43_51_105/0.55)] hover:bg-ink-800"
        >
          Apply
        </button>
        <Link href="/admin/audit" className="px-2 py-2 text-sm text-slate-600 hover:underline">
          Clear
        </Link>
      </form>
      {r.items.length === 0 ? (
        <EmptyState title="No audit events match" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)]">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  When
                </th>
                <th scope="col" className="px-3 py-2">
                  Actor
                </th>
                <th scope="col" className="px-3 py-2">
                  Action
                </th>
                <th scope="col" className="px-3 py-2">
                  Outcome
                </th>
                <th scope="col" className="px-3 py-2">
                  Resource
                </th>
                <th scope="col" className="px-3 py-2">
                  Metadata
                </th>
                <th scope="col" className="px-3 py-2">
                  Request
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.items.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{formatInstant(e.createdAt)}</td>
                  <td className="px-3 py-1.5">{e.actorType === "SYSTEM" ? <Badge>System</Badge> : (e.actorName ?? "Unknown")}</td>
                  <td className="px-3 py-1.5 font-mono text-[12px]">{e.action}</td>
                  <td className="px-3 py-1.5">
                    <Badge tone={e.outcome === "ALLOW" ? "green" : e.outcome === "DENY" ? "red" : "amber"}>{e.outcome}</Badge>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">
                    {e.resourceType}
                    {e.resourceId && <span className="block font-mono text-[11px] text-slate-500">{e.resourceId.slice(0, 8)}…</span>}
                  </td>
                  <td className="max-w-xs truncate px-3 py-1.5 font-mono text-[11.5px] text-slate-500" title={JSON.stringify(e.metadata)}>
                    {JSON.stringify(e.metadata)}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{e.requestId?.slice(0, 8) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label="Pagination" className="mt-3 flex gap-2 text-sm">
        {r.page > 1 && (
          <Link className="rounded border border-slate-300 bg-white px-2.5 py-1" href={qs(r.page - 1)}>
            ← Newer
          </Link>
        )}
        {r.hasMore && (
          <Link className="rounded border border-slate-300 bg-white px-2.5 py-1" href={qs(r.page + 1)}>
            Older →
          </Link>
        )}
      </nav>
    </div>
  );
}

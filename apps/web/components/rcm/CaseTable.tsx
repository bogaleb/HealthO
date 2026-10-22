"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, EmptyState, Select } from "@projectos/ui";
import { RCM_CASE_TYPE_LABEL, RCM_STATUS_LABEL, type RcmCaseStatus, type RcmCaseType } from "@projectos/shared";
import { apiFetch, errorMessage } from "@/lib/client";
import { reliableRefresh } from "@/lib/refresh";
import { PRIORITY_LABEL, PRIORITY_TONE, RCM_STATUS_TONE, formatDate, formatMoney } from "@/lib/format";

export interface CaseRow {
  id: string;
  ref: string;
  version: number;
  caseType: string;
  claimRef: string;
  queueName: string;
  payerName: string;
  planName: string | null;
  serviceDate: string;
  ageDays: number;
  ageBucket: string;
  amountCents: number;
  status: string;
  priority: string;
  ownerName: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  nextActionOverdue: boolean;
  credentialingCaseId: string | null;
  taskId: string | null;
}

type Batch = { id: string; caseCount: number; ownerName: string | null };

/**
 * Work-queue table. Supervisors (rcm.manage) get row checkboxes and an all-or-nothing bulk assign bar;
 * the result can be undone as a unit. Native checkboxes/selects keep it fully keyboard operable.
 */
export function CaseTable({
  rows,
  canBulk,
  members,
  lastBatch,
  today,
  showQueue = true,
}: {
  rows: CaseRow[];
  canBulk: boolean;
  members: { value: string; label: string }[];
  lastBatch: Batch | null;
  today: string;
  showQueue?: boolean;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Batch | null>(null);
  const banner = result ?? lastBatch;
  const allOnPage = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  async function assign() {
    setBusy(true);
    setErr(null);
    try {
      const versions = Object.fromEntries(rows.filter((r) => sel.has(r.id)).map((r) => [r.id, r.version]));
      const r = await apiFetch<{ batchId: string; assigned: number }>("/api/v1/rcm/bulk-assign", {
        method: "POST",
        body: { caseIds: [...sel], ownerUserId: owner || null, versions },
      });
      setResult({ id: r.batchId, caseCount: r.assigned, ownerName: members.find((m) => m.value === owner)?.label ?? "Unassigned" });
      setSel(new Set());
      reliableRefresh(router);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function undo(b: Batch) {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/v1/rcm/assignments/${b.id}/undo`, { method: "POST" });
      setResult(null);
      reliableRefresh(router);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {canBulk && banner && banner.caseCount > 0 && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900"
          data-testid="bulk-banner"
        >
          <span>
            Last bulk assignment: {banner.caseCount} case{banner.caseCount === 1 ? "" : "s"} → {banner.ownerName ?? "Unassigned"}.
          </span>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => undo(banner)}>
            Undo assignment
          </Button>
        </div>
      )}
      {canBulk && (
        <div className="mb-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-white px-3 py-2" aria-label="Bulk assign" role="group">
          <span className="text-sm text-slate-700" aria-live="polite">
            {sel.size} selected
          </span>
          <div>
            <label htmlFor="bulk-owner" className="block text-xs font-medium text-slate-600">
              Assign selected to
            </label>
            <Select id="bulk-owner" className="h-8 w-52 text-[13px]" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" onClick={assign} disabled={!sel.size} loading={busy}>
            Assign {sel.size || ""}
          </Button>
          {sel.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
              Clear selection
            </Button>
          )}
          <span className="text-xs text-slate-500">All-or-nothing: if any case can&apos;t be assigned, nothing changes.</span>
        </div>
      )}
      {err && (
        <p role="alert" className="mb-2 text-sm font-medium text-red-700">
          {err}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No cases match these filters" description="Clear a filter or pick another queue." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-[13px]" data-testid="rcm-case-table">
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                {canBulk && (
                  <th scope="col" className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all cases on this page"
                      checked={allOnPage}
                      onChange={() => setSel(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))}
                    />
                  </th>
                )}
                <th scope="col" className="px-3 py-2">
                  Case
                </th>
                <th scope="col" className="px-3 py-2">
                  Payer
                </th>
                <th scope="col" className="px-3 py-2">
                  Age
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Balance
                </th>
                <th scope="col" className="px-3 py-2">
                  Owner
                </th>
                <th scope="col" className="px-3 py-2">
                  Next action
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className={sel.has(r.id) ? "bg-teal-50/60" : undefined}>
                  {canBulk && (
                    <td className="px-3 py-2.5 align-top">
                      <input type="checkbox" aria-label={`Select ${r.ref}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                  )}
                  <td className="px-3 py-2.5 align-top">
                    <Link href={`/rcm/cases/${r.id}`} className="whitespace-nowrap font-medium text-teal-800 hover:underline">
                      {r.ref}
                    </Link>
                    <div className="whitespace-nowrap text-xs text-slate-500">
                      {RCM_CASE_TYPE_LABEL[r.caseType as RcmCaseType] ?? r.caseType} · {r.claimRef}
                    </div>
                    {showQueue && <div className="mt-0.5 text-[11.5px] text-slate-500">{r.queueName}</div>}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {r.payerName}
                    {r.planName && <div className="text-xs text-slate-500">{r.planName}</div>}
                  </td>
                  <td className="tabular px-3 py-2.5 align-top">
                    <Badge tone={r.ageDays > 90 ? "red" : r.ageDays > 60 ? "amber" : "neutral"}>{r.ageBucket} d</Badge>
                    <div className="text-xs text-slate-500">DOS {formatDate(r.serviceDate)}</div>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right align-top">{formatMoney(r.amountCents)}</td>
                  <td className="px-3 py-2.5 align-top">{r.ownerName ?? <span className="text-amber-800">Unassigned</span>}</td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="max-w-64 truncate" title={r.nextAction ?? undefined}>
                      {r.nextAction ?? "—"}
                    </div>
                    <div
                      className={`tabular text-xs ${r.nextActionOverdue ? "font-semibold text-red-700" : r.nextActionDue === today ? "font-semibold text-amber-800" : "text-slate-500"}`}
                    >
                      {r.nextActionDue ? `${r.nextActionOverdue ? "Overdue · " : r.nextActionDue === today ? "Due today · " : "Due "}${formatDate(r.nextActionDue)}` : "No date"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <Badge tone={RCM_STATUS_TONE[r.status]}>{RCM_STATUS_LABEL[r.status as RcmCaseStatus] ?? r.status}</Badge>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge>
                      {r.credentialingCaseId && <Badge tone="violet">Credentialing link</Badge>}
                      {r.taskId && <Badge tone="teal">Task</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

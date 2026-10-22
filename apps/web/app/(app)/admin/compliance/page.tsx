import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { hasAny } from "@projectos/auth";
import { getReadiness, listComplianceItems } from "@projectos/compliance";
import { Badge, Card, CardHeader, PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { formatInstant, humanize } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { ComplianceItemActions } from "@/components/compliance/ComplianceItemActions";

export const metadata: Metadata = { title: "PHI Readiness" };

const STATUS_TONE: Record<string, "neutral" | "amber" | "blue" | "red" | "green"> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "blue",
  EVIDENCE_SUBMITTED: "amber",
  BLOCKED: "red",
  APPROVED: "green",
};

export default async function CompliancePage() {
  const ctx = await requireContext();
  if (!hasAny(ctx, "compliance.manage") && !hasAny(ctx, "org.manage") && !hasAny(ctx, "audit.read")) return <Forbidden what="the PHI readiness checklist" />;
  const db = getDb();
  const [r, items] = await Promise.all([getReadiness(db, ctx), listComplianceItems(db, ctx)]);
  const canEdit = hasAny(ctx, "compliance.manage");
  const notApproved = r.verdict !== "ELIGIBLE FOR SPONSOR GO-LIVE DECISION";
  return (
    <div>
      <PageHeader
        eyebrow="Administration · Phase 7"
        title="PHI readiness"
        description="Evidence checklist for any real-patient use (blueprint §9.2, specs/GO_LIVE_CHECKLIST.md) plus automated technical checks. Tracking evidence here is not proof of compliance."
      />
      <div
        role="status"
        data-testid="readiness-verdict"
        className={`mb-5 rounded-lg border-2 px-4 py-3 ${notApproved ? "border-red-600 bg-red-50 text-red-950" : "border-amber-500 bg-amber-50 text-amber-950"}`}
      >
        <div className="text-lg font-bold tracking-tight">{r.verdict}</div>
        <p className="mt-1 text-[13px]">
          {r.counts.approved}/{r.counts.total} items independently approved · {r.counts.openCritical} critical item(s) open · {r.counts.checksFailing} technical check(s) failing.{" "}
          {r.note} The product is never described as “HIPAA compliant”.
        </p>
        <p className="mt-1 text-[12px] opacity-80">Computed {formatInstant(r.computedAt)}.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader
            title="Evidence checklist"
            description="Each item needs external evidence submitted by one person and approved by a different person (enforced in the database)."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]" data-testid="compliance-items">
              <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Item
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Owner
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Status / evidence
                  </th>
                  {canEdit && (
                    <th scope="col" className="px-3 py-2 text-right">
                      Action
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(({ item: i, submittedByName, approvedByName }) => (
                  <tr key={i.id} className="align-top">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-900">
                        {i.title} {i.critical && <span className="text-[11px] font-semibold text-red-700">CRITICAL</span>}
                      </div>
                      <div className="text-[12px] text-slate-500">{i.category}</div>
                      <p className="mt-0.5 max-w-xl text-[12.5px] text-slate-600">{i.requirement}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{i.ownerRole}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STATUS_TONE[i.status]}>{humanize(i.status)}</Badge>
                      {i.evidenceRef && <div className="mt-1 break-all text-[12px] text-slate-700">Evidence: {i.evidenceRef}</div>}
                      {submittedByName && <div className="text-[11.5px] text-slate-500">Submitted by {submittedByName}</div>}
                      {approvedByName && <div className="text-[11.5px] text-green-800">Approved by {approvedByName}</div>}
                      {i.notes && <div className="mt-1 max-w-sm text-[12px] text-slate-600">{i.notes}</div>}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2.5">
                        <ComplianceItemActions item={{ id: i.id, version: i.version, status: i.status, submittedBy: i.submittedBy, title: i.title }} selfId={ctx.userId} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Automated technical checks" description="Computed live from configuration and the database." />
            <ul className="divide-y divide-slate-100 text-[13px]" data-testid="technical-checks">
              {r.checks.map((c) => (
                <li key={c.key} className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={c.ok ? "green" : "red"}>{c.ok ? "PASS" : "FAIL"}</Badge>
                    <span className="font-medium">{c.label}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-slate-600">{c.detail}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Drills" description="pnpm ops:restore-drill · pnpm ops:rehearsal (append-only results)" />
            <ul className="divide-y divide-slate-100 text-[12.5px]">
              {r.drills.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                  <span>
                    <Badge tone={d.status === "PASS" ? "green" : "red"}>{d.status}</Badge> {humanize(d.kind)}
                  </span>
                  <span className="text-slate-600">{formatInstant(d.finishedAt.toISOString())}</span>
                </li>
              ))}
              {r.drills.length === 0 && <li className="px-4 py-3 text-slate-500">No drills recorded yet.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Documents (in the repository)" />
            <ul className="space-y-1 p-4 text-[12.5px] text-slate-700">
              <li>docs/compliance/READINESS_REPORT.md</li>
              <li>docs/compliance/DATA_FLOW.md</li>
              <li>docs/compliance/SECURITY_RISK_REGISTER.md</li>
              <li>docs/compliance/DOWNTIME_PLAN.md</li>
              <li>docs/compliance/BACKUP_RESTORE_RUNBOOK.md</li>
              <li>docs/compliance/INCIDENT_RESPONSE.md</li>
              <li>docs/compliance/CLINIC_DAY_REHEARSAL.md</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

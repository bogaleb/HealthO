import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { assignableMembers, getCaseDetail } from "@projectos/rcm";
import { listProjects } from "@projectos/core";
import { can, hasAny } from "@projectos/auth";
import {
  RCM_ACTION_LABEL,
  RCM_CASE_TYPE_LABEL,
  RCM_QUEUE_CATEGORY_LABEL,
  RCM_STATUS_LABEL,
  TASK_STATUS_LABEL,
  type RcmActionType,
  type RcmCaseStatus,
  type RcmCaseType,
  type RcmQueueCategory,
  type TaskStatus,
} from "@projectos/shared";
import { Badge, Card, CardHeader, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { CASE_STATUS_TONE, PRIORITY_LABEL, PRIORITY_TONE, RCM_STATUS_TONE, TASK_STATUS_TONE, formatDate, formatInstant, formatMoney, humanize } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { CaseActions } from "@/components/rcm/RcmForms";

export const metadata: Metadata = { title: "RCM Case" };

export default async function RcmCasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "rcm.read")) return <Forbidden what="revenue-cycle cases" />;
  const { id } = await params;
  const db = getDb();
  const d = await load(getCaseDetail(db, ctx, id));
  const c = d.case;
  const scope = { departmentId: c.departmentId, siteId: c.siteId };
  const [members, supervisors, projects] = await Promise.all([
    assignableMembers(db, ctx, scope),
    assignableMembers(db, ctx, scope, "rcm.manage"),
    hasAny(ctx, "projects.read") ? listProjects(db, ctx) : Promise.resolve([]),
  ]);
  const editableProjects = projects
    .filter((p) => can(ctx, "projects.edit", { siteId: p.siteId, departmentId: p.departmentId }))
    .map((p) => ({ value: p.id, label: `${p.key} — ${p.name}` }));
  const credDone = d.credentialingCase && ["COMPLETED", "CANCELLED"].includes(d.credentialingCase.status);

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link href="/rcm/queues" className="text-teal-800 hover:underline">
          Work queues
        </Link>
        <span className="text-slate-500"> / </span>
        <Link href={`/rcm/queues?queueId=${d.queue.id}`} className="text-teal-800 hover:underline">
          {d.queue.name}
        </Link>
      </nav>
      <PageHeader
        eyebrow="SYNTHETIC DEMO DATA — not a real claim"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.ref}
            <Badge tone={RCM_STATUS_TONE[c.status]}>{RCM_STATUS_LABEL[c.status as RcmCaseStatus]}</Badge>
            <Badge tone={PRIORITY_TONE[c.priority]}>{PRIORITY_LABEL[c.priority]}</Badge>
          </span>
        }
        description={`${RCM_CASE_TYPE_LABEL[c.caseType as RcmCaseType]} · ${c.claimRef} · ${d.payer.name}${d.plan ? ` · ${d.plan.name}` : ""}`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Work this case" description={d.ownerName ? `Owner: ${d.ownerName}` : "Unassigned"} />
            <div className="p-4">
              <CaseActions
                c={c}
                permissions={d.permissions}
                members={members.map((m) => ({ value: m.userId, label: m.displayName }))}
                supervisors={supervisors.map((m) => ({ value: m.userId, label: m.displayName }))}
                projects={editableProjects}
                selfId={ctx.userId}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Action timeline" description="Append-only. Every entry is also in the audit log." />
            <ol className="divide-y divide-slate-100" data-testid="rcm-timeline">
              {d.actions.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Badge tone={a.type === "ESCALATED" ? "red" : a.type === "ASSIGNED" ? "blue" : a.type === "STATUS_CHANGED" ? "violet" : "neutral"}>
                      {RCM_ACTION_LABEL[a.type as RcmActionType] ?? a.type}
                    </Badge>
                    <span className="font-medium text-slate-800">{a.actorName ?? "—"}</span>
                    <time className="tabular text-slate-500" dateTime={new Date(a.at).toISOString()}>
                      {formatInstant(a.at, d.timezone)}
                    </time>
                  </div>
                  {(a.fromStatus || a.toStatus) && a.type !== "CREATED" && (
                    <p className="mt-1 text-[13px] text-slate-600">
                      {a.fromStatus ? RCM_STATUS_LABEL[a.fromStatus as RcmCaseStatus] : "—"} → {a.toStatus ? RCM_STATUS_LABEL[a.toStatus as RcmCaseStatus] : "—"}
                    </p>
                  )}
                  {a.type === "ASSIGNED" && <p className="mt-1 text-[13px] text-slate-600">Owner → {a.toOwnerName ?? "Unassigned"}</p>}
                  {a.note && <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-slate-800">{a.note}</p>}
                  {a.nextAction && (
                    <p className="mt-1 text-[12.5px] text-slate-500">
                      Next: {a.nextAction}
                      {a.nextActionDue ? ` (due ${formatDate(a.nextActionDue)})` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-[13px]">
              <dt className="text-slate-500">Queue</dt>
              <dd>
                {d.queue.name}
                <div className="text-xs text-slate-500">{RCM_QUEUE_CATEGORY_LABEL[d.queue.category as RcmQueueCategory]}</div>
              </dd>
              <dt className="text-slate-500">Date of service</dt>
              <dd className="tabular">
                {formatDate(c.serviceDate)} · <Badge tone={c.ageDays > 90 ? "red" : c.ageDays > 60 ? "amber" : "neutral"}>{c.ageDays} days</Badge>
              </dd>
              <dt className="text-slate-500">Age category</dt>
              <dd>{c.ageBucket} days</dd>
              <dt className="text-slate-500">Balance</dt>
              <dd className="tabular">{formatMoney(c.amountCents)}</dd>
              <dt className="text-slate-500">Reason code</dt>
              <dd>{c.denialCode ?? "—"}</dd>
              <dt className="text-slate-500">Site</dt>
              <dd>{d.site?.name ?? "—"}</dd>
              <dt className="text-slate-500">Next action</dt>
              <dd>
                {c.nextAction ?? "—"}
                <div className={`tabular text-xs ${c.nextActionOverdue ? "font-semibold text-red-700" : "text-slate-500"}`}>
                  {c.nextActionDue ? `${c.nextActionOverdue ? "Overdue — " : "Due "}${formatDate(c.nextActionDue)}` : "No date"}
                </div>
              </dd>
              <dt className="text-slate-500">Last action</dt>
              <dd className="tabular">{formatInstant(c.lastActionAt, d.timezone)}</dd>
              {c.resolvedAt && (
                <>
                  <dt className="text-slate-500">Closed</dt>
                  <dd>
                    {formatInstant(c.resolvedAt, d.timezone)}
                    {c.resolutionNote && <div className="text-xs text-slate-600">{c.resolutionNote}</div>}
                  </dd>
                </>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Linked work" description="Links, not copies — each record stays in its own module." />
            <div className="space-y-3 p-4 text-[13px]">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Project task</div>
                {d.task ? (
                  hasAny(ctx, "projects.read") ? (
                    <Link href={`/projects/${d.task.projectId}/list?task=${d.task.id}`} className="mt-1 inline-flex items-center gap-2 hover:underline">
                      <Badge tone={TASK_STATUS_TONE[d.task.status]}>{TASK_STATUS_LABEL[d.task.status as TaskStatus]}</Badge>
                      {d.task.projectKey}-{d.task.number} {d.task.title}
                    </Link>
                  ) : (
                    <p className="mt-1">
                      {d.task.projectKey}-{d.task.number} ({TASK_STATUS_LABEL[d.task.status as TaskStatus]})
                    </p>
                  )
                ) : (
                  <p className="mt-1 text-slate-500">None</p>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Credentialing blocker</div>
                {d.credentialingCase ? (
                  <div className="mt-1" data-testid="credentialing-link">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={CASE_STATUS_TONE[d.credentialingCase.status]}>{humanize(d.credentialingCase.status)}</Badge>
                      {hasAny(ctx, "credentialing.read") ? (
                        <Link className="hover:underline" href="/credentialing/cases">
                          {d.credentialingCase.title}
                        </Link>
                      ) : (
                        <span>{d.credentialingCase.title}</span>
                      )}
                    </div>
                    {d.practitioner && (
                      <p className="mt-1 text-slate-600">
                        Provider:{" "}
                        {d.practitioner.canOpen ? (
                          <Link className="hover:underline" href={`/providers/${d.practitioner.id}`}>
                            {d.practitioner.name}
                          </Link>
                        ) : (
                          d.practitioner.name
                        )}
                      </p>
                    )}
                    <p className={`mt-1 text-xs ${credDone ? "font-semibold text-green-800" : "text-amber-800"}`}>
                      {credDone
                        ? "Credentialing case is closed — claims can be rebilled once enrollment is verified."
                        : `Still open${d.credentialingCase.dueDate ? `, due ${formatDate(d.credentialingCase.dueDate)}` : ""}. ${d.credentialingCase.nextAction ?? ""}`}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-slate-500">None</p>
                )}
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Select } from "@projectos/ui";
import { RCM_CASE_TYPES, RCM_CASE_TYPE_LABEL, RCM_FOLLOW_UP_TYPES, RCM_ACTION_LABEL, RCM_QUEUE_CATEGORIES, RCM_QUEUE_CATEGORY_LABEL, TASK_PRIORITIES } from "@projectos/shared";
import { apiFetch, errorMessage } from "@/lib/client";
import { reliableRefresh } from "@/lib/refresh";
import { FormDialog, orNull } from "@/components/FormDialog";

type Opt = { value: string; label: string };
const prio = TASK_PRIORITIES.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }));

export function NewQueueButton({ departments, members }: { departments: { id: string; name: string }[]; members: Opt[] }) {
  if (!departments.length) return null;
  return (
    <FormDialog
      title="New work queue"
      description="Queues decide visibility: staff with RCM access to the queue's department see its cases."
      submitLabel="Create queue"
      trigger={(open) => (
        <Button variant="secondary" onClick={open}>
          New queue
        </Button>
      )}
      fields={[
        { name: "name", label: "Name", type: "text", required: true, maxLength: 120 },
        {
          name: "category",
          label: "Category",
          type: "select",
          required: true,
          options: RCM_QUEUE_CATEGORIES.map((c) => ({ value: c, label: RCM_QUEUE_CATEGORY_LABEL[c] })),
          defaultValue: RCM_QUEUE_CATEGORIES[0],
        },
        {
          name: "departmentId",
          label: "Department",
          type: "select",
          required: true,
          options: departments.map((d) => ({ value: d.id, label: d.name })),
          defaultValue: departments[0]!.id,
        },
        { name: "leadUserId", label: "Queue lead", type: "select", options: members, allowEmpty: "None", hint: "Receives escalations and overdue reminders for unassigned cases." },
        { name: "followUpDays", label: "Default follow-up (days)", type: "number", defaultValue: "14", hint: "Next-action date used when none is given." },
        { name: "description", label: "Description", type: "textarea" },
      ]}
      onSubmit={(v) =>
        apiFetch("/api/v1/rcm/queues", {
          method: "POST",
          body: {
            name: v.name,
            category: v.category,
            departmentId: v.departmentId,
            leadUserId: orNull(v.leadUserId),
            followUpDays: v.followUpDays,
            description: orNull(v.description),
          },
        })
      }
    />
  );
}

export function NewCaseButton({
  queues,
  payers,
  plans,
  sites,
  credentialingCases,
  members,
  canAssignOthers,
  selfId,
  defaultQueueId,
}: {
  queues: { id: string; name: string }[];
  payers: { id: string; name: string }[];
  plans: { id: string; payerId: string; name: string }[];
  sites: { id: string; name: string }[];
  credentialingCases: { id: string; title: string; provider: string }[];
  members: Opt[];
  canAssignOthers: boolean;
  selfId: string;
  defaultQueueId?: string;
}) {
  const payerName = new Map(payers.map((p) => [p.id, p.name]));
  const owners = canAssignOthers ? members : members.filter((m) => m.value === selfId);
  return (
    <FormDialog
      title="New RCM case"
      description="SYNTHETIC references only (SYN-…). No patient names, member IDs or real claim numbers."
      submitLabel="Create case"
      trigger={(open) => <Button onClick={open}>New case</Button>}
      fields={[
        {
          name: "queueId",
          label: "Queue",
          type: "select",
          required: true,
          options: queues.map((q) => ({ value: q.id, label: q.name })),
          defaultValue: defaultQueueId ?? queues[0]?.id,
        },
        {
          name: "caseType",
          label: "Case type",
          type: "select",
          required: true,
          options: RCM_CASE_TYPES.map((t) => ({ value: t, label: RCM_CASE_TYPE_LABEL[t] })),
          defaultValue: "DENIAL",
        },
        { name: "claimRef", label: "Synthetic claim reference", type: "text", required: true, placeholder: "SYN-CLM-20001", maxLength: 34 },
        { name: "payerId", label: "Payer", type: "select", required: true, options: payers.map((p) => ({ value: p.id, label: p.name })), defaultValue: payers[0]?.id },
        {
          name: "payerPlanId",
          label: "Plan",
          type: "select",
          options: plans.map((p) => ({ value: p.id, label: `${payerName.get(p.payerId) ?? ""} · ${p.name}` })),
          allowEmpty: "Not specified",
        },
        { name: "siteId", label: "Site", type: "select", options: sites.map((s) => ({ value: s.id, label: s.name })), allowEmpty: "Not specified" },
        { name: "serviceDate", label: "Date of service", type: "date", required: true, hint: "Drives the age category." },
        { name: "amount", label: "Balance (USD)", type: "number", required: true, defaultValue: "0" },
        { name: "denialCode", label: "Reason code", type: "text", placeholder: "CO-16", maxLength: 12 },
        { name: "priority", label: "Priority", type: "select", options: prio, defaultValue: "MEDIUM" },
        { name: "ownerUserId", label: "Owner", type: "select", options: owners, allowEmpty: "Unassigned" },
        { name: "nextActionDue", label: "Next action due", type: "date", hint: "Blank = queue default." },
        { name: "nextAction", label: "Next action", type: "text", maxLength: 200 },
        {
          name: "credentialingCaseId",
          label: "Linked credentialing case",
          type: "select",
          options: credentialingCases.map((c) => ({ value: c.id, label: `${c.title} — ${c.provider}` })),
          allowEmpty: "None",
          hint: "For enrollment/licensure blockers: links the existing case (no copy).",
        },
      ]}
      onSubmit={(v) =>
        apiFetch("/api/v1/rcm/cases", {
          method: "POST",
          body: {
            queueId: v.queueId,
            caseType: v.caseType,
            claimRef: v.claimRef,
            payerId: v.payerId,
            payerPlanId: orNull(v.payerPlanId),
            siteId: orNull(v.siteId),
            serviceDate: v.serviceDate,
            amountCents: Math.round(Number(v.amount || 0) * 100),
            denialCode: orNull(v.denialCode),
            priority: v.priority,
            ownerUserId: orNull(v.ownerUserId),
            nextAction: orNull(v.nextAction),
            nextActionDue: orNull(v.nextActionDue),
            credentialingCaseId: orNull(v.credentialingCaseId),
          },
        })
      }
    />
  );
}

type CaseLite = {
  id: string;
  version: number;
  status: string;
  priority: string;
  nextAction: string | null;
  nextActionDue: string | null;
  ownerUserId: string | null;
  taskId: string | null;
  open: boolean;
};

/** Every action on the case page. Buttons render only when the server says the user may perform them. */
export function CaseActions({
  c,
  permissions,
  members,
  supervisors,
  projects,
  selfId,
}: {
  c: CaseLite;
  permissions: { canWork: boolean; canManage: boolean; canClaim: boolean };
  members: Opt[];
  supervisors: Opt[];
  projects: Opt[];
  selfId: string;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      reliableRefresh(router);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const assign = (ownerUserId: string | null) => run(() => apiFetch(`/api/v1/rcm/cases/${c.id}/assign`, { method: "POST", body: { version: c.version, ownerUserId } }));
  const [assignee, setAssignee] = useState(c.ownerUserId ?? "");

  return (
    <div className="space-y-3" data-testid="case-actions">
      <div className="flex flex-wrap gap-2">
        {permissions.canClaim && (
          <Button onClick={() => assign(selfId)} loading={busy}>
            Claim case
          </Button>
        )}
        {permissions.canWork && c.open && (
          <FormDialog
            title="Record follow-up"
            description="Adds an entry to the action timeline. Setting a next action also sets its due date (queue default if blank)."
            submitLabel="Record"
            trigger={(open) => <Button onClick={open}>Record follow-up</Button>}
            fields={[
              {
                name: "type",
                label: "Type",
                type: "select",
                required: true,
                options: RCM_FOLLOW_UP_TYPES.map((t) => ({ value: t, label: RCM_ACTION_LABEL[t] })),
                defaultValue: "PAYER_CALL",
              },
              {
                name: "status",
                label: "Status after",
                type: "select",
                options: [
                  { value: "IN_PROGRESS", label: "In progress" },
                  { value: "WAITING_PAYER", label: "Waiting on payer" },
                ],
                allowEmpty: "Keep current",
              },
              { name: "note", label: "What happened", type: "textarea", required: true, hint: "No patient identifiers. Synthetic demo only." },
              { name: "nextAction", label: "Next action", type: "text", maxLength: 200, defaultValue: c.nextAction ?? "" },
              { name: "nextActionDue", label: "Next action due", type: "date" },
            ]}
            onSubmit={(v) =>
              apiFetch(`/api/v1/rcm/cases/${c.id}/actions`, {
                method: "POST",
                body: { type: v.type, note: v.note, status: orNull(v.status) ?? undefined, nextAction: orNull(v.nextAction), nextActionDue: orNull(v.nextActionDue) ?? undefined },
              })
            }
          />
        )}
        {permissions.canWork && c.open && (
          <FormDialog
            title="Edit next action & priority"
            submitLabel="Save"
            trigger={(open) => (
              <Button variant="secondary" onClick={open}>
                Edit next action
              </Button>
            )}
            fields={[
              { name: "nextAction", label: "Next action", type: "text", maxLength: 200, defaultValue: c.nextAction ?? "" },
              { name: "nextActionDue", label: "Due", type: "date", defaultValue: c.nextActionDue ?? "" },
              { name: "priority", label: "Priority", type: "select", options: prio, defaultValue: c.priority },
              {
                name: "status",
                label: "Status",
                type: "select",
                options: [
                  { value: "OPEN", label: "Open" },
                  { value: "IN_PROGRESS", label: "In progress" },
                  { value: "WAITING_PAYER", label: "Waiting on payer" },
                ],
                allowEmpty: "Keep current",
              },
            ]}
            onSubmit={(v) =>
              apiFetch(`/api/v1/rcm/cases/${c.id}`, {
                method: "PATCH",
                body: {
                  version: c.version,
                  nextAction: orNull(v.nextAction),
                  nextActionDue: orNull(v.nextActionDue),
                  priority: v.priority,
                  ...(v.status ? { status: v.status } : {}),
                },
              })
            }
          />
        )}
        {permissions.canWork && c.open && (
          <FormDialog
            title="Escalate case"
            description="Marks the case Escalated, raises priority to at least High and notifies the supervisor (in-app)."
            submitLabel="Escalate"
            danger
            trigger={(open) => (
              <Button variant="secondary" onClick={open}>
                Escalate
              </Button>
            )}
            fields={[
              { name: "reason", label: "Reason", type: "textarea", required: true },
              { name: "escalateToUserId", label: "Escalate to", type: "select", options: supervisors, allowEmpty: "Queue lead" },
            ]}
            onSubmit={(v) =>
              apiFetch(`/api/v1/rcm/cases/${c.id}/escalate`, { method: "POST", body: { version: c.version, reason: v.reason, escalateToUserId: orNull(v.escalateToUserId) } })
            }
          />
        )}
        {permissions.canWork && c.open && (
          <FormDialog
            title="Resolve or close"
            description="Resolving also completes the linked project task, if any."
            submitLabel="Close case"
            trigger={(open) => (
              <Button variant="secondary" onClick={open}>
                Resolve / close
              </Button>
            )}
            fields={[
              {
                name: "status",
                label: "Outcome",
                type: "select",
                required: true,
                options: [
                  { value: "RESOLVED", label: "Resolved" },
                  { value: "CLOSED_NO_ACTION", label: "Closed — no action" },
                ],
                defaultValue: "RESOLVED",
              },
              { name: "resolutionNote", label: "Resolution note", type: "textarea", required: true },
            ]}
            onSubmit={(v) => apiFetch(`/api/v1/rcm/cases/${c.id}`, { method: "PATCH", body: { version: c.version, status: v.status, resolutionNote: v.resolutionNote } })}
          />
        )}
        {permissions.canWork && !c.open && (
          <Button
            variant="secondary"
            loading={busy}
            onClick={() => run(() => apiFetch(`/api/v1/rcm/cases/${c.id}`, { method: "PATCH", body: { version: c.version, status: "IN_PROGRESS" } }))}
          >
            Reopen
          </Button>
        )}
        {permissions.canWork && !c.taskId && projects.length > 0 && (
          <FormDialog
            title="Create linked project task"
            description="Tracks this case on a project board. The task is completed automatically when the case is resolved."
            submitLabel="Create task"
            trigger={(open) => (
              <Button variant="secondary" onClick={open}>
                Link project task
              </Button>
            )}
            fields={[{ name: "projectId", label: "Project", type: "select", required: true, options: projects, defaultValue: projects[0]!.value }]}
            onSubmit={(v) => apiFetch(`/api/v1/rcm/cases/${c.id}/link-task`, { method: "POST", body: { projectId: v.projectId } })}
          />
        )}
      </div>

      {c.open && (permissions.canManage || c.ownerUserId === selfId) && (
        <form
          className="flex flex-wrap items-end gap-2"
          aria-label="Assign case"
          onSubmit={(e) => {
            e.preventDefault();
            void assign(assignee || null);
          }}
        >
          <div>
            <label htmlFor="assign-owner" className="block text-xs font-medium text-slate-600">
              Owner
            </label>
            <Select id="assign-owner" className="h-9 w-56" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {(permissions.canManage ? members : members.filter((m) => m.value === selfId)).map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" loading={busy} disabled={(assignee || null) === c.ownerUserId}>
            {permissions.canManage ? "Assign" : "Release"}
          </Button>
        </form>
      )}
      {!permissions.canWork && !permissions.canClaim && <p className="text-sm text-slate-600">Read-only: this case is assigned to someone else. A supervisor can reassign it.</p>}
      {err && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {err}
        </p>
      )}
    </div>
  );
}

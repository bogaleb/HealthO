"use client";
import { Button } from "@projectos/ui";
import { apiFetch } from "@/lib/client";
import { FormDialog, orNull } from "@/components/FormDialog";

/** Evidence workflow for one checklist item. Approval is offered only to someone other than the submitter. */
export function ComplianceItemActions({ item, selfId }: { item: { id: string; version: number; status: string; submittedBy: string | null; title: string }; selfId: string }) {
  const patch = (body: Record<string, unknown>) => apiFetch(`/api/v1/compliance/items/${item.id}`, { method: "PATCH", body: { version: item.version, ...body } });
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {item.status !== "APPROVED" && (
        <FormDialog
          title={`Update: ${item.title}`}
          submitLabel="Save"
          trigger={(open) => (
            <Button size="sm" variant="ghost" onClick={open}>
              Status
            </Button>
          )}
          fields={[
            {
              name: "status",
              label: "Status",
              type: "select",
              options: [
                { value: "NOT_STARTED", label: "Not started" },
                { value: "IN_PROGRESS", label: "In progress" },
                { value: "BLOCKED", label: "Blocked" },
              ],
              defaultValue: ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"].includes(item.status) ? item.status : "IN_PROGRESS",
            },
            { name: "notes", label: "Notes", type: "textarea" },
          ]}
          onSubmit={(v) => patch({ action: "UPDATE", status: v.status, notes: orNull(v.notes) })}
        />
      )}
      {item.status !== "APPROVED" && (
        <FormDialog
          title={`Submit evidence: ${item.title}`}
          description="Record WHERE the evidence lives (document system path, ticket, contract id). Do not paste PHI. A different person must approve it."
          submitLabel="Submit evidence"
          trigger={(open) => (
            <Button size="sm" variant="secondary" onClick={open}>
              Submit evidence
            </Button>
          )}
          fields={[
            { name: "evidenceRef", label: "Evidence location", type: "text", required: true, maxLength: 500 },
            { name: "notes", label: "Notes", type: "textarea" },
          ]}
          onSubmit={(v) => patch({ action: "SUBMIT_EVIDENCE", evidenceRef: v.evidenceRef, notes: orNull(v.notes) })}
        />
      )}
      {item.status === "EVIDENCE_SUBMITTED" && item.submittedBy !== selfId && (
        <FormDialog
          title={`Approve: ${item.title}`}
          description="You confirm you reviewed the external evidence yourself. This does not make the product compliant; it records your review."
          submitLabel="Approve"
          trigger={(open) => (
            <Button size="sm" onClick={open}>
              Approve
            </Button>
          )}
          fields={[{ name: "notes", label: "Reviewer notes", type: "textarea" }]}
          onSubmit={(v) => patch({ action: "APPROVE", notes: orNull(v.notes) })}
        />
      )}
      {item.status === "EVIDENCE_SUBMITTED" && item.submittedBy === selfId && <span className="self-center text-xs text-slate-500">Awaiting another reviewer</span>}
      {item.status === "APPROVED" && (
        <FormDialog
          title={`Reopen: ${item.title}`}
          submitLabel="Reopen"
          danger
          trigger={(open) => (
            <Button size="sm" variant="ghost" onClick={open}>
              Reopen
            </Button>
          )}
          fields={[{ name: "notes", label: "Reason", type: "textarea", required: true }]}
          onSubmit={(v) => patch({ action: "REOPEN", notes: v.notes })}
        />
      )}
    </div>
  );
}

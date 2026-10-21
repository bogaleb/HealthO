"use client";
import { useState } from "react";
import { reliableRefresh } from "@/lib/refresh";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Dialog, ErrorState, Field, Input, Select, Textarea } from "@projectos/ui";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from "@projectos/shared";
import { ApiError, apiFetch, errorMessage } from "@/lib/client";
import { PRIORITY_LABEL } from "@/lib/format";

export function NewTaskButton({
  projectId,
  members,
  milestones = [],
  defaultStatus = "TODO",
  label = "New task",
  variant = "primary",
}: {
  projectId: string;
  members: { userId: string; displayName: string }[];
  milestones?: { id: string; name: string }[];
  defaultStatus?: TaskStatus;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const blank = { title: "", description: "", status: defaultStatus as string, priority: "MEDIUM", ownerUserId: "", dueDate: "", milestoneId: "", labels: "" };
  const [f, setF] = useState(blank);
  // One key per dialog session: a double-submit or network retry never creates a duplicate task.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch("/api/v1/tasks", {
        method: "POST",
        headers: { "idempotency-key": idemKey },
        body: {
          projectId,
          title: f.title,
          description: f.description || null,
          status: f.status,
          priority: f.priority,
          ownerUserId: f.ownerUserId || null,
          dueDate: f.dueDate || null,
          milestoneId: f.milestoneId || null,
          labels: f.labels
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean),
        },
      });
      setOpen(false);
      setF(blank);
      setIdemKey(crypto.randomUUID());
      reliableRefresh(router);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors());
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={variant === "ghost" ? "sm" : "md"} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New task"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-task-form" loading={busy} disabled={!f.title.trim()}>
              Create task
            </Button>
          </>
        }
      >
        <form method="post" id="new-task-form" onSubmit={submit} className="space-y-3">
          {error && <ErrorState title="Task not created" message={error} />}
          <Field label="Title" htmlFor="nt-title" error={fieldErrors.title}>
            <Input id="nt-title" autoFocus required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status" htmlFor="nt-status">
              <Select id="nt-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {TASK_STATUSES.filter((s) => s !== "CANCELLED").map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="nt-priority">
              <Select id="nt-priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Accountable owner" htmlFor="nt-owner" error={fieldErrors.ownerUserId}>
              <Select id="nt-owner" value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value })}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due date" htmlFor="nt-due" error={fieldErrors.dueDate}>
              <Input id="nt-due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
            </Field>
            {milestones.length > 0 && (
              <Field label="Milestone" htmlFor="nt-ms">
                <Select id="nt-ms" value={f.milestoneId} onChange={(e) => setF({ ...f, milestoneId: e.target.value })}>
                  <option value="">None</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Labels" htmlFor="nt-labels" hint="Comma-separated">
              <Input id="nt-labels" value={f.labels} onChange={(e) => setF({ ...f, labels: e.target.value })} />
            </Field>
          </div>
          <Field label="Description" htmlFor="nt-desc" hint="Operational notes only — no patient information.">
            <Textarea id="nt-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

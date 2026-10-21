"use client";
import { useCallback, useEffect, useState } from "react";
import { Link2, Lock, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Dialog, ErrorState, Field, Input, Select, Spinner, Textarea } from "@projectos/ui";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from "@projectos/shared";
import { ApiError, apiFetch, errorMessage } from "@/lib/client";
import { PRIORITY_LABEL, TASK_STATUS_TONE, formatDate, formatInstant } from "@/lib/format";

interface Member {
  userId: string;
  displayName: string;
}
interface DepRow {
  dependencyId: string;
  kind: string;
  id: string;
  number: number;
  title: string;
  status: string;
  projectKey: string;
}
interface Detail {
  task: {
    id: string;
    projectId: string;
    number: number;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: string;
    ownerUserId: string | null;
    dueDate: string | null;
    dueTimezone: string;
    labels: string[];
    version: number;
    depth: number;
    createdAt: string;
    completedAt: string | null;
  };
  project: { id: string; key: string; name: string };
  canEdit: boolean;
  isBlocked: boolean;
  collaborators: Member[];
  checklist: { id: string; text: string; done: boolean }[];
  comments: { id: string; body: string; createdAt: string; authorName: string | null }[];
  events: { id: string; type: string; fromValue: string | null; toValue: string | null; createdAt: string; actorName: string | null }[];
  blockedBy: DepRow[];
  blocking: DepRow[];
  subtasks: { id: string; number: number; title: string; status: string }[];
}

const EVENT_LABEL: Record<string, string> = {
  CREATED: "created the task",
  STATUS_CHANGED: "changed status",
  OWNER_CHANGED: "changed the owner",
  PRIORITY_CHANGED: "changed priority",
  DUE_CHANGED: "changed the due date",
  EDITED: "edited",
  COMMENTED: "commented",
  CHECKLIST_ADDED: "added a checklist item",
  CHECKLIST_DONE: "completed a checklist item",
  CHECKLIST_REOPENED: "reopened a checklist item",
  DEPENDENCY_ADDED: "added a dependency",
  DEPENDENCY_REMOVED: "removed a dependency",
  DELETED: "deleted the task",
};

function DependencyPicker({ taskId, onAdd }: { taskId: string; onAdd: (id: string, kind: "BLOCKS" | "RELATED") => Promise<void> }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"BLOCKS" | "RELATED">("BLOCKS");
  const [results, setResults] = useState<{ id: string; number: number; title: string; projectKey: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => {
      apiFetch<typeof results>(`/api/v1/tasks/search?q=${encodeURIComponent(q)}&exclude=${taskId}`)
        .then(setResults)
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, taskId]);
  return (
    <div className="mt-2 rounded-md border border-slate-200 p-2">
      <div className="flex gap-2">
        <Select aria-label="Dependency type" value={kind} onChange={(e) => setKind(e.target.value as "BLOCKS" | "RELATED")} className="w-40">
          <option value="BLOCKS">Is blocked by</option>
          <option value="RELATED">Is related to</option>
        </Select>
        <Input aria-label="Search tasks by title or number" placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {results.length > 0 && (
        <ul aria-label="Matching tasks" className="mt-1 max-h-40 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full truncate rounded px-2 py-1 text-left text-[13px] hover:bg-slate-100"
                onClick={async () => {
                  await onAdd(r.id, kind);
                  setQ("");
                }}
              >
                <span className="font-mono text-[12px] text-slate-500">
                  {r.projectKey}-{r.number}
                </span>{" "}
                {r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TaskDrawer({
  taskId,
  members,
  onClose,
  onChanged,
  onOpenTask,
}: {
  taskId: string | null;
  members: Member[];
  onClose: () => void;
  onChanged: () => void;
  onOpenTask: (id: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", priority: "MEDIUM", ownerUserId: "", dueDate: "", labels: "", collaboratorUserIds: [] as string[] });
  const [comment, setComment] = useState("");
  const [checkText, setCheckText] = useState("");
  const [subTitle, setSubTitle] = useState("");
  const [showDepPicker, setShowDepPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoadError(null);
    try {
      const d = await apiFetch<Detail>(`/api/v1/tasks/${taskId}`);
      setDetail(d);
      setConflict(false);
      setForm({
        title: d.task.title,
        description: d.task.description ?? "",
        priority: d.task.priority,
        ownerUserId: d.task.ownerUserId ?? "",
        dueDate: d.task.dueDate ?? "",
        labels: d.task.labels.join(", "),
        collaboratorUserIds: d.collaborators.map((c) => c.userId),
      });
    } catch (e) {
      setLoadError(e instanceof ApiError && e.status === 404 ? "This task no longer exists or you no longer have access." : errorMessage(e));
    }
  }, [taskId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setShowDepPicker(false);
    if (taskId) void load();
  }, [taskId, load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") setConflict(true);
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const t = detail?.task;
  const canEdit = !!detail?.canEdit;
  const dirty =
    !!t &&
    (form.title !== t.title ||
      form.description !== (t.description ?? "") ||
      form.priority !== t.priority ||
      form.ownerUserId !== (t.ownerUserId ?? "") ||
      form.dueDate !== (t.dueDate ?? "") ||
      form.labels !== t.labels.join(", ") ||
      form.collaboratorUserIds.slice().sort().join() !==
        detail!.collaborators
          .map((c) => c.userId)
          .sort()
          .join());

  return (
    <>
      <Dialog
        open={!!taskId}
        onClose={() => {
          if (dirty && !window.confirm("Discard unsaved changes?")) return;
          onClose();
        }}
        side
        title={t ? `${detail!.project.key}-${t.number}` : "Task"}
        description={detail ? detail.project.name : undefined}
      >
        {loadError && <ErrorState title="Couldn’t load task" message={loadError} />}
        {!detail && !loadError && <Spinner label="Loading task" />}
        {detail && t && (
          <div className="space-y-6">
            {conflict && (
              <ErrorState
                title="Someone else changed this task"
                message="Your view is out of date. Reload to see the latest version, then re-apply your change."
                action={
                  <Button size="sm" variant="secondary" onClick={() => void load()}>
                    Reload task
                  </Button>
                }
              />
            )}
            {error && !conflict && <ErrorState title="Change not saved" message={error} />}
            {detail.isBlocked && (
              <p className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                <Lock className="h-4 w-4" aria-hidden /> Blocked by unfinished dependencies — it can’t be marked Done until they are.
              </p>
            )}

            <section aria-label="Status" className="flex flex-wrap items-end gap-3">
              <Field label="Status" htmlFor="task-status" className="w-48">
                <Select
                  id="task-status"
                  value={t.status}
                  disabled={!canEdit || !!busy}
                  onChange={(e) => run("status", () => apiFetch(`/api/v1/tasks/${t.id}/move`, { method: "POST", body: { status: e.target.value, version: t.version } }))}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {TASK_STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
              {t.completedAt && <span className="text-xs text-slate-500">Completed {formatInstant(t.completedAt, t.dueTimezone)}</span>}
            </section>

            <form
              method="post"
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run("save", () =>
                  apiFetch(`/api/v1/tasks/${t.id}`, {
                    method: "PATCH",
                    body: {
                      title: form.title,
                      description: form.description || null,
                      priority: form.priority,
                      ownerUserId: form.ownerUserId || null,
                      dueDate: form.dueDate || null,
                      labels: form.labels
                        .split(",")
                        .map((l) => l.trim())
                        .filter(Boolean),
                      collaboratorUserIds: form.collaboratorUserIds,
                      version: t.version,
                    },
                  }),
                );
              }}
            >
              <Field label="Title" htmlFor="task-title">
                <Input id="task-title" value={form.title} disabled={!canEdit} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Accountable owner" htmlFor="task-owner">
                  <Select id="task-owner" value={form.ownerUserId} disabled={!canEdit} onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}>
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority" htmlFor="task-priority">
                  <Select id="task-priority" value={form.priority} disabled={!canEdit} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                    {TASK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={`Due date (${t.dueTimezone})`} htmlFor="task-due">
                  <Input id="task-due" type="date" value={form.dueDate} disabled={!canEdit} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                </Field>
                <Field label="Labels" htmlFor="task-labels" hint="Comma-separated">
                  <Input id="task-labels" value={form.labels} disabled={!canEdit} onChange={(e) => setForm({ ...form, labels: e.target.value })} />
                </Field>
              </div>
              <fieldset>
                <legend className="text-[13px] font-medium text-slate-700">Collaborators</legend>
                <div className="mt-1 flex max-h-28 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
                  {members
                    .filter((m) => m.userId !== form.ownerUserId)
                    .map((m) => (
                      <label key={m.userId} className="flex items-center gap-1.5 text-[13px]">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={form.collaboratorUserIds.includes(m.userId)}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              collaboratorUserIds: e.target.checked ? [...form.collaboratorUserIds, m.userId] : form.collaboratorUserIds.filter((x) => x !== m.userId),
                            })
                          }
                        />
                        {m.displayName}
                      </label>
                    ))}
                </div>
              </fieldset>
              <Field label="Description" htmlFor="task-desc" hint="Operational notes only — no patient information.">
                <Textarea id="task-desc" rows={4} value={form.description} disabled={!canEdit} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              {canEdit && (
                <div className="flex justify-between">
                  <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete task
                  </Button>
                  <Button type="submit" size="sm" disabled={!dirty || !form.title.trim()} loading={busy === "save"}>
                    Save changes
                  </Button>
                </div>
              )}
            </form>

            <section aria-labelledby="h-checklist">
              <h3 id="h-checklist" className="text-sm font-semibold">
                Checklist ({detail.checklist.filter((c) => c.done).length}/{detail.checklist.length})
              </h3>
              <ul className="mt-2 space-y-1">
                {detail.checklist.map((c) => (
                  <li key={c.id} className="group flex items-center gap-2 text-[13.5px]">
                    <input
                      id={`chk-${c.id}`}
                      type="checkbox"
                      checked={c.done}
                      disabled={!canEdit}
                      onChange={(e) => run("check", () => apiFetch(`/api/v1/tasks/${t.id}/checklist/${c.id}`, { method: "PATCH", body: { done: e.target.checked } }))}
                    />
                    <label htmlFor={`chk-${c.id}`} className={c.done ? "text-slate-500 line-through" : ""}>
                      {c.text}
                    </label>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Remove checklist item ${c.text}`}
                        className="ml-auto rounded p-0.5 text-slate-400 hover:text-red-700"
                        onClick={() => run("check", () => apiFetch(`/api/v1/tasks/${t.id}/checklist/${c.id}`, { method: "DELETE" }))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <form
                  method="post"
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!checkText.trim()) return;
                    void run("check", async () => {
                      await apiFetch(`/api/v1/tasks/${t.id}/checklist`, { method: "POST", body: { text: checkText } });
                      setCheckText("");
                    });
                  }}
                >
                  <Input aria-label="New checklist item" placeholder="Add an item" value={checkText} onChange={(e) => setCheckText(e.target.value)} />
                  <Button type="submit" size="sm" variant="secondary" disabled={!checkText.trim()}>
                    Add
                  </Button>
                </form>
              )}
            </section>

            {t.depth === 0 && (
              <section aria-labelledby="h-sub">
                <h3 id="h-sub" className="text-sm font-semibold">
                  Subtasks ({detail.subtasks.length})
                </h3>
                <ul className="mt-2 space-y-1">
                  {detail.subtasks.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-[13.5px]">
                      <button type="button" className="truncate text-left text-teal-800 hover:underline" onClick={() => onOpenTask(s.id)}>
                        {detail.project.key}-{s.number} {s.title}
                      </button>
                      <Badge tone={TASK_STATUS_TONE[s.status]} className="ml-auto">
                        {TASK_STATUS_LABEL[s.status as TaskStatus]}
                      </Badge>
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <form
                    method="post"
                    className="mt-2 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!subTitle.trim()) return;
                      void run("sub", async () => {
                        await apiFetch(`/api/v1/tasks`, {
                          method: "POST",
                          body: { projectId: t.projectId, title: subTitle, parentTaskId: t.id },
                          headers: { "idempotency-key": crypto.randomUUID() },
                        });
                        setSubTitle("");
                      });
                    }}
                  >
                    <Input aria-label="New subtask title" placeholder="Add a subtask" value={subTitle} onChange={(e) => setSubTitle(e.target.value)} />
                    <Button type="submit" size="sm" variant="secondary" disabled={!subTitle.trim()} loading={busy === "sub"}>
                      <Plus className="h-3.5 w-3.5" aria-hidden /> Add
                    </Button>
                  </form>
                )}
              </section>
            )}

            <section aria-labelledby="h-deps">
              <div className="flex items-center justify-between">
                <h3 id="h-deps" className="text-sm font-semibold">
                  Dependencies
                </h3>
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => setShowDepPicker((v) => !v)} aria-expanded={showDepPicker}>
                    <Link2 className="h-3.5 w-3.5" aria-hidden /> Link task
                  </Button>
                )}
              </div>
              {showDepPicker && (
                <DependencyPicker
                  taskId={t.id}
                  onAdd={(id, kind) => run("dep", () => apiFetch(`/api/v1/tasks/${t.id}/dependencies`, { method: "POST", body: { blockingTaskId: id, kind } }))}
                />
              )}
              {detail.blockedBy.length + detail.blocking.length === 0 ? (
                <p className="mt-1 text-[13px] text-slate-500">No linked tasks.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-[13.5px]">
                  {[
                    ...detail.blockedBy.map((d) => ({ ...d, rel: d.kind === "BLOCKS" ? "Blocked by" : "Related to" })),
                    ...detail.blocking.map((d) => ({ ...d, rel: d.kind === "BLOCKS" ? "Blocks" : "Related to" })),
                  ].map((d) => (
                    <li key={d.dependencyId + d.rel} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-xs text-slate-500">{d.rel}</span>
                      <button type="button" className="min-w-0 truncate text-left text-teal-800 hover:underline" onClick={() => onOpenTask(d.id)}>
                        {d.projectKey}-{d.number} {d.title}
                      </button>
                      <Badge tone={TASK_STATUS_TONE[d.status]} className="ml-auto">
                        {TASK_STATUS_LABEL[d.status as TaskStatus]}
                      </Badge>
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Remove link to ${d.projectKey}-${d.number}`}
                          className="rounded p-0.5 text-slate-400 hover:text-red-700"
                          onClick={() => run("dep", () => apiFetch(`/api/v1/tasks/${t.id}/dependencies/${d.dependencyId}`, { method: "DELETE" }))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="h-comments">
              <h3 id="h-comments" className="text-sm font-semibold">
                Comments ({detail.comments.length})
              </h3>
              <ul className="mt-2 space-y-3">
                {detail.comments.map((c) => (
                  <li key={c.id} className="rounded-md bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">
                      <span className="font-medium text-slate-700">{c.authorName ?? "Former member"}</span> · {formatInstant(c.createdAt, t.dueTimezone)}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-[13.5px]">{c.body}</p>
                  </li>
                ))}
              </ul>
              {canEdit && (
                <form
                  method="post"
                  className="mt-2 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!comment.trim()) return;
                    void run("comment", async () => {
                      await apiFetch(`/api/v1/tasks/${t.id}/comments`, { method: "POST", body: { body: comment } });
                      setComment("");
                    });
                  }}
                >
                  <Textarea aria-label="New comment" rows={2} placeholder="Add a comment (no patient information)" value={comment} onChange={(e) => setComment(e.target.value)} />
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" variant="secondary" disabled={!comment.trim()} loading={busy === "comment"}>
                      Comment
                    </Button>
                  </div>
                </form>
              )}
            </section>

            <section aria-labelledby="h-activity">
              <h3 id="h-activity" className="text-sm font-semibold">
                Activity
              </h3>
              <ol className="mt-2 space-y-1 text-[12.5px] text-slate-600">
                {detail.events.map((ev) => (
                  <li key={ev.id}>
                    <span className="font-medium text-slate-800">{ev.actorName ?? "System"}</span> {EVENT_LABEL[ev.type] ?? ev.type.toLowerCase()}
                    {ev.type === "STATUS_CHANGED" && (
                      <>
                        {" "}
                        from {TASK_STATUS_LABEL[ev.fromValue as TaskStatus] ?? ev.fromValue} to {TASK_STATUS_LABEL[ev.toValue as TaskStatus] ?? ev.toValue}
                      </>
                    )}
                    {ev.type === "DUE_CHANGED" && <> to {formatDate(ev.toValue)}</>} · <time dateTime={ev.createdAt}>{formatInstant(ev.createdAt, t.dueTimezone)}</time>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </Dialog>
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title="Delete this task?"
        description="The task and its subtasks are removed from boards. History is retained in the audit log."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === "delete"}
              onClick={async () => {
                if (!t) return;
                setBusy("delete");
                try {
                  await apiFetch(`/api/v1/tasks/${t.id}`, { method: "DELETE" });
                  setConfirmDelete(false);
                  onChanged();
                  onClose();
                } catch (e) {
                  setError(errorMessage(e));
                  setConfirmDelete(false);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm">This can’t be undone from the interface.</p>
      </Dialog>
    </>
  );
}

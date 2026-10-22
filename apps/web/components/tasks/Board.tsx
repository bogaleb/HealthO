"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { reliableRefresh } from "@/lib/refresh";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Lock } from "lucide-react";
import { Badge, Button, ErrorState, Input, Select, cn } from "@projectos/ui";
import { BOARD_COLUMNS, TASK_PRIORITIES, TASK_STATUS_LABEL, type TaskStatus } from "@projectos/shared";
import { apiFetch, errorMessage } from "@/lib/client";
import { PRIORITY_LABEL, PRIORITY_TONE, formatDate } from "@/lib/format";
import { NewTaskButton } from "./NewTaskButton";

export interface BoardTask {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  position: number;
  version: number;
  ownerUserId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  labels: string[];
  isBlocked: boolean;
  projectKey: string;
  depth: number;
}

const COLUMN_ACCENT: Record<string, string> = {
  TODO: "border-t-slate-400",
  IN_PROGRESS: "border-t-sky-500",
  IN_REVIEW: "border-t-violet-500",
  BLOCKED: "border-t-red-500",
  DONE: "border-t-emerald-500",
};

export function Board({
  projectId,
  initialTasks,
  canEdit,
  members,
}: {
  projectId: string;
  initialTasks: BoardTask[];
  canEdit: boolean;
  members: { userId: string; displayName: string }[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ status: string; beforeId: string | null } | null>(null);
  const pending = useRef(0);

  // Adopt server state after a refresh, unless a move is in flight.
  useEffect(() => {
    if (pending.current === 0) setTasks(initialTasks);
  }, [initialTasks]);

  const visible = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (!owner || (owner === "none" ? !t.ownerUserId : t.ownerUserId === owner)) &&
          (!priority || t.priority === priority) &&
          (!q || t.title.toLowerCase().includes(q.toLowerCase())),
      ),
    [tasks, owner, priority, q],
  );
  const columns = useMemo(
    () => Object.fromEntries(BOARD_COLUMNS.map((s) => [s, visible.filter((t) => t.status === s).sort((a, b) => a.position - b.position)])) as Record<string, BoardTask[]>,
    [visible],
  );

  async function move(taskId: string, status: string, beforeId: string | null) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (beforeId === taskId) return;
    const before = tasks;
    // Optimistic local placement
    const col = tasks.filter((t) => t.status === status && t.id !== taskId).sort((a, b) => a.position - b.position);
    let pos: number;
    if (beforeId) {
      const idx = col.findIndex((t) => t.id === beforeId);
      const prev = col[idx - 1];
      pos = prev ? (prev.position + col[idx]!.position) / 2 : col[idx]!.position - 1024;
    } else pos = (col[col.length - 1]?.position ?? 0) + 1024;
    // A card that changes column is re-mounted; keep keyboard focus on its move control (WCAG 2.4.3).
    const refocus = typeof document !== "undefined" && document.activeElement?.id === `mv-${taskId}`;
    const restoreFocus = () => refocus && requestAnimationFrame(() => document.getElementById(`mv-${taskId}`)?.focus());
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status, position: pos } : t)));
    restoreFocus();
    setError(null);
    pending.current += 1;
    try {
      const updated = await apiFetch<{ version: number; position: number; status: string }>(`/api/v1/tasks/${taskId}/move`, {
        method: "POST",
        body: { status, beforeTaskId: beforeId, version: task.version },
      });
      setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, version: updated.version, position: updated.position, status: updated.status } : t)));
      setAnnounce(`${task.projectKey}-${task.number} moved to ${TASK_STATUS_LABEL[status as TaskStatus]}.`);
      restoreFocus();
      pending.current -= 1;
      reliableRefresh(router);
    } catch (e) {
      pending.current -= 1;
      setTasks(before); // roll back
      setError(errorMessage(e));
      setAnnounce(`Move failed: ${errorMessage(e)}`);
    }
  }

  function moveWithinColumn(t: BoardTask, dir: -1 | 1) {
    const col = columns[t.status] ?? [];
    const i = col.findIndex((x) => x.id === t.id);
    if (dir === -1 && i > 0) void move(t.id, t.status, col[i - 1]!.id);
    if (dir === 1 && i < col.length - 1) void move(t.id, t.status, col[i + 2]?.id ?? null);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="w-56">
          <label htmlFor="bf-q" className="sr-only">
            Filter by title
          </label>
          <Input id="bf-q" placeholder="Filter by title…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-48">
          <label htmlFor="bf-owner" className="sr-only">
            Owner
          </label>
          <Select id="bf-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">All owners</option>
            <option value="none">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <label htmlFor="bf-pri" className="sr-only">
            Priority
          </label>
          <Select id="bf-pri" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-auto">{canEdit && <NewTaskButton projectId={projectId} members={members} />}</div>
      </div>
      {!canEdit && <p className="mb-3 text-[13px] text-slate-500">You have read-only access to this project.</p>}
      {error && (
        <div className="mb-3">
          <ErrorState title="Move not saved — the card was returned to its previous place" message={error} />
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      <div className="grid gap-3 overflow-x-auto pb-4" style={{ gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(200px, 1fr))` }}>
        {BOARD_COLUMNS.map((status) => {
          const col = columns[status] ?? [];
          return (
            <section
              key={status}
              aria-label={`${TASK_STATUS_LABEL[status]} column, ${col.length} tasks`}
              data-testid={`column-${status}`}
              className={cn(
                "flex min-h-[200px] flex-col rounded-lg border border-t-4 border-slate-200 bg-slate-100/70",
                COLUMN_ACCENT[status],
                dropHint?.status === status && !dropHint.beforeId && "ring-2 ring-teal-500",
              )}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                if (e.target === e.currentTarget) setDropHint({ status, beforeId: null });
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDropHint(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/task-id") || dragId;
                const hint = dropHint;
                setDragId(null);
                setDropHint(null);
                if (id) void move(id, status, hint?.status === status ? hint.beforeId : null);
              }}
            >
              <header className="flex items-center justify-between px-3 py-2">
                <h2 className="text-[13px] font-semibold text-slate-700">
                  {TASK_STATUS_LABEL[status]} <span className="tabular font-normal text-slate-600">({col.length})</span>
                </h2>
              </header>
              <ol className="flex flex-1 flex-col gap-2 px-2 pb-2">
                {col.map((t, i) => (
                  <li
                    key={t.id}
                    data-testid={`card-${t.number}`}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/task-id", t.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(t.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropHint(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setDropHint({ status, beforeId: t.id });
                    }}
                    className={cn(
                      "group rounded-md border border-slate-200 bg-white p-2.5 shadow-xs",
                      dragId === t.id && "opacity-40",
                      dropHint?.beforeId === t.id && "border-t-2 border-t-teal-600",
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      {canEdit && <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-grab text-slate-300" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <Link href={`?task=${t.id}`} scroll={false} className="block text-[13.5px] font-medium leading-snug text-slate-800 hover:text-teal-800 hover:underline">
                          <span className="mr-1 font-mono text-[11.5px] font-normal text-slate-600">
                            {t.projectKey}-{t.number}
                          </span>
                          {t.title}
                        </Link>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                          {t.isBlocked && (
                            <Badge tone="red" icon={<Lock className="h-3 w-3" aria-hidden />}>
                              Blocked
                            </Badge>
                          )}
                          {t.depth === 1 && <Badge>Subtask</Badge>}
                          {t.labels.slice(0, 2).map((l) => (
                            <Badge key={l} tone="teal">
                              {l}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-1.5 flex justify-between text-[12px] text-slate-500">
                          <span className="truncate">{t.ownerName ?? "Unassigned"}</span>
                          <span className="tabular">{t.dueDate ? `Due ${formatDate(t.dueDate, { withYear: false })}` : ""}</span>
                        </div>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-2">
                        <label htmlFor={`mv-${t.id}`} className="sr-only">
                          Move {t.projectKey}-{t.number} to column
                        </label>
                        <Select id={`mv-${t.id}`} className="h-7 text-[12px]" value={t.status} onChange={(e) => void move(t.id, e.target.value, null)}>
                          {BOARD_COLUMNS.map((s) => (
                            <option key={s} value={s}>
                              {TASK_STATUS_LABEL[s]}
                            </option>
                          ))}
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1.5"
                          aria-label={`Move ${t.projectKey}-${t.number} up`}
                          disabled={i === 0}
                          onClick={() => moveWithinColumn(t, -1)}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1.5"
                          aria-label={`Move ${t.projectKey}-${t.number} down`}
                          disabled={i === col.length - 1}
                          onClick={() => moveWithinColumn(t, 1)}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
                {col.length === 0 && (
                  <li className="rounded border border-dashed border-slate-300 px-2 py-4 text-center text-[12px] text-slate-600">{canEdit ? "Drop tasks here" : "No tasks"}</li>
                )}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Field, Input, Select, Textarea } from "@projectos/ui";
import { PROJECT_HEALTH, PROJECT_STATUSES, TASK_PRIORITIES } from "@projectos/shared";
import { apiFetch, errorMessage } from "@/lib/client";
import { HEALTH_LABEL, PRIORITY_LABEL, PROJECT_STATUS_LABEL } from "@/lib/format";

interface ProjectLite {
  id: string;
  name: string;
  description: string | null;
  status: string;
  health: string;
  ownerUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  version: number;
}

export function ProjectSettingsForm({ project, members }: { project: ProjectLite; members: { userId: string; displayName: string }[] }) {
  const router = useRouter();
  const init = { name: project.name, description: project.description ?? "", status: project.status, health: project.health, ownerUserId: project.ownerUserId ?? "", startDate: project.startDate ?? "", dueDate: project.dueDate ?? "" };
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  return (
    <form method="post"
      className="space-y-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await apiFetch(`/api/v1/projects/${project.id}`, {
            method: "PATCH",
            body: { ...f, description: f.description || null, ownerUserId: f.ownerUserId || null, startDate: f.startDate || null, dueDate: f.dueDate || null, version: project.version },
          });
          setMsg({ ok: true, text: "Saved." });
          router.refresh();
        } catch (err) {
          setMsg({ ok: false, text: errorMessage(err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Name" htmlFor="p-name">
        <Input id="p-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status" htmlFor="p-status">
          <Select id="p-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Health" htmlFor="p-health">
          <Select id="p-health" value={f.health} onChange={(e) => setF({ ...f, health: e.target.value })}>
            {PROJECT_HEALTH.map((s) => (
              <option key={s} value={s}>
                {HEALTH_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner" htmlFor="p-owner">
          <Select id="p-owner" value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value })}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <div />
        <Field label="Start date" htmlFor="p-start">
          <Input id="p-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </Field>
        <Field label="Due date" htmlFor="p-due">
          <Input id="p-due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        </Field>
      </div>
      <Field label="Description" htmlFor="p-desc">
        <Textarea id="p-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      {msg && (msg.ok ? <p role="status" className="text-sm text-emerald-700">{msg.text}</p> : <ErrorState title="Not saved" message={msg.text} />)}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={busy} disabled={!dirty}>
          Save project
        </Button>
      </div>
    </form>
  );
}

export function AddMilestoneForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form method="post"
      className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-4 py-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await apiFetch(`/api/v1/projects/${projectId}/milestones`, { method: "POST", body: { name, dueDate: due || null } });
          setName("");
          setDue("");
          router.refresh();
        } catch (e2) {
          setErr(errorMessage(e2));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="New milestone" htmlFor="ms-name" className="flex-1">
        <Input id="ms-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Due" htmlFor="ms-due">
        <Input id="ms-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={!name.trim()}>
        Add
      </Button>
      {err && <p role="alert" className="w-full text-sm text-red-700">{err}</p>}
    </form>
  );
}

export function AddRecurringForm({ projectId, members, defaultStart }: { projectId: string; members: { userId: string; displayName: string }[]; defaultStart: string }) {
  const router = useRouter();
  const blank = { title: "", cadence: "WEEKLY", weekday: "1", monthDay: "1", startOn: defaultStart, ownerUserId: "", priority: "MEDIUM", dueInDays: "0" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form method="post"
      className="grid grid-cols-2 gap-3 border-t border-slate-100 px-4 py-3 md:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await apiFetch(`/api/v1/projects/${projectId}/recurring`, {
            method: "POST",
            body: {
              title: f.title,
              cadence: f.cadence,
              weekday: f.cadence === "WEEKLY" ? Number(f.weekday) : null,
              monthDay: f.cadence === "MONTHLY" ? Number(f.monthDay) : null,
              startOn: f.startOn,
              timezone: "America/New_York",
              ownerUserId: f.ownerUserId || null,
              priority: f.priority,
              dueInDays: Number(f.dueInDays),
            },
          });
          setF(blank);
          router.refresh();
        } catch (e2) {
          setErr(errorMessage(e2));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Recurring task title" htmlFor="rc-title" className="col-span-2">
        <Input id="rc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
      </Field>
      <Field label="Cadence" htmlFor="rc-cad">
        <Select id="rc-cad" value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value })}>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
        </Select>
      </Field>
      {f.cadence === "WEEKLY" && (
        <Field label="Weekday" htmlFor="rc-wd">
          <Select id="rc-wd" value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {f.cadence === "MONTHLY" && (
        <Field label="Day of month (1–28)" htmlFor="rc-md">
          <Input id="rc-md" type="number" min={1} max={28} value={f.monthDay} onChange={(e) => setF({ ...f, monthDay: e.target.value })} />
        </Field>
      )}
      {f.cadence === "DAILY" && <div />}
      <Field label="Starts on" htmlFor="rc-start">
        <Input id="rc-start" type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} required />
      </Field>
      <Field label="Owner" htmlFor="rc-owner">
        <Select id="rc-owner" value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value })}>
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Priority" htmlFor="rc-pri">
        <Select id="rc-pri" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Due after (days)" htmlFor="rc-due">
        <Input id="rc-due" type="number" min={0} max={60} value={f.dueInDays} onChange={(e) => setF({ ...f, dueInDays: e.target.value })} />
      </Field>
      <div className="col-span-2 flex items-end justify-end md:col-span-4">
        <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={!f.title.trim()}>
          Add recurring task
        </Button>
      </div>
      {err && <p role="alert" className="col-span-2 text-sm text-red-700 md:col-span-4">{err}</p>}
    </form>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Dialog, ErrorState, Field, Input, Select, Textarea } from "@projectos/ui";
import { ApiError, apiFetch, errorMessage } from "@/lib/client";

export function NewProjectButton({
  members,
  departments,
  sites,
  templates,
}: {
  members: { userId: string; displayName: string }[];
  departments: { id: string; name: string }[];
  sites: { id: string; code: string; name: string }[];
  templates: { id: string; name: string; description: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const blank = { key: "", name: "", description: "", departmentId: "", siteId: "", ownerUserId: "", startDate: "", dueDate: "", templateId: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> New project
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New project"
        description="Scope a project to a department or site to control who can see and edit it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="np-form" loading={busy} disabled={!f.key || !f.name}>
              Create project
            </Button>
          </>
        }
      >
        <form
          method="post"
          id="np-form"
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            setFe({});
            try {
              const p = await apiFetch<{ id: string }>("/api/v1/projects", {
                method: "POST",
                body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v])),
              });
              setOpen(false);
              setF(blank);
              router.push(`/projects/${p.id}/board`);
            } catch (err) {
              setError(errorMessage(err));
              if (err instanceof ApiError) setFe(err.fieldErrors());
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <ErrorState title="Project not created" message={error} />}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Key" htmlFor="np-key" hint="e.g. BILL" error={fe.key}>
              <Input id="np-key" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase() })} maxLength={10} required />
            </Field>
            <Field label="Name" htmlFor="np-name" className="col-span-2" error={fe.name}>
              <Input id="np-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Department" htmlFor="np-dept">
              <Select id="np-dept" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
                <option value="">Organization-wide</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Site" htmlFor="np-site">
              <Select id="np-site" value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}>
                <option value="">Any / none</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Owner" htmlFor="np-owner">
              <Select id="np-owner" value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value })}>
                <option value="">Me</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Start from template" htmlFor="np-tpl">
              <Select id="np-tpl" value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
                <option value="">Blank project</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Start date" htmlFor="np-start">
              <Input id="np-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
            </Field>
            <Field label="Due date" htmlFor="np-due" error={fe.dueDate}>
              <Input id="np-due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
            </Field>
          </div>
          <Field label="Description" htmlFor="np-desc">
            <Textarea id="np-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

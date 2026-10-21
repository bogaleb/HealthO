"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Select } from "@projectos/ui";
import { CASE_STATUSES } from "@projectos/shared";
import { apiFetch, errorMessage } from "@/lib/client";
import { humanize } from "@/lib/format";
import { FormDialog } from "@/components/FormDialog";

export function CaseRowActions({ c, canEdit, projects }: { c: { id: string; status: string; version: number; taskId: string | null }; canEdit: boolean; projects: { id: string; label: string }[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <label htmlFor={`cs-${c.id}`} className="sr-only">Case status</label>
      <Select
        id={`cs-${c.id}`}
        className="h-8 w-40 text-[12.5px]"
        value={c.status}
        onChange={async (e) => {
          setErr(null);
          try {
            const r = await apiFetch<{ taskSync: string | null }>(`/api/v1/credentialing/cases/${c.id}`, { method: "PATCH", body: { status: e.target.value, version: c.version } });
            if (r.taskSync && r.taskSync !== "DONE") setErr(`Linked task not updated: ${r.taskSync}`);
            router.refresh();
          } catch (x) {
            setErr(errorMessage(x));
          }
        }}
      >
        {CASE_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
      </Select>
      {!c.taskId && projects.length > 0 && (
        <FormDialog
          title="Create linked project task"
          description="The task is created in the chosen project and is marked Done automatically when this case is completed."
          submitLabel="Create task"
          trigger={(open) => <Button size="sm" variant="secondary" onClick={open}>Link task</Button>}
          fields={[{ name: "projectId", label: "Project", type: "select", required: true, options: projects.map((p) => ({ value: p.id, label: p.label })), defaultValue: projects[0]!.id }]}
          onSubmit={(v) => apiFetch(`/api/v1/credentialing/cases/${c.id}/link-task`, { method: "POST", body: { projectId: v.projectId } })}
        />
      )}
      {err && <p role="alert" className="w-full text-right text-xs text-red-700">{err}</p>}
    </div>
  );
}

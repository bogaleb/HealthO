"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge, Button, Card, Dialog, ErrorState, Field, Input } from "@projectos/ui";
import { PERMISSIONS, PERMISSION_LABELS, type Permission } from "@projectos/shared";
import { apiFetch, errorMessage } from "@/lib/client";

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  version: number;
  permissions: Permission[];
  memberCount: number;
}

export function RolesAdmin({ roles, canManage, held }: { roles: Role[]; canManage: boolean; held: Permission[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (r: Role | "new") => {
    setEditing(r);
    setError(null);
    setName(r === "new" ? "" : r.name);
    setDescription(r === "new" ? "" : (r.description ?? ""));
    setPerms(r === "new" ? [] : r.permissions);
  };

  return (
    <>
      {canManage && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => open("new")}>
            <Plus className="h-4 w-4" aria-hidden /> New custom role
          </Button>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((r) => (
          <Card key={r.id} className="flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">{r.name}</h2>
                <p className="mt-0.5 text-xs text-slate-500">{r.description}</p>
              </div>
              {r.isSystem ? <Badge>Built-in</Badge> : <Badge tone="violet">Custom</Badge>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {r.permissions.map((p) => (
                <Badge key={p} tone="teal">
                  {p}
                </Badge>
              ))}
            </div>
            <div className="mt-auto flex items-center justify-between pt-3 text-xs text-slate-500">
              <span>
                {r.memberCount} member{r.memberCount === 1 ? "" : "s"}
              </span>
              {canManage && !r.isSystem && (
                <Button size="sm" variant="ghost" onClick={() => open(r)}>
                  Edit
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New custom role" : `Edit ${editing ? editing.name : ""}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!name.trim()}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  if (editing === "new") await apiFetch("/api/v1/roles", { method: "POST", body: { name, description: description || null, permissions: perms } });
                  else if (editing) await apiFetch(`/api/v1/roles/${editing.id}`, { method: "PATCH", body: { name, description: description || null, permissions: perms, version: editing.version } });
                  setEditing(null);
                  router.refresh();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save role
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorState title="Role not saved" message={error} />}
          <Field label="Role name" htmlFor="r-name">
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="r-desc">
            <Input id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <fieldset>
            <legend className="text-[13px] font-medium text-slate-700">Permissions</legend>
            <p className="text-xs text-slate-500">Only permissions you hold organization-wide can be granted.</p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {PERMISSIONS.map((p) => (
                <label key={p} className={`flex items-start gap-2 rounded px-1.5 py-1 text-[13px] ${held.includes(p) ? "" : "opacity-50"}`}>
                  <input type="checkbox" className="mt-0.5" disabled={!held.includes(p)} checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />
                  <span>
                    <span className="font-mono text-[12px]">{p}</span>
                    <span className="block text-xs text-slate-500">{PERMISSION_LABELS[p]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Dialog>
    </>
  );
}

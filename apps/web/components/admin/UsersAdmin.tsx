"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2, UserPlus } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, Select } from "@projectos/ui";
import { apiFetch, errorMessage } from "@/lib/client";
import { formatInstant } from "@/lib/format";

interface Grant {
  roleId: string;
  siteId: string | null;
  departmentId: string | null;
}
interface Member {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  status: string;
  professionalRole: string | null;
  departmentId: string | null;
  version: number;
  grants: (Grant & { id: string; roleName: string })[];
}
interface Ref {
  roles: { id: string; name: string; permissions: string[] }[];
  sites: { id: string; code: string; name: string }[];
  departments: { id: string; code: string; name: string }[];
}
const ORG_WIDE_ONLY = ["org.manage", "users.manage", "audit.read", "policy.publish"];

function scopeValue(g: Grant) {
  return g.siteId ? `site:${g.siteId}` : g.departmentId ? `dept:${g.departmentId}` : "org";
}
function fromScope(v: string): Pick<Grant, "siteId" | "departmentId"> {
  if (v.startsWith("site:")) return { siteId: v.slice(5), departmentId: null };
  if (v.startsWith("dept:")) return { siteId: null, departmentId: v.slice(5) };
  return { siteId: null, departmentId: null };
}

function GrantEditor({ grants, setGrants, refs, idPrefix }: { grants: Grant[]; setGrants: (g: Grant[]) => void; refs: Ref; idPrefix: string }) {
  return (
    <div className="space-y-2">
      {grants.map((g, i) => {
        const role = refs.roles.find((r) => r.id === g.roleId);
        const orgOnly = role?.permissions.some((p) => ORG_WIDE_ONLY.includes(p));
        return (
          <div key={i} className="flex items-end gap-2">
            <Field label={i === 0 ? "Role" : ""} htmlFor={`${idPrefix}-role-${i}`} className="flex-1">
              <Select id={`${idPrefix}-role-${i}`} aria-label={`Role ${i + 1}`} value={g.roleId} onChange={(e) => setGrants(grants.map((x, j) => (j === i ? { roleId: e.target.value, siteId: null, departmentId: null } : x)))}>
                {refs.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={i === 0 ? "Scope" : ""} htmlFor={`${idPrefix}-scope-${i}`} className="flex-1">
              <Select id={`${idPrefix}-scope-${i}`} aria-label={`Scope for role ${i + 1}`} value={scopeValue(g)} onChange={(e) => setGrants(grants.map((x, j) => (j === i ? { ...x, ...fromScope(e.target.value) } : x)))}>
                <option value="org">Organization-wide</option>
                {!orgOnly &&
                  refs.sites.map((s) => (
                    <option key={s.id} value={`site:${s.id}`}>
                      Site: {s.code} — {s.name}
                    </option>
                  ))}
                {!orgOnly &&
                  refs.departments.map((d) => (
                    <option key={d.id} value={`dept:${d.id}`}>
                      Department: {d.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Button variant="ghost" size="sm" aria-label={`Remove role ${i + 1}`} onClick={() => setGrants(grants.filter((_, j) => j !== i))} disabled={grants.length === 1}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
      <Button variant="ghost" size="sm" onClick={() => setGrants([...grants, { roleId: refs.roles[0]!.id, siteId: null, departmentId: null }])}>
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add role
      </Button>
      <p className="text-xs text-slate-500">You can only grant permissions you hold organization-wide. Admin, user-management, audit and policy permissions cannot be scoped.</p>
    </div>
  );
}

export function UsersAdmin({ members, invites, refs, me, filters }: { members: Member[]; invites: { id: string; email: string; displayName: string; expiresAt: string }[]; refs: Ref; me: string; filters: { departmentId?: string; status?: string } }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Member | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inv, setInv] = useState({ email: "", displayName: "" });
  const [invGrants, setInvGrants] = useState<Grant[]>([{ roleId: refs.roles.find((r) => r.name.startsWith("Read-only"))?.id ?? refs.roles[0]!.id, siteId: null, departmentId: null }]);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const site = new Map(refs.sites.map((s) => [s.id, s.code]));
  const dept = new Map(refs.departments.map((d) => [d.id, d.name]));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Filter staff">
          <div>
            <label htmlFor="uf-dept" className="block text-xs font-medium text-slate-600">
              Department
            </label>
            <select id="uf-dept" name="departmentId" defaultValue={filters.departmentId ?? ""} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
              <option value="">All departments</option>
              {refs.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="uf-status" className="block text-xs font-medium text-slate-600">
              Status
            </label>
            <select id="uf-status" name="status" defaultValue={filters.status ?? ""} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
              <option value="">Any</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
        <div className="ml-auto">
          <Button
            onClick={() => {
              setInviteOpen(true);
              setToken(null);
              setError(null);
            }}
          >
            <UserPlus className="h-4 w-4" aria-hidden /> Invite staff member
          </Button>
        </div>
      </div>
      {error && !editing && !inviteOpen && (
        <div className="mb-3">
          <ErrorState title="Change not saved" message={error} />
        </div>
      )}

      <Card>
        {members.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No staff match these filters" />
          </div>
        ) : (
          <table className="w-full text-left text-[13.5px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">Name</th>
                <th scope="col" className="px-3 py-2">Email</th>
                <th scope="col" className="px-3 py-2">Department</th>
                <th scope="col" className="px-3 py-2">Roles &amp; scope</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.membershipId} data-testid={`member-${m.email}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{m.displayName}</div>
                    <div className="text-xs text-slate-500">{m.professionalRole}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{m.email}</td>
                  <td className="px-3 py-2 text-slate-600">{m.departmentId ? dept.get(m.departmentId) : "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {m.grants.map((g) => (
                        <Badge key={g.id} tone={g.siteId || g.departmentId ? "blue" : "teal"}>
                          {g.roleName}
                          {g.siteId ? ` · ${site.get(g.siteId)}` : g.departmentId ? ` · ${dept.get(g.departmentId)}` : " · Org-wide"}
                        </Badge>
                      ))}
                      {m.grants.length === 0 && <span className="text-xs text-slate-500">No roles</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">{m.status === "ACTIVE" ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Suspended</Badge>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {m.membershipId !== me ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(m);
                            setGrants(m.grants.map(({ roleId, siteId, departmentId }) => ({ roleId, siteId, departmentId })));
                            setError(null);
                          }}
                        >
                          Edit roles
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            setError(null);
                            try {
                              await apiFetch(`/api/v1/users/${m.membershipId}`, { method: "PATCH", body: { status: m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE", version: m.version } });
                              router.refresh();
                            } catch (e) {
                              setError(errorMessage(e));
                            }
                          }}
                        >
                          {m.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">You</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {invites.length > 0 && (
        <Card className="mt-4">
          <div className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold">Pending invitations</div>
          <ul className="divide-y divide-slate-100 text-[13.5px]">
            {invites.map((i) => (
              <li key={i.id} className="flex justify-between px-4 py-2">
                <span>
                  {i.displayName} · <span className="text-slate-600">{i.email}</span>
                </span>
                <span className="text-xs text-slate-500">expires {formatInstant(i.expiresAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Roles for ${editing?.displayName ?? ""}`}
        description="Changes apply on this person’s next request."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                if (!editing) return;
                setBusy(true);
                setError(null);
                try {
                  await apiFetch(`/api/v1/users/${editing.membershipId}/roles`, { method: "PUT", body: { grants, version: editing.version } });
                  setEditing(null);
                  router.refresh();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save roles
            </Button>
          </>
        }
      >
        {error && editing && (
          <div className="mb-3">
            <ErrorState title="Roles not saved" message={error} />
          </div>
        )}
        <GrantEditor grants={grants} setGrants={setGrants} refs={refs} idPrefix="edit" />
      </Dialog>

      <Dialog
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          setToken(null);
          router.refresh();
        }}
        title="Invite staff member"
        description="Local synthetic invite: no email is sent. Share the one-time code securely; it is shown only once."
        footer={
          token ? (
            <Button onClick={() => { setInviteOpen(false); setToken(null); router.refresh(); }}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" form="invite-form" loading={busy} disabled={!inv.email || !inv.displayName}>
                Create invitation
              </Button>
            </>
          )
        }
      >
        {token ? (
          <div className="space-y-3 text-sm" role="status">
            <p>
              Invitation created for <strong>{inv.email}</strong>. Give them this code and the <code>/invite</code> page address. It expires in 7 days and works once.
            </p>
            <div className="flex items-center gap-2">
              <code data-testid="invite-token" className="flex-1 break-all rounded bg-slate-100 px-2 py-1.5 font-mono text-[12.5px]">
                {token}
              </code>
              <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(token)} aria-label="Copy invitation code">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <form method="post"
            id="invite-form"
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                const r = await apiFetch<{ token: string }>("/api/v1/auth/invite", { method: "POST", body: { ...inv, grants: invGrants } });
                setToken(r.token);
              } catch (e2) {
                setError(errorMessage(e2));
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && <ErrorState title="Invitation not created" message={error} />}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Display name" htmlFor="inv-name">
                <Input id="inv-name" value={inv.displayName} onChange={(e) => setInv({ ...inv, displayName: e.target.value })} required />
              </Field>
              <Field label="Work email" htmlFor="inv-email">
                <Input id="inv-email" type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} required />
              </Field>
            </div>
            <GrantEditor grants={invGrants} setGrants={setInvGrants} refs={refs} idPrefix="inv" />
          </form>
        )}
      </Dialog>
    </>
  );
}

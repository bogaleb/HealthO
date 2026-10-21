"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, Select } from "@projectos/ui";
import { US_JURISDICTIONS } from "@projectos/shared";
import { ApiError, apiFetch, errorMessage } from "@/lib/client";

interface Site {
  id: string;
  code: string;
  name: string;
  state: string;
  timezone: string;
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  active: boolean;
  version: number;
}
const US_TZ = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Puerto_Rico", "Pacific/Guam"];

function SiteDialog({ site, open, onClose }: { site: Site | null; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const init = { code: site?.code ?? "", name: site?.name ?? "", state: site?.state ?? "VA", timezone: site?.timezone ?? "America/New_York", addressLine1: site?.addressLine1 ?? "", city: site?.city ?? "", postalCode: site?.postalCode ?? "" };
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={site ? `Edit ${site.code}` : "New site"}
      description="Sites carry the physical state and IANA time zone used for scheduling in later phases. Use synthetic addresses only."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="site-form" loading={busy}>
            {site ? "Save site" : "Create site"}
          </Button>
        </>
      }
    >
      <form method="post"
        id="site-form"
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setFe({});
          try {
            const body = { ...f, addressLine1: f.addressLine1 || null, city: f.city || null, postalCode: f.postalCode || null };
            if (site) await apiFetch(`/api/v1/sites/${site.id}`, { method: "PATCH", body: { ...body, version: site.version } });
            else await apiFetch("/api/v1/sites", { method: "POST", body });
            onClose();
            router.refresh();
          } catch (err) {
            setError(errorMessage(err));
            if (err instanceof ApiError) setFe(err.fieldErrors());
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <ErrorState title="Not saved" message={error} />}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Code" htmlFor="s-code" error={fe.code}>
            <Input id="s-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required maxLength={16} />
          </Field>
          <Field label="Name" htmlFor="s-name" className="col-span-2" error={fe.name}>
            <Input id="s-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </Field>
          <Field label="State / jurisdiction" htmlFor="s-state" error={fe.state}>
            <Select id="s-state" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
              {US_JURISDICTIONS.map((j) => (
                <option key={j}>{j}</option>
              ))}
            </Select>
          </Field>
          <Field label="Time zone (IANA)" htmlFor="s-tz" className="col-span-2" error={fe.timezone}>
            <Select id="s-tz" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {US_TZ.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          </Field>
          <Field label="Street address" htmlFor="s-addr" className="col-span-3">
            <Input id="s-addr" value={f.addressLine1} onChange={(e) => setF({ ...f, addressLine1: e.target.value })} />
          </Field>
          <Field label="City" htmlFor="s-city" className="col-span-2">
            <Input id="s-city" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </Field>
          <Field label="ZIP" htmlFor="s-zip">
            <Input id="s-zip" value={f.postalCode} onChange={(e) => setF({ ...f, postalCode: e.target.value })} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}

export function SitesAdmin({ sites, canCreate, manageable }: { sites: Site[]; canCreate: boolean; manageable: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Site | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader
        title={`Sites (${sites.length})`}
        description="Inactive sites stay in history but are hidden from pickers."
        actions={
          canCreate && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> New site
            </Button>
          )
        }
      />
      {err && (
        <div className="p-3">
          <ErrorState title="Change not saved" message={err} />
        </div>
      )}
      {sites.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No sites yet" />
        </div>
      ) : (
        <table className="w-full text-left text-[13.5px]">
          <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">Code</th>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">State</th>
              <th scope="col" className="px-3 py-2">Time zone</th>
              <th scope="col" className="px-3 py-2">City</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sites.map((s) => (
              <tr key={s.id} data-testid={`site-${s.code}`}>
                <td className="px-3 py-2 font-mono text-[12.5px]">{s.code}</td>
                <td className="px-3 py-2 font-medium">{s.name}</td>
                <td className="px-3 py-2">{s.state}</td>
                <td className="px-3 py-2 text-slate-600">{s.timezone}</td>
                <td className="px-3 py-2 text-slate-600">{s.city ?? "—"}</td>
                <td className="px-3 py-2">{s.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                <td className="px-3 py-2 text-right">
                  {manageable.includes(s.id) && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.code}`}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          setErr(null);
                          try {
                            await apiFetch(`/api/v1/sites/${s.id}`, { method: "PATCH", body: { active: !s.active, version: s.version } });
                            router.refresh();
                          } catch (e) {
                            setErr(errorMessage(e));
                          }
                        }}
                      >
                        {s.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && <SiteDialog site={null} open onClose={() => setCreating(false)} />}
      {editing && <SiteDialog key={editing.id} site={editing} open onClose={() => setEditing(null)} />}
    </Card>
  );
}

export function DepartmentsAdmin({ departments, teams, sites, canManage }: { departments: { id: string; code: string; name: string; siteId: string | null }[]; teams: { id: string; name: string; departmentId: string }[]; sites: { id: string; code: string }[]; canManage: boolean }) {
  const router = useRouter();
  const [d, setD] = useState({ code: "", name: "", siteId: "" });
  const [t, setT] = useState({ name: "", departmentId: departments[0]?.id ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const siteCode = new Map(sites.map((s) => [s.id, s.code]));
  return (
    <Card>
      <CardHeader title="Departments & teams" description="Departments scope roles and projects (e.g. an RCM analyst sees only Revenue Cycle projects)." />
      <ul className="divide-y divide-slate-100">
        {departments.map((dep) => (
          <li key={dep.id} className="px-4 py-2.5 text-[13.5px]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-slate-500">{dep.code}</span>
              <span className="font-medium">{dep.name}</span>
              {dep.siteId && <Badge>{siteCode.get(dep.siteId)}</Badge>}
            </div>
            {teams.filter((x) => x.departmentId === dep.id).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1 pl-12">
                {teams
                  .filter((x) => x.departmentId === dep.id)
                  .map((x) => (
                    <Badge key={x.id} tone="teal">
                      {x.name}
                    </Badge>
                  ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="space-y-3 border-t border-slate-200 p-4">
          {err && <ErrorState title="Not saved" message={err} />}
          <form method="post"
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              try {
                await apiFetch("/api/v1/departments", { method: "POST", body: { ...d, siteId: d.siteId || null } });
                setD({ code: "", name: "", siteId: "" });
                router.refresh();
              } catch (e2) {
                setErr(errorMessage(e2));
              }
            }}
          >
            <Field label="Dept code" htmlFor="d-code" className="w-28">
              <Input id="d-code" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} required />
            </Field>
            <Field label="Department name" htmlFor="d-name" className="flex-1">
              <Input id="d-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required />
            </Field>
            <Field label="Site (optional)" htmlFor="d-site">
              <Select id="d-site" value={d.siteId} onChange={(e) => setD({ ...d, siteId: e.target.value })}>
                <option value="">All sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" size="sm" variant="secondary" disabled={!d.code || !d.name}>
              Add department
            </Button>
          </form>
          {departments.length > 0 && (
            <form method="post"
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setErr(null);
                try {
                  await apiFetch("/api/v1/teams", { method: "POST", body: t });
                  setT({ ...t, name: "" });
                  router.refresh();
                } catch (e2) {
                  setErr(errorMessage(e2));
                }
              }}
            >
              <Field label="Team name" htmlFor="t-name" className="flex-1">
                <Input id="t-name" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} required />
              </Field>
              <Field label="In department" htmlFor="t-dept">
                <Select id="t-dept" value={t.departmentId} onChange={(e) => setT({ ...t, departmentId: e.target.value })}>
                  {departments.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" size="sm" variant="secondary" disabled={!t.name}>
                Add team
              </Button>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

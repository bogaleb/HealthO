import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { listPractitioners, listReference } from "@projectos/credentialing";
import { hasAny } from "@projectos/auth";
import { PROFESSIONS, PROFESSION_LABEL, US_JURISDICTIONS, type Profession } from "@projectos/shared";
import { Badge, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { Forbidden } from "@/components/Forbidden";
import { NewProviderButton } from "@/components/credentialing/ProviderForms";

export const metadata: Metadata = { title: "Providers" };

export default async function ProvidersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "credentialing.read")) return <Forbidden what="provider credentialing" />;
  const sp = await searchParams;
  const filters = {
    profession: PROFESSIONS.includes(sp.profession as Profession) ? sp.profession : undefined,
    state: US_JURISDICTIONS.includes(sp.state as never) ? sp.state : undefined,
    siteId: /^[0-9a-f-]{36}$/.test(sp.siteId ?? "") ? sp.siteId : undefined,
    q: sp.q?.slice(0, 80) || undefined,
  };
  const db = getDb();
  const [rows, ref] = await Promise.all([load(listPractitioners(db, ctx, Object.fromEntries(Object.entries(filters).filter(([, v]) => v)))), listReference(db, ctx)]);
  const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";
  return (
    <div>
      <PageHeader
        title="Providers"
        description="Synthetic provider directory with license/authority evidence status. Alerts are computed live from the database."
        actions={hasAny(ctx, "credentialing.edit") && <NewProviderButton reference={ref} />}
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label="Filter providers">
        <div>
          <label htmlFor="pf-q" className="block text-xs font-medium text-slate-600">
            Name
          </label>
          <input id="pf-q" name="q" defaultValue={filters.q} className={`${sel} w-48`} />
        </div>
        <div>
          <label htmlFor="pf-prof" className="block text-xs font-medium text-slate-600">
            Profession
          </label>
          <select id="pf-prof" name="profession" defaultValue={filters.profession ?? ""} className={sel}>
            <option value="">Any</option>
            {PROFESSIONS.map((p) => (
              <option key={p} value={p}>
                {PROFESSION_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pf-state" className="block text-xs font-medium text-slate-600">
            Has authority in
          </label>
          <select id="pf-state" name="state" defaultValue={filters.state ?? ""} className={sel}>
            <option value="">Any state</option>
            {US_JURISDICTIONS.map((j) => (
              <option key={j}>{j}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pf-site" className="block text-xs font-medium text-slate-600">
            Site
          </label>
          <select id="pf-site" name="siteId" defaultValue={filters.siteId ?? ""} className={sel}>
            <option value="">Any site</option>
            {ref.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="press sheen h-9 rounded-full bg-ink-900 px-4 text-sm font-medium text-white shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_8px_20px_-10px_rgb(43_51_105/0.55)] hover:bg-ink-800"
        >
          Apply
        </button>
        <Link href="/providers" className="px-2 py-2 text-sm text-slate-600 hover:underline">
          Clear
        </Link>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No providers match" description="Clear a filter, or add a provider." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)]">
          <table className="w-full text-left text-[13.5px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Provider
                </th>
                <th scope="col" className="px-3 py-2">
                  Profession
                </th>
                <th scope="col" className="px-3 py-2">
                  Sites
                </th>
                <th scope="col" className="px-3 py-2">
                  Verified, unexpired authority
                </th>
                <th scope="col" className="px-3 py-2">
                  Alerts
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Payer plans ready
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5">
                    <Link href={`/providers/${p.id}`} className="font-medium text-slate-900 hover:text-teal-800 hover:underline">
                      {p.displayName}
                    </Link>
                    {p.physicalState && <div className="text-xs text-slate-500">Works from {p.physicalState}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">{PROFESSION_LABEL[p.profession as Profession]}</td>
                  <td className="px-3 py-2.5 text-slate-600">{p.siteCodes.join(", ") || "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {p.verifiedStates.length ? (
                        p.verifiedStates.map((s) => (
                          <Badge key={s} tone="green">
                            {s}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">None</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {p.suspended > 0 && <Badge tone="red">{p.suspended} suspended/revoked</Badge>}
                      {p.expired > 0 && <Badge tone="red">{p.expired} expired</Badge>}
                      {p.expiringSoon > 0 && <Badge tone="amber">{p.expiringSoon} expiring ≤90 d</Badge>}
                      {p.pendingReview > 0 && <Badge tone="amber">{p.pendingReview} awaiting verification</Badge>}
                      {!p.suspended && !p.expired && !p.expiringSoon && !p.pendingReview && <span className="text-xs text-slate-500">None</span>}
                    </div>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{p.enrollmentsReady}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

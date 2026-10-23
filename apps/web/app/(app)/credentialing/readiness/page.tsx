import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { getReadinessMatrix } from "@projectos/credentialing";
import { hasAny } from "@projectos/auth";
import { MODALITIES, MODALITY_LABEL, PROFESSIONS, PROFESSION_LABEL, type Profession } from "@projectos/shared";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { PAYER_LABEL, PAYER_TONE, formatDate, formatInstant } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { ReadinessCell } from "@/components/credentialing/Badges";

export const metadata: Metadata = { title: "Readiness Matrix" };

export default async function ReadinessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "credentialing.read")) return <Forbidden what="credentialing readiness" />;
  const sp = await searchParams;
  const q = {
    modality: MODALITIES.includes(sp.modality as never) ? sp.modality : "VIDEO",
    date: /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date : undefined,
    profession: PROFESSIONS.includes(sp.profession as Profession) ? sp.profession : undefined,
  };
  const m = await load(getReadinessMatrix(getDb(), ctx, Object.fromEntries(Object.entries(q).filter(([, v]) => v))));
  const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";
  return (
    <div className="space-y-5">
      <PageHeader
        title="Readiness matrix"
        description={
          <>
            Provider × patient location for {MODALITY_LABEL[m.modality]} on {formatDate(m.date)}, computed at {formatInstant(m.computedAt)} from {m.rulesConsidered} approved
            rule(s) and verified evidence only. Unknown is never shown as eligible.
          </>
        }
      />
      {m.demoRulesInUse && (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-900">
          DEMO SYNTHETIC POLICY — NOT VERIFIED LAW. These rules exist for demonstration and automated tests only.
        </p>
      )}
      <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Readiness filters">
        <div>
          <label htmlFor="rf-mod" className="block text-xs font-medium text-slate-600">
            Modality
          </label>
          <select id="rf-mod" name="modality" defaultValue={m.modality} className={sel}>
            {MODALITIES.map((x) => (
              <option key={x} value={x}>
                {MODALITY_LABEL[x]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rf-date" className="block text-xs font-medium text-slate-600">
            Visit date
          </label>
          <input id="rf-date" type="date" name="date" defaultValue={m.date} className={sel} />
        </div>
        <div>
          <label htmlFor="rf-prof" className="block text-xs font-medium text-slate-600">
            Profession
          </label>
          <select id="rf-prof" name="profession" defaultValue={q.profession ?? ""} className={sel}>
            <option value="">All</option>
            {PROFESSIONS.map((p) => (
              <option key={p} value={p}>
                {PROFESSION_LABEL[p]}
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
        <Link href="/credentialing/readiness" className="px-2 py-2 text-sm text-slate-600 hover:underline">
          Reset
        </Link>
      </form>

      <Card>
        <CardHeader title="License readiness" description="Columns are the patient's physical location at the time of the visit. Click a status for reasons and evidence." />
        {m.license.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No providers visible" />
          </div>
        ) : (
          <div className="overflow-x-auto p-2">
            <table className="text-left text-[13px]" data-testid="license-matrix">
              <thead>
                <tr className="border-b border-slate-200">
                  <th scope="col" className="px-2 py-2 text-[12px] font-semibold text-slate-600">
                    Provider
                  </th>
                  {m.jurisdictions.map((j) => (
                    <th key={j} scope="col" className="px-2 py-2 text-[12px] font-semibold text-slate-600">
                      {j}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.license.map((row) => (
                  <tr key={row.practitioner.id} className="border-b border-slate-100 align-top">
                    <th scope="row" className="px-2 py-2 font-normal">
                      <Link href={`/providers/${row.practitioner.id}`} className="font-medium text-slate-900 hover:underline">
                        {row.practitioner.displayName}
                      </Link>
                      <div className="text-xs text-slate-500">{PROFESSION_LABEL[row.practitioner.profession as Profession]}</div>
                    </th>
                    {m.jurisdictions.map((j) => (
                      <td key={j} className="px-2 py-2" data-testid={`cell-${row.practitioner.displayName.split(" ")[1]}-${j}`}>
                        <ReadinessCell r={row.cells[j]!} compact />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Payer readiness" description="Separate from licensure: provider × site × plan. A plan approved at one site is not ready at another." />
        {m.payer.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No provider–site affiliations" />
          </div>
        ) : (
          <div className="overflow-x-auto p-2">
            <table className="text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th scope="col" className="px-2 py-2 text-[12px] font-semibold text-slate-600">
                    Provider · site
                  </th>
                  {m.payer[0]!.plans.map((p) => (
                    <th key={p.planId} scope="col" className="px-2 py-2 text-[12px] font-semibold text-slate-600">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.payer.map((row) => (
                  <tr key={row.practitioner.id + row.site.id} className="border-b border-slate-100 align-top">
                    <th scope="row" className="px-2 py-2 font-normal">
                      <span className="font-medium">{row.practitioner.displayName}</span> <span className="text-xs text-slate-500">· {row.site.code}</span>
                    </th>
                    {row.plans.map((p) => (
                      <td key={p.planId} className="px-2 py-2">
                        <Badge tone={PAYER_TONE[p.result.status]}>{PAYER_LABEL[p.result.status]}</Badge>
                        <div className="max-w-40 text-[11px] text-slate-500">{p.result.reasons[0]?.message}</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

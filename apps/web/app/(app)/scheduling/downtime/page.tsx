import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@projectos/db";
import { sites } from "@projectos/db/schema";
import { can, hasAny } from "@projectos/auth";
import { downtimeSchedule } from "@projectos/scheduling";
import { APPOINTMENT_STATUS_LABEL, EHR_STATE_LABEL, type AppointmentStatus } from "@projectos/shared";
import { EmptyState, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { formatInstant } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { PrintButton } from "@/components/scheduling/PrintButton";

export const metadata: Metadata = { title: "Downtime Schedule" };

const time = (iso: string, tz: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

export default async function DowntimePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "scheduling.read")) return <Forbidden what="schedules" />;
  const sp = await searchParams;
  const db = getDb();
  const all = await db
    .select({ id: sites.id, code: sites.code, name: sites.name })
    .from(sites)
    .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.active, true)))
    .orderBy(asc(sites.code));
  const mine = all.filter((s) => can(ctx, "scheduling.read", { siteId: s.id }));
  const siteId = mine.find((s) => s.id === sp.siteId)?.id ?? mine[0]?.id;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date : undefined;
  if (!siteId) return <EmptyState title="No site available" />;
  const d = await load(downtimeSchedule(db, ctx, { siteId, date }));
  const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";
  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          eyebrow="Scheduling · downtime plan"
          title="Paper downtime schedule"
          description="Use when ProjectOS or the EHR is unavailable (docs/compliance/DOWNTIME_PLAN.md). Printing is recorded in the audit log. Shred printed copies at end of day."
          actions={<PrintButton />}
        />
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label="Choose site and date">
          <div>
            <label htmlFor="dt-site" className="block text-xs font-medium text-slate-600">
              Site
            </label>
            <select id="dt-site" name="siteId" defaultValue={siteId} className={sel}>
              {mine.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dt-date" className="block text-xs font-medium text-slate-600">
              Date
            </label>
            <input id="dt-date" type="date" name="date" defaultValue={d.date} className={sel} />
          </div>
          <button type="submit" className="h-9 rounded-md bg-teal-700 px-3 text-sm font-medium text-white">
            Show
          </button>
          <Link href="/scheduling/calendar" className="px-2 py-2 text-sm text-slate-600 hover:underline">
            Back to schedule
          </Link>
        </form>
      </div>
      <section aria-labelledby="dt-title" className="rounded-lg border border-slate-300 bg-white p-4 print:border-0 print:p-0">
        <h2 id="dt-title" className="text-base font-semibold">
          {d.site.code} — {d.site.name} · {d.date} ({d.site.timezone})
        </h2>
        <p className="text-[12px] text-slate-600">
          SYNTHETIC DEMO DATA · Printed {formatInstant(d.printedAt, d.site.timezone)} by {d.printedBy} · Source of truth: {d.site.ehrSyncMode} · {d.rows.length} appointment(s).
          Write changes made during downtime on this sheet and enter them when systems return (EHR first if it is the master).
        </p>
        {d.rows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No appointments for this day.</p>
        ) : (
          <table className="mt-3 w-full border-collapse text-left text-[12.5px]" data-testid="downtime-table">
            <thead>
              <tr className="border-b border-slate-400">
                <th scope="col" className="py-1 pr-2">
                  Time
                </th>
                <th scope="col" className="py-1 pr-2">
                  Provider
                </th>
                <th scope="col" className="py-1 pr-2">
                  Patient (MRN)
                </th>
                <th scope="col" className="py-1 pr-2">
                  Visit
                </th>
                <th scope="col" className="py-1 pr-2">
                  Status
                </th>
                <th scope="col" className="py-1 pr-2">
                  Arrived ☐ / Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-200">
                  <td className="tabular py-1.5 pr-2">{time(r.startAt, d.site.timezone)}</td>
                  <td className="py-1.5 pr-2">{r.provider}</td>
                  <td className="py-1.5 pr-2">
                    {r.patientName} ({r.mrn})
                  </td>
                  <td className="py-1.5 pr-2">
                    {r.type}
                    {r.room ? ` · ${r.room}` : ""}
                  </td>
                  <td className="py-1.5 pr-2">
                    {APPOINTMENT_STATUS_LABEL[r.status as AppointmentStatus] ?? r.status}
                    {r.ehrState !== "NOT_APPLICABLE" ? ` · ${EHR_STATE_LABEL[r.ehrState] ?? r.ehrState}` : ""}
                  </td>
                  <td className="py-1.5 pr-2">☐ ____________</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

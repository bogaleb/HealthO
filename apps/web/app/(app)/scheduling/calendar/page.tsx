import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@projectos/db";
import { hasAny } from "@projectos/auth";
import { getCalendar } from "@projectos/scheduling";
import { addDays, APPOINTMENT_STATUS_LABEL, formatOffset, MODALITY_LABEL, offsetMinutes, todayIn, type AppointmentStatus, type Modality } from "@projectos/shared";
import { Badge, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { APPT_STATUS_TONE, formatDay, formatSlot } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { CalendarGrid } from "@/components/scheduling/CalendarGrid";
import { AppointmentDrawer } from "@/components/scheduling/AppointmentDrawer";
import { DecisionBadge } from "@/components/scheduling/Eligibility";
import { SchedulingDemoNote } from "@/components/scheduling/DemoNote";

export const metadata: Metadata = { title: "Schedule" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "scheduling.read")) return <Forbidden what="schedules" />;
  const sp = await searchParams;
  const db = getDb();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayIn("America/New_York");
  const view = sp.view === "week" ? "week" : "day";
  const cal = await load(getCalendar(db, ctx, { date, view, ...(sp.siteId ? { siteId: sp.siteId } : {}), ...(sp.practitionerId ? { practitionerId: sp.practitionerId } : {}) }));
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { date, view, siteId: sp.siteId, practitionerId: sp.practitionerId, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/scheduling/calendar?${p.toString()}`;
  };
  const step = view === "week" ? 7 : 1;
  const mid = new Date((new Date(cal.from).getTime() + new Date(cal.to).getTime()) / 2);
  const zoneLabel = `${cal.timezone} (${formatSlot(mid, cal.timezone, { date: false }).split(" ").pop()}, ${formatOffset(offsetMinutes(mid, cal.timezone))})`;
  const dstDay = view === "day" && (new Date(cal.to).getTime() - new Date(cal.from).getTime()) / 3_600_000 !== 24;
  const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";
  const canBook = hasAny(ctx, "scheduling.manage") && cal.bookingEnabled;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Schedule"
        description={
          <>
            {view === "day" ? formatDay(cal.dates[0]!) : `Week of ${formatDay(cal.dates[0]!)} – ${formatDay(cal.dates[6]!)}`} ·{" "}
            {cal.site ? `${cal.site.name} (${cal.site.state})` : "All my sites"} · times in <strong>{zoneLabel}</strong>
          </>
        }
        actions={
          canBook ? (
            <div className="flex gap-2">
              <Link href="/scheduling/find" className="inline-flex h-9 items-center rounded-md bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800">
                Find appointment
              </Link>
            </div>
          ) : undefined
        }
      />
      <SchedulingDemoNote bookingEnabled={cal.bookingEnabled} />
      {dstDay && (
        <p role="note" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] text-blue-950">
          Daylight-saving change today: this day is {Math.round((new Date(cal.to).getTime() - new Date(cal.from).getTime()) / 3_600_000)} hours long in {cal.timezone}. Every time
          shows its zone.
        </p>
      )}
      <form method="get" action="/scheduling/calendar" className="flex flex-wrap items-end gap-2" aria-label="Calendar filters">
        <div>
          <label htmlFor="cf-date" className="block text-xs font-medium text-slate-600">
            Date
          </label>
          <input id="cf-date" type="date" name="date" defaultValue={date} className={sel} />
        </div>
        <div>
          <label htmlFor="cf-view" className="block text-xs font-medium text-slate-600">
            View
          </label>
          <select id="cf-view" name="view" defaultValue={view} className={sel}>
            <option value="day">Day (by provider)</option>
            <option value="week">Week</option>
          </select>
        </div>
        <div>
          <label htmlFor="cf-site" className="block text-xs font-medium text-slate-600">
            Site
          </label>
          <select id="cf-site" name="siteId" defaultValue={sp.siteId ?? ""} className={sel}>
            <option value="">All my sites</option>
            {cal.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name} ({s.state})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cf-prov" className="block text-xs font-medium text-slate-600">
            Provider
          </label>
          <select id="cf-prov" name="practitionerId" defaultValue={sp.practitionerId ?? ""} className={sel}>
            <option value="">All providers</option>
            {cal.allPractitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName.replace(/ \(SYNTHETIC\)$/, "")}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="h-9 rounded-md bg-slate-800 px-3 text-sm font-medium text-white hover:bg-slate-900">
          Show
        </button>
        <nav aria-label="Date navigation" className="ml-auto flex gap-1">
          <Link className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm leading-9 hover:bg-slate-50" href={qs({ date: addDays(cal.dates[0]!, -step) })}>
            ← Previous
          </Link>
          <Link className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm leading-9 hover:bg-slate-50" href={qs({ date: todayIn("America/New_York") })}>
            Today
          </Link>
          <Link className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm leading-9 hover:bg-slate-50" href={qs({ date: addDays(cal.dates[0]!, step) })}>
            Next →
          </Link>
        </nav>
      </form>

      <ul className="flex flex-wrap gap-3 text-[12px] text-slate-600" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-slate-300 bg-white" /> Working hours
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-slate-200" /> Not working
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-amber-200" /> Time off / closure
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-dashed border-violet-500 bg-violet-50" /> Temporary hold
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border-l-4 border-blue-600 bg-blue-50" /> Booked
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border-l-4 border-amber-600 bg-amber-50" /> Pending review
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border-l-4 border-red-700 bg-red-50" /> Needs reschedule
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border-l-4 border-teal-600 bg-teal-50" /> Checked in
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border-l-4 border-green-700 bg-green-50" /> Completed
        </li>
      </ul>

      <CalendarGrid cal={cal} apptHref={(id) => qs({ appt: id })} />

      <section aria-labelledby="agenda-h">
        <h2 id="agenda-h" className="text-[15px] font-semibold">
          Agenda ({cal.appointments.length})
        </h2>
        {cal.appointments.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No appointments in this range.</p>
        ) : (
          <table className="mt-2 w-full text-left text-[13px]">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Time ({cal.timezone})</th>
                <th className="py-2 pr-3 font-medium">Patient</th>
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Where</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Eligibility</th>
              </tr>
            </thead>
            <tbody>
              {cal.appointments.map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 tabular-nums">
                    <Link href={qs({ appt: a.id })} scroll={false} className="text-teal-800 hover:underline">
                      {formatSlot(a.startAt, cal.timezone)}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3">{a.patientName}</td>
                  <td className="py-1.5 pr-3">{cal.practitioners.find((p) => p.id === a.practitionerId)?.displayName.replace(/ \(SYNTHETIC\)$/, "")}</td>
                  <td className="py-1.5 pr-3">{a.typeName}</td>
                  <td className="py-1.5 pr-3">
                    {MODALITY_LABEL[a.modality as Modality]} · {a.siteCode}
                    {a.roomCode ? ` ${a.roomCode}` : ""} · patient in {a.patientLocationState ?? "?"}
                  </td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={APPT_STATUS_TONE[a.status]}>{APPOINTMENT_STATUS_LABEL[a.status as AppointmentStatus]}</Badge>
                  </td>
                  <td className="py-1.5 pr-3">
                    <DecisionBadge decision={a.eligibilityDecision as "ALLOW" | "REVIEW" | "BLOCK" | null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <Suspense>
        <AppointmentDrawer />
      </Suspense>
    </div>
  );
}

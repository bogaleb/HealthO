import Link from "next/link";
import { localDate, localTime, minutesOf, APPOINTMENT_STATUS_LABEL, MODALITY_LABEL, type AppointmentStatus, type Modality } from "@projectos/shared";
import { cn } from "@projectos/ui";
import { formatDay, formatSlot } from "@/lib/format";

type Cal = {
  view: "day" | "week";
  timezone: string;
  dates: string[];
  practitioners: { id: string; displayName: string; profession: string }[];
  appointments: {
    id: string;
    practitionerId: string;
    status: string;
    modality: string;
    startAt: Date | string;
    endAt: Date | string;
    patientName: string;
    typeName: string;
    roomCode: string | null;
    siteCode: string;
  }[];
  holds: { id: string; practitionerId: string; startAt: Date | string; endAt: Date | string; expiresAt: Date | string }[];
  exceptions: { id: string; kind: string; practitionerId: string | null; siteId: string | null; startAt: Date | string; endAt: Date | string; reason: string }[];
  workingBlocks: { practitionerId: string; siteId: string; siteCode: string; start: Date | string; end: Date | string; date: string }[];
  sites: { id: string; code: string }[];
};

const PX = 1.1; // pixels per minute
const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: "border-blue-600 bg-blue-50 text-blue-950",
  PENDING: "border-amber-600 border-dashed bg-amber-50 text-amber-950",
  CHECKED_IN: "border-teal-600 bg-teal-50 text-teal-950",
  COMPLETED: "border-green-700 bg-green-50 text-green-950",
  NO_SHOW: "border-red-600 bg-red-50 text-red-950",
  NEEDS_RESCHEDULE: "border-red-700 bg-red-50 text-red-950 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_6px,#fecaca_6px,#fecaca_8px)]",
};

const d = (x: Date | string) => (typeof x === "string" ? new Date(x) : x);

/** Lay overlapping items side by side (greedy lanes per overlapping cluster). */
function lanes<T extends { s: number; e: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  const out: (T & { lane: number; lanes: number })[] = [];
  let cluster: (T & { lane: number; lanes: number })[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const n = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) => (c.lanes = n));
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (it.s >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return out;
}

export function CalendarGrid({ cal, apptHref }: { cal: Cal; apptHref: (id: string) => string }) {
  const tz = cal.timezone;
  // Local minutes since midnight on the column's date (clamped to that date for multi-day exceptions).
  const minuteIn = (x: Date | string, date: string, edge: "s" | "e") => {
    const dd = d(x);
    const ld = localDate(dd, tz);
    if (ld < date) return 0;
    if (ld > date) return 24 * 60;
    const m = minutesOf(localTime(dd, tz));
    return edge === "e" && m === 0 ? 24 * 60 : m;
  };
  const columns =
    cal.view === "day"
      ? cal.practitioners
          .filter((p) => cal.workingBlocks.some((b) => b.practitionerId === p.id) || cal.appointments.some((a) => a.practitionerId === p.id))
          .map((p) => ({ key: p.id, title: p.displayName, sub: p.profession, date: cal.dates[0]!, prac: p.id as string | null }))
      : cal.dates.map((date) => ({ key: date, title: formatDay(date), sub: "", date, prac: cal.practitioners.length === 1 ? cal.practitioners[0]!.id : null }));
  const names = new Map(cal.practitioners.map((p) => [p.id, p.displayName.replace(/ \(SYNTHETIC\)$/, "")]));

  const allMinutes: number[] = [];
  for (const c of columns) {
    for (const b of cal.workingBlocks.filter((b) => b.date === c.date && (!c.prac || b.practitionerId === c.prac)))
      allMinutes.push(minuteIn(b.start, c.date, "s"), minuteIn(b.end, c.date, "e"));
    for (const a of cal.appointments.filter((a) => localDate(d(a.startAt), tz) === c.date)) allMinutes.push(minuteIn(a.startAt, c.date, "s"), minuteIn(a.endAt, c.date, "e"));
  }
  const startMin = Math.min(7 * 60, ...allMinutes.map((m) => Math.floor(m / 60) * 60));
  const endMin = Math.max(19 * 60, ...allMinutes.map((m) => Math.ceil(m / 60) * 60));
  const height = (endMin - startMin) * PX;
  const top = (m: number) => (Math.max(m, startMin) - startMin) * PX;
  const hours = Array.from({ length: (endMin - startMin) / 60 + 1 }, (_, i) => startMin + i * 60);

  if (!columns.length)
    return (
      <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No provider works at this site on this day and nothing is booked.</p>
    );

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white" role="region" aria-label="Schedule grid">
      <div className="flex min-w-max">
        <div className="sticky left-0 z-10 w-16 shrink-0 border-r border-slate-200 bg-white">
          <div className="h-12 border-b border-slate-200" />
          <div className="relative" style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1.5 -translate-y-2 text-[11px] tabular-nums text-slate-500" style={{ top: top(h) }}>
                {new Date(Date.UTC(2000, 0, 1, Math.floor(h / 60))).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric" })}
              </div>
            ))}
          </div>
        </div>
        {columns.map((c) => {
          const blocks = cal.workingBlocks.filter((b) => b.date === c.date && (!c.prac || b.practitionerId === c.prac));
          // Provider time off shows only in that provider's column (or a single-provider week); a closure shows where the
          // column's provider works at that site that day, or in an all-provider week view (labelled with the site).
          const exc = cal.exceptions.filter((e) => {
            const onDay = localDate(d(e.startAt), tz) <= c.date && localDate(d(e.endAt), tz) >= c.date && minuteIn(e.endAt, c.date, "e") > minuteIn(e.startAt, c.date, "s");
            if (!onDay) return false;
            if (e.kind === "CLOSURE") return !c.prac || blocks.some((b) => b.siteId === e.siteId);
            return !!c.prac && e.practitionerId === c.prac;
          });
          const siteCodeOf = (id: string | null) => cal.sites.find((s) => s.id === id)?.code ?? "";
          const items = lanes([
            ...cal.appointments
              .filter((a) => localDate(d(a.startAt), tz) === c.date && (!c.prac || a.practitionerId === c.prac))
              .map((a) => ({ kind: "appt" as const, a, s: minuteIn(a.startAt, c.date, "s"), e: minuteIn(a.endAt, c.date, "e") })),
            ...cal.holds
              .filter((h) => localDate(d(h.startAt), tz) === c.date && (!c.prac || h.practitionerId === c.prac))
              .map((h) => ({ kind: "hold" as const, h, s: minuteIn(h.startAt, c.date, "s"), e: minuteIn(h.endAt, c.date, "e") })),
          ]);
          return (
            <div key={c.key} className="w-48 shrink-0 border-r border-slate-200 last:border-r-0" data-testid={`cal-col-${c.key}`}>
              <div className="flex h-12 flex-col justify-center border-b border-slate-200 px-2">
                <div className="truncate text-[13px] font-semibold" title={c.title}>
                  {c.title.replace(/ \(SYNTHETIC\)$/, "")}
                </div>
                {c.sub && <div className="truncate text-[11px] text-slate-500">{c.sub}</div>}
              </div>
              <div className="relative bg-slate-100" style={{ height }}>
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-slate-200/80" style={{ top: top(h) }} />
                ))}
                {blocks.map((b, i) => (
                  <div
                    key={i}
                    className="absolute inset-x-0 bg-white"
                    style={{ top: top(minuteIn(b.start, c.date, "s")), height: (minuteIn(b.end, c.date, "e") - minuteIn(b.start, c.date, "s")) * PX }}
                    title={`Working hours at ${b.siteCode}`}
                  >
                    <span className="absolute right-1 top-0.5 text-[10px] text-slate-400">{b.siteCode}</span>
                  </div>
                ))}
                {exc.map((e) => {
                  const s = minuteIn(e.startAt, c.date, "s");
                  const en = minuteIn(e.endAt, c.date, "e");
                  return (
                    <div
                      key={e.id}
                      className="absolute inset-x-0 z-[1] border-y border-amber-300 bg-[repeating-linear-gradient(45deg,#fef3c7_0,#fef3c7_6px,#fde68a_6px,#fde68a_12px)] px-1.5 text-[11px] font-medium text-amber-900"
                      style={{ top: top(s), height: Math.max(16, (Math.min(en, endMin) - Math.max(s, startMin)) * PX) }}
                    >
                      {e.kind === "CLOSURE" ? `${siteCodeOf(e.siteId)} closed` : e.kind === "PTO" ? "Time off" : "Blocked"} — {e.reason}
                    </div>
                  );
                })}
                {items.map((it) => {
                  const style = {
                    top: top(it.s),
                    height: Math.max(18, (it.e - it.s) * PX - 2),
                    left: `calc(${(it.lane / it.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / it.lanes}% - 4px)`,
                  };
                  if (it.kind === "hold")
                    return (
                      <div key={it.h.id} className="absolute z-[2] rounded border border-dashed border-violet-500 bg-violet-50 px-1.5 text-[11px] text-violet-900" style={style}>
                        Hold · expires {formatSlot(it.h.expiresAt, tz, { date: false })}
                      </div>
                    );
                  const a = it.a;
                  const label = `${APPOINTMENT_STATUS_LABEL[a.status as AppointmentStatus] ?? a.status}: ${a.typeName}, ${a.patientName}, ${formatSlot(a.startAt, tz)}, ${MODALITY_LABEL[a.modality as Modality]}${
                    cal.view === "week" ? `, ${names.get(a.practitionerId)}` : ""
                  }`;
                  return (
                    <Link
                      key={a.id}
                      href={apptHref(a.id)}
                      scroll={false}
                      aria-label={label}
                      title={label}
                      data-testid={`appt-${a.id}`}
                      className={cn(
                        "absolute z-[3] overflow-hidden rounded border-l-4 px-1.5 py-0.5 text-[11px] leading-tight shadow-sm hover:ring-2 hover:ring-teal-500 focus-visible:ring-2 focus-visible:ring-teal-600",
                        STATUS_STYLE[a.status] ?? "border-slate-500 bg-white",
                      )}
                      style={style}
                    >
                      <span className="block truncate">
                        <span className="font-semibold">{formatSlot(a.startAt, tz, { date: false }).replace(/ [A-Z]{3,4}$/, "")}</span>{" "}
                        {a.patientName.replace(/ \(SYNTHETIC\)$/, "")}
                      </span>
                      <span className={cn("block truncate text-[10.5px] opacity-80", (it.e - it.s) * PX < 34 && "sr-only")}>
                        {a.typeName} · {a.modality === "IN_PERSON" ? (a.roomCode ?? a.siteCode) : MODALITY_LABEL[a.modality as Modality]}
                        {cal.view === "week" && !c.prac ? ` · ${names.get(a.practitionerId)}` : ""}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

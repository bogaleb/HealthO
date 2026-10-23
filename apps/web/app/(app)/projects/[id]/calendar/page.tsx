import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { getCalendar } from "@projectos/core";
import { TASK_STATUS_LABEL, todayIn, type TaskStatus } from "@projectos/shared";
import { cn } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";

export const metadata: Metadata = { title: "Calendar" };

const pad = (n: number) => String(n).padStart(2, "0");
const STATUS_DOT: Record<string, string> = {
  TODO: "bg-slate-400",
  IN_PROGRESS: "bg-sky-500",
  IN_REVIEW: "bg-violet-500",
  BLOCKED: "bg-red-500",
  DONE: "bg-emerald-500",
  CANCELLED: "bg-slate-300",
};

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  const today = todayIn("America/New_York");
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${pad(daysInMonth)}`;
  const tasks = await load(getCalendar(getDb(), ctx, id, from, to));
  const byDay = new Map<string, typeof tasks>();
  for (const t of tasks) byDay.set(t.dueDate!, [...(byDay.get(t.dueDate!) ?? []), t]);
  const lead = first.getUTCDay();
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  const title = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Link href={`?month=${prev}`} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50" aria-label="Previous month">
          ←
        </Link>
        <h2 className="w-44 text-center text-[15px] font-semibold">{title}</h2>
        <Link href={`?month=${next}`} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50" aria-label="Next month">
          →
        </Link>
        <Link href="?" className="ml-2 text-sm text-teal-700 hover:underline">
          Today
        </Link>
        <span className="ml-auto text-[12.5px] text-slate-500">Tasks shown on their due date (date-only, no time-zone shift). {tasks.length} this month.</span>
      </div>
      <div role="grid" aria-label={`Tasks due in ${title}`} className="grid grid-cols-7 overflow-hidden rounded-2xl border border-[var(--hairline)] bg-slate-200 [gap:1px]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} role="columnheader" className="bg-slate-50 px-2 py-1.5 text-[12px] font-semibold text-slate-600">
            {d}
          </div>
        ))}
        {cells.map((d, i) => (
          <div key={i} role="gridcell" aria-label={d ?? undefined} className={cn("min-h-28 bg-white p-1.5", !d && "bg-slate-50")}>
            {d && (
              <>
                <div className={cn("tabular mb-1 text-[12px]", d === today ? "inline-block rounded-full bg-teal-700 px-1.5 font-semibold text-white" : "text-slate-500")}>
                  {Number(d.slice(8))}
                </div>
                <ul className="space-y-1">
                  {(byDay.get(d) ?? []).map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`?month=${month}&task=${t.id}`}
                        scroll={false}
                        className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[12px] hover:bg-slate-100"
                        title={`${t.projectKey}-${t.number} ${t.title}`}
                      >
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[t.status])} aria-hidden />
                        <span className="sr-only">{TASK_STATUS_LABEL[t.status as TaskStatus]}:</span>
                        <span className={cn("truncate", t.status === "DONE" && "text-slate-500 line-through")}>{t.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

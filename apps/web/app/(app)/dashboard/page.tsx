import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { canSeeReports, getOperationsDashboard } from "@projectos/reports";
import { PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { Forbidden } from "@/components/Forbidden";
import { Freshness } from "@/components/reports/Freshness";
import { ReportFilterForm, pickReportFilters } from "@/components/reports/ReportFilters";
import { CountUp } from "@/components/motion/CountUp";

export const metadata: Metadata = { title: "Operations Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!canSeeReports(ctx)) return <Forbidden what="reports" />;
  const filters = pickReportFilters(await searchParams);
  const d = await getOperationsDashboard(getDb(), ctx, filters);
  const qs = new URLSearchParams(filters).toString();
  return (
    <div>
      <PageHeader
        title="Operations dashboard"
        description="Every tile is one SQL query over the records you are permitted to see; its number links to exactly those rows, with the same filters."
      />
      <ReportFilterForm ctx={ctx} values={filters} action="/dashboard" />
      <Freshness computedAt={d.freshness.computedAt} timezone={d.filters.timezone} today={d.filters.today} ehrNotCurrent={d.freshness.ehrNotCurrent} />
      <div className="space-y-9">
        {d.domains.map((dom) => (
          <section key={dom.domain} aria-labelledby={`dom-${dom.domain}`}>
            <h2 id={`dom-${dom.domain}`} className="mb-3 text-[16px] font-semibold tracking-[-0.015em] text-slate-800">
              {dom.label}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {dom.tiles.map((t, i) => (
                <Link
                  key={t.key}
                  href={`/reports/${t.key}${qs ? `?${qs}` : ""}`}
                  className="rise lift group relative block overflow-hidden rounded-2xl border border-[var(--hairline)] bg-white p-5 shadow-[var(--shadow-card)]"
                  style={{ ["--i" as string]: i }}
                  data-testid={`tile-${t.key}`}
                >
                  <span
                    aria-hidden
                    className="pearl-bg absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 transition-transform duration-700 [transition-timing-function:var(--ease-out-expo)] group-hover:scale-x-100"
                  />
                  <div className="text-[13px] font-medium text-slate-600">{t.label}</div>
                  <div
                    className={`tabular mt-2 text-[36px] font-[340] leading-none tracking-[-0.03em] ${t.attention && t.value > 0 ? "text-amber-800" : "display-title"}`}
                    data-testid="tile-value"
                  >
                    <CountUp value={t.value} delay={i * 70 + 150} />
                  </div>
                  <div className="mt-1 text-[11.5px] leading-snug text-slate-500">{t.definition}</div>
                  {(t.dateBasis || t.ignored.length > 0) && (
                    <div className="mt-1.5 text-[11px] text-slate-500">
                      {t.dateBasis && t.applied.from && (
                        <span>
                          {t.dateBasis}: {String(t.applied.from)} → {String(t.applied.to)}.{" "}
                        </span>
                      )}
                      {t.ignored.length > 0 && <span>Not filtered by {t.ignored.join(", ")}.</span>}
                    </div>
                  )}
                  <span className="sr-only">— view the {t.value} records</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
        {d.hiddenDomains.length > 0 && <p className="text-xs text-slate-500">Not shown (your role has no access): {d.hiddenDomains.join(", ")}.</p>}
      </div>
    </div>
  );
}

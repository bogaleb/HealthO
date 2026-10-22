import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { getMetricReport } from "@projectos/reports";
import { Badge, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { formatDate, formatInstant, formatMoney, humanize } from "@/lib/format";
import { Freshness } from "@/components/reports/Freshness";
import { ReportFilterForm, pickReportFilters } from "@/components/reports/ReportFilters";

export const metadata: Metadata = { title: "Report" };

function Cell({ kind, value, tz }: { kind?: string; value: unknown; tz: string }) {
  if (value === null || value === undefined || value === "") return <span className="text-slate-400">—</span>;
  if (kind === "date") return <span className="tabular">{formatDate(String(value))}</span>;
  if (kind === "instant") return <span className="tabular">{formatInstant(String(value), tz)}</span>;
  if (kind === "money") return <span className="tabular">{formatMoney(Number(value))}</span>;
  if (kind === "badge") return <Badge>{humanize(String(value))}</Badge>;
  return <>{String(value)}</>;
}

export default async function MetricPage({ params, searchParams }: { params: Promise<{ metric: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  const { metric } = await params;
  const sp = await searchParams;
  const filters = pickReportFilters(sp);
  const page = /^\d{1,4}$/.test(sp.page ?? "") ? sp.page! : "1";
  const r = await load(getMetricReport(getDb(), ctx, metric, { ...filters, page }));
  const qs = (p: number) => new URLSearchParams({ ...filters, page: String(p) }).toString();
  const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
  const firstLink = r.metric.columns[0]?.key;
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link href="/reports" className="text-teal-800 hover:underline">
          Reports
        </Link>
        <span className="text-slate-400"> / </span>
        <span>{r.metric.domainLabel}</span>
      </nav>
      <PageHeader
        title={
          <span>
            {r.metric.label}:{" "}
            <span className="tabular" data-testid="report-total">
              {r.total}
            </span>
          </span>
        }
        description={r.metric.definition}
      />
      <dl className="mb-4 grid gap-x-6 gap-y-1 text-[12.5px] text-slate-600 sm:grid-cols-3">
        <div>
          <dt className="inline font-semibold">Source: </dt>
          <dd className="inline">{r.metric.source}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Filters applied: </dt>
          <dd className="inline">
            {Object.keys(r.filters.applied).length
              ? Object.entries(r.filters.applied)
                  .map(([k, v]) => `${k}=${k.endsWith("Id") ? "selected" : String(v)}`)
                  .join(", ")
              : "none"}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">Ignored (not applicable): </dt>
          <dd className="inline">{r.filters.ignored.length ? r.filters.ignored.join(", ") : "none"}</dd>
        </div>
      </dl>
      <ReportFilterForm ctx={ctx} values={filters} action={`/reports/${metric}`} />
      <Freshness
        computedAt={r.freshness.computedAt}
        timezone={r.filters.timezone}
        today={r.filters.today}
        sourceUpdatedAt={r.freshness.sourceUpdatedAt}
        ehrNotCurrent={r.freshness.ehrNotCurrent}
      />
      {r.rows.length === 0 ? (
        <EmptyState title="No matching records" description="Nothing meets this definition with the current filters." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-[13px]" data-testid="report-table">
            <caption className="sr-only">
              {r.metric.label} — {r.total} rows
            </caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                {r.metric.columns.map((c) => (
                  <th key={c.key} scope="col" className={`px-3 py-2 ${c.kind === "money" ? "text-right" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.rows.map((row) => (
                <tr key={String(row.id)}>
                  {r.metric.columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.kind === "money" ? "text-right" : ""}`}>
                      {c.key === firstLink && typeof row.link === "string" ? (
                        <Link href={row.link} className="whitespace-nowrap font-medium text-teal-800 hover:underline">
                          <Cell kind={c.kind} value={row[c.key]} tz={r.filters.timezone} />
                        </Link>
                      ) : (
                        <Cell kind={c.kind} value={row[c.key]} tz={r.filters.timezone} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-3 flex items-center gap-3 text-sm">
          {r.page > 1 && <Link href={`/reports/${metric}?${qs(r.page - 1)}`}>← Previous</Link>}
          <span className="text-slate-500">
            Page {r.page} of {pages} · {r.total} rows
          </span>
          {r.page < pages && <Link href={`/reports/${metric}?${qs(r.page + 1)}`}>Next →</Link>}
        </nav>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { canSeeReports, listMetricDefinitions } from "@projectos/reports";
import { Badge, PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { Forbidden } from "@/components/Forbidden";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireContext();
  if (!canSeeReports(ctx)) return <Forbidden what="reports" />;
  const defs = listMetricDefinitions(ctx);
  const domains = [...new Set(defs.map((d) => d.domainLabel))];
  return (
    <div>
      <PageHeader
        title="Reports"
        description="KPI detail pages. Each report states its definition, source tables, which filters apply and when it was computed."
        actions={
          <Link href="/dashboard" className="text-sm font-medium text-teal-700 hover:underline">
            Operations dashboard →
          </Link>
        }
      />
      <div className="space-y-6">
        {domains.map((dom) => (
          <section key={dom} aria-labelledby={`r-${dom}`}>
            <h2 id={`r-${dom}`} className="mb-2 text-[15px] font-semibold">
              {dom}
            </h2>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {defs
                .filter((d) => d.domainLabel === dom)
                .map((d) => (
                  <li key={d.key}>
                    <Link href={`/reports/${d.key}`} className="block px-4 py-3 hover:bg-slate-50">
                      <span className="font-medium text-teal-800">{d.label}</span>
                      <span className="mt-0.5 block text-[13px] text-slate-600">{d.definition}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge>Source: {d.source}</Badge>
                        {d.dateBasis && <Badge tone="blue">Date: {d.dateBasis}</Badge>}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

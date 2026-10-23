import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@projectos/db";
import { departments, practitioners, sites } from "@projectos/db/schema";
import { hasAny, type AuthContext } from "@projectos/auth";

export const REPORT_FILTER_KEYS = ["siteId", "departmentId", "practitionerId", "from", "to"] as const;

/** Keep only well-formed filter values from the URL (UUIDs and ISO dates — never free text/PHI). */
export function pickReportFilters(sp: Record<string, string | undefined>) {
  const out: Record<string, string> = {};
  for (const k of REPORT_FILTER_KEYS) {
    const v = sp[k];
    if (!v) continue;
    if ((k === "from" || k === "to") && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v;
    else if (k !== "from" && k !== "to" && /^[0-9a-f-]{36}$/i.test(v)) out[k] = v;
  }
  return out;
}

export async function ReportFilterForm({ ctx, values, action, extra }: { ctx: AuthContext; values: Record<string, string>; action: string; extra?: Record<string, string> }) {
  const db = getDb();
  const showProvider = hasAny(ctx, "scheduling.read") || hasAny(ctx, "credentialing.read");
  const [siteRows, deptRows, provRows] = await Promise.all([
    db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.organizationId, ctx.organizationId)).orderBy(asc(sites.name)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.organizationId, ctx.organizationId)).orderBy(asc(departments.name)),
    showProvider
      ? db
          .select({ id: practitioners.id, name: practitioners.displayName })
          .from(practitioners)
          .where(eq(practitioners.organizationId, ctx.organizationId))
          .orderBy(asc(practitioners.displayName))
      : Promise.resolve([]),
  ]);
  const sel = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-2" aria-label="Report filters">
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div>
        <label htmlFor="rf-site" className="block text-xs font-medium text-slate-600">
          Site
        </label>
        <select id="rf-site" name="siteId" defaultValue={values.siteId ?? ""} className={sel}>
          <option value="">All sites</option>
          {siteRows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="rf-dept" className="block text-xs font-medium text-slate-600">
          Department
        </label>
        <select id="rf-dept" name="departmentId" defaultValue={values.departmentId ?? ""} className={sel}>
          <option value="">All departments</option>
          {deptRows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {showProvider && (
        <div>
          <label htmlFor="rf-prov" className="block text-xs font-medium text-slate-600">
            Provider
          </label>
          <select id="rf-prov" name="practitionerId" defaultValue={values.practitionerId ?? ""} className={sel}>
            <option value="">All providers</option>
            {provRows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="rf-from" className="block text-xs font-medium text-slate-600">
          From
        </label>
        <input id="rf-from" type="date" name="from" defaultValue={values.from ?? ""} className={sel} />
      </div>
      <div>
        <label htmlFor="rf-to" className="block text-xs font-medium text-slate-600">
          To
        </label>
        <input id="rf-to" type="date" name="to" defaultValue={values.to ?? ""} className={sel} />
      </div>
      <button
        type="submit"
        className="press sheen h-9 rounded-full bg-ink-900 px-4 text-sm font-medium text-white shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_8px_20px_-10px_rgb(43_51_105/0.55)] hover:bg-ink-800"
      >
        Apply
      </button>
      <Link href={action} className="px-2 py-2 text-sm text-slate-600 hover:underline">
        Clear
      </Link>
      <p className="w-full text-xs text-slate-500">
        Date range applies only to metrics with a date basis (each tile says which); other filters apply where the metric supports them.
      </p>
    </form>
  );
}

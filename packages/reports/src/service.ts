import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@projectos/db";
import { organizations, sites } from "@projectos/db/schema";
import { hasAny, type AuthContext } from "@projectos/auth";
import { audit, authorize, parse } from "@projectos/core";
import { siteScope } from "@projectos/scheduling";
import { AppError, notFound, todayIn } from "@projectos/shared";
import { DOMAIN_LABEL, FILTER_KEYS, METRICS, METRIC_BY_KEY, reportFilters, type Domain, type FilterKey, type MetricDef, type ResolvedFilters } from "./metrics";

const REPORT_PERMS = ["scheduling.read", "credentialing.read", "rcm.read", "projects.read"] as const;

export function canSeeReports(ctx: AuthContext) {
  return REPORT_PERMS.some((p) => hasAny(ctx, p));
}

async function resolve(db: Db, ctx: AuthContext, input: unknown, now?: Date) {
  const f = parse(reportFilters, input ?? {});
  const [o] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.organizationId));
  const timezone = o?.tz ?? "America/New_York";
  const at = now ?? new Date();
  return { ...f, today: todayIn(timezone, at), timezone, now: at } satisfies ResolvedFilters;
}

/** Fill the metric's default date window and report which filters applied, which were ignored. */
function applyDefaults(m: MetricDef, f: ResolvedFilters) {
  const r: ResolvedFilters = { ...f };
  if (m.dateBasis) {
    r.from = f.from ?? m.dateBasis.defaultFrom?.(f.today) ?? f.today;
    r.to = f.to ?? m.dateBasis.defaultTo?.(f.today) ?? f.today;
  } else {
    delete r.from;
    delete r.to;
  }
  for (const k of FILTER_KEYS) if (!m.supports.includes(k) && k !== "from" && k !== "to") delete r[k];
  const given = FILTER_KEYS.filter((k) => f[k] !== undefined);
  const applied = FILTER_KEYS.filter((k) => r[k] !== undefined && m.supports.includes(k));
  const ignored = given.filter((k) => !m.supports.includes(k)) as FilterKey[];
  return { r, applied, ignored };
}

/**
 * Sites whose master schedule lives in an EHR and is not freshly synced: scheduling counts then reflect
 * ProjectOS records only. Shown as a freshness warning, never hidden.
 */
async function ehrWarnings(db: Db, ctx: AuthContext, now: Date) {
  const scope = siteScope(ctx, "scheduling.read");
  const rows = await db
    .select({ id: sites.id, name: sites.name, mode: sites.ehrSyncMode, last: sites.ehrLastSyncedAt, fresh: sites.ehrFreshnessMinutes })
    .from(sites)
    .where(
      and(
        eq(sites.organizationId, ctx.organizationId),
        inArray(sites.ehrSyncMode, ["EHR_MASTER", "READ_ONLY"]),
        scope ? (scope.length ? inArray(sites.id, scope) : sql`false`) : undefined,
      ),
    );
  return rows
    .filter((s) => !s.last || now.getTime() - s.last.getTime() > s.fresh * 60_000)
    .map((s) => ({ siteId: s.id, site: s.name, mode: s.mode, lastSyncedAt: s.last?.toISOString() ?? null }));
}

function meta(m: MetricDef) {
  return {
    key: m.key,
    label: m.label,
    domain: m.domain,
    domainLabel: DOMAIN_LABEL[m.domain],
    definition: m.definition,
    source: m.source,
    supports: m.supports,
    dateBasis: m.dateBasis?.label ?? null,
    attention: !!m.attention,
  };
}

/** One metric with its source rows (paged). The `total` comes from the same query as the rows. */
export async function getMetricReport(db: Db, ctx: AuthContext, key: string, query: Record<string, unknown> = {}, opts: { now?: Date } = {}) {
  const m = METRIC_BY_KEY.get(key);
  if (!m) throw notFound("Report");
  await authorize(db, ctx, m.permission, "ANY", { action: "report.read", resourceType: "report" });
  const page = parse(z.coerce.number().int().min(1).max(1000).default(1), query.page);
  const pageSize = 50;
  const { page: _p, ...filters } = query;
  const base = await resolve(db, ctx, filters, opts.now);
  const { r, applied, ignored } = applyDefaults(m, base);
  const result = await m.rows(db, ctx, r, { limit: pageSize, offset: (page - 1) * pageSize });
  // Past the last page the window count is unavailable; recompute it from the first row of the same query.
  const totalRows = result.rows.length || page === 1 ? result.total : (await m.rows(db, ctx, r, { limit: 1, offset: 0 })).total;
  const [sourceUpdatedAt, ehr] = await Promise.all([m.sourceUpdatedAt(db, ctx), m.domain === "SCHEDULING" ? ehrWarnings(db, ctx, base.now) : Promise.resolve([])]);
  await audit(db, ctx, { action: "report.read", resourceType: "report", metadata: { metric: m.key, filters: applied, page } });
  return {
    metric: { ...meta(m), columns: m.columns },
    total: totalRows,
    page,
    pageSize,
    rows: result.rows,
    filters: { applied: Object.fromEntries(applied.map((k) => [k, r[k]])), ignored, today: base.today, timezone: base.timezone },
    freshness: { computedAt: new Date().toISOString(), mode: "LIVE_QUERY" as const, sourceUpdatedAt, ehrNotCurrent: ehr },
  };
}

/** Operations dashboard: every metric the caller may see, computed live with the same queries as the drill-downs. */
export async function getOperationsDashboard(db: Db, ctx: AuthContext, query: Record<string, unknown> = {}, opts: { now?: Date } = {}) {
  if (!canSeeReports(ctx)) throw new AppError("FORBIDDEN", "Your role doesn't include any reporting area.");
  const base = await resolve(db, ctx, query, opts.now);
  const visible = METRICS.filter((m) => hasAny(ctx, m.permission));
  const tiles = await Promise.all(
    visible.map(async (m) => {
      const { r, applied, ignored } = applyDefaults(m, base);
      const { total } = await m.rows(db, ctx, r, { limit: 1, offset: 0 });
      return { ...meta(m), value: total, applied: Object.fromEntries(applied.map((k) => [k, r[k]])), ignored };
    }),
  );
  const ehr = visible.some((m) => m.domain === "SCHEDULING") ? await ehrWarnings(db, ctx, base.now) : [];
  const domains = (["SCHEDULING", "CREDENTIALING", "RCM", "PROJECTS"] as Domain[])
    .map((d) => ({ domain: d, label: DOMAIN_LABEL[d], tiles: tiles.filter((t) => t.domain === d) }))
    .filter((d) => d.tiles.length);
  return {
    domains,
    filters: { given: Object.fromEntries(FILTER_KEYS.filter((k) => base[k] !== undefined).map((k) => [k, base[k]])), today: base.today, timezone: base.timezone },
    freshness: { computedAt: new Date().toISOString(), mode: "LIVE_QUERY" as const, ehrNotCurrent: ehr },
    hiddenDomains: (["SCHEDULING", "CREDENTIALING", "RCM", "PROJECTS"] as Domain[]).filter((d) => !domains.some((x) => x.domain === d)).map((d) => DOMAIN_LABEL[d]),
  };
}

export function listMetricDefinitions(ctx: AuthContext) {
  return METRICS.filter((m) => hasAny(ctx, m.permission)).map(meta);
}

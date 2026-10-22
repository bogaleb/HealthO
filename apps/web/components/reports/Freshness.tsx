import { formatInstant } from "@/lib/format";

/** Data-freshness banner: when the numbers were computed, from what, and any source known not to be current. */
export function Freshness({
  computedAt,
  timezone,
  today,
  sourceUpdatedAt,
  ehrNotCurrent,
}: {
  computedAt: string;
  timezone: string;
  today: string;
  sourceUpdatedAt?: string | null;
  ehrNotCurrent: { site: string; mode: string; lastSyncedAt: string | null }[];
}) {
  return (
    <div role="note" className="mb-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-[12.5px] text-slate-600" data-testid="freshness">
      <span className="font-semibold text-slate-800">Live SQL</span> computed {formatInstant(computedAt, timezone)} · “today” = {today} ({timezone})
      {sourceUpdatedAt !== undefined && <> · source last changed {sourceUpdatedAt ? formatInstant(sourceUpdatedAt, timezone) : "never"}</>} · SYNTHETIC DEMO DATA
      {ehrNotCurrent.length > 0 && (
        <p className="mt-1 font-medium text-amber-800">
          EHR schedule not current for{" "}
          {ehrNotCurrent.map((s) => `${s.site} (${s.mode}, last sync ${s.lastSyncedAt ? formatInstant(s.lastSyncedAt, timezone) : "never"})`).join("; ")} — scheduling numbers
          reflect ProjectOS records only.
        </p>
      )}
    </div>
  );
}

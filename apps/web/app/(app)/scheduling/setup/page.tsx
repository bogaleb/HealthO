import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { can, hasAny, hasOrgWide } from "@projectos/auth";
import { getSchedulingReference, listExceptions, listTemplates } from "@projectos/scheduling";
import { EXCEPTION_KIND_LABEL, MODALITY_LABEL, todayIn, type ExceptionKind, type Modality } from "@projectos/shared";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { formatInstant } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { NewExceptionButton, NewHoursButton, NewRoomButton, NewTypeButton, RowAction, TypeActiveToggle } from "@/components/scheduling/SetupForms";

export const metadata: Metadata = { title: "Scheduling setup" };
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const th = "py-2 pr-3 font-medium";
const td = "py-1.5 pr-3";

export default async function SetupPage() {
  const ctx = await requireContext();
  if (!hasAny(ctx, "scheduling.read")) return <Forbidden what="scheduling setup" />;
  const db = getDb();
  const ref = await load(getSchedulingReference(db, ctx));
  const templates = await listTemplates(db, ctx);
  const now = new Date();
  const exceptions = await listExceptions(db, ctx, { from: new Date(now.getTime() - 86_400_000), to: new Date(now.getTime() + 180 * 86_400_000) });
  const today = todayIn("America/New_York");
  const canTypes = hasOrgWide(ctx, "scheduling.configure");
  const configurableSites = ref.sites.filter((s) => can(ctx, "scheduling.configure", { siteId: s.id }));
  const canAny = configurableSites.length > 0;
  const tz = ref.sites[0]?.timezone ?? "America/New_York";
  const svcName = new Map(ref.services.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Scheduling setup"
        description={
          canAny
            ? "Appointment types, rooms, working hours, time off and closures. Changes never cancel existing appointments."
            : "Read-only: your role cannot change scheduling setup."
        }
      />

      <Card>
        <CardHeader
          title="Appointment types"
          description="Duration, buffers (reserved time around the visit), modalities, notice and booking horizon."
          actions={canTypes ? <NewTypeButton services={ref.services} /> : undefined}
        />
        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className={th}>Type</th>
                <th className={th}>Service</th>
                <th className={th}>Duration</th>
                <th className={th}>Buffers</th>
                <th className={th}>Modalities</th>
                <th className={th}>Room</th>
                <th className={th}>Notice / horizon</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {ref.appointmentTypes.map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className={td}>
                    <span className="font-medium">{t.name}</span> <span className="font-mono text-xs text-slate-500">{t.code}</span>
                  </td>
                  <td className={td}>{t.serviceId ? svcName.get(t.serviceId) : "Any"}</td>
                  <td className={td}>{t.durationMinutes} min</td>
                  <td className={td}>
                    {t.bufferBeforeMinutes}/{t.bufferAfterMinutes} min
                  </td>
                  <td className={td}>{t.modalities.map((m) => MODALITY_LABEL[m as Modality]).join(", ")}</td>
                  <td className={td}>{t.requiresRoom ? "In person" : "—"}</td>
                  <td className={td}>
                    {t.minNoticeMinutes} min / {t.maxDaysOut} d
                  </td>
                  <td className={td}>
                    <span className="inline-flex items-center gap-2">
                      <Badge tone={t.active ? "green" : "neutral"}>{t.active ? "Active" : "Inactive"}</Badge>
                      {canTypes && <TypeActiveToggle id={t.id} version={t.version} active={t.active} />}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Rooms"
          description="One appointment per room at a time (capacity > 1 is not supported)."
          actions={canAny ? <NewRoomButton sites={configurableSites} /> : undefined}
        />
        <div className="flex flex-wrap gap-2 px-5 pb-4 text-[13px]">
          {ref.rooms.length === 0 && <span className="text-slate-500">No rooms.</span>}
          {ref.rooms.map((r) => (
            <Badge key={r.id} tone={r.active ? "neutral" : "red"}>
              {ref.sites.find((s) => s.id === r.siteId)?.code} {r.code} — {r.name}
            </Badge>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Working hours"
          description="Weekly blocks per provider and site, in the site's time zone. Breaks are the gaps between blocks."
          actions={canAny ? <NewHoursButton sites={configurableSites} practitioners={ref.practitioners} today={today} /> : undefined}
        />
        <div className="overflow-x-auto px-5 pb-4">
          {templates.length === 0 ? (
            <EmptyState title="No working hours yet" description="Providers without working hours never appear in search." />
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={th}>Provider</th>
                  <th className={th}>Site</th>
                  <th className={th}>Day</th>
                  <th className={th}>Hours</th>
                  <th className={th}>Modalities</th>
                  <th className={th}>Effective</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100">
                    <td className={td}>{t.practitionerName.replace(/ \(SYNTHETIC\)$/, "")}</td>
                    <td className={td}>
                      {t.siteCode} <span className="text-xs text-slate-500">{t.timezone}</span>
                    </td>
                    <td className={td}>{WD[t.weekday]}</td>
                    <td className={`${td} tabular-nums`}>
                      {t.startTime.slice(0, 5)}–{t.endTime.slice(0, 5)}
                    </td>
                    <td className={td}>{t.modalities.map((m) => MODALITY_LABEL[m as Modality]).join(", ")}</td>
                    <td className={td}>
                      {t.effectiveFrom}
                      {t.effectiveTo ? ` → ${t.effectiveTo}` : " →"}
                    </td>
                    <td className={td}>
                      {can(ctx, "scheduling.configure", { siteId: t.siteId }) && (
                        <RowAction label="Remove" path={`/api/v1/schedule-templates/${t.id}`} confirmText="Remove this block? Existing appointments stay." />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Time off and closures"
          description="Upcoming (next 180 days). Overlapping appointments are flagged for review, never cancelled automatically."
          actions={canAny ? <NewExceptionButton sites={configurableSites} practitioners={ref.practitioners} today={today} timezone={tz} /> : undefined}
        />
        <div className="overflow-x-auto px-5 pb-4">
          {exceptions.length === 0 ? (
            <EmptyState title="Nothing scheduled" />
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={th}>Kind</th>
                  <th className={th}>Who / where</th>
                  <th className={th}>From</th>
                  <th className={th}>To</th>
                  <th className={th}>Reason</th>
                  <th className={th}>Booked inside</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className={td}>{EXCEPTION_KIND_LABEL[e.kind as ExceptionKind]}</td>
                    <td className={td}>{e.kind === "CLOSURE" ? e.siteCode : e.practitionerName?.replace(/ \(SYNTHETIC\)$/, "")}</td>
                    <td className={td}>{formatInstant(e.startAt, tz)}</td>
                    <td className={td}>{formatInstant(e.endAt, tz)}</td>
                    <td className={td}>{e.reason}</td>
                    <td className={td}>{e.impactedAppointments > 0 ? <Badge tone="amber">{e.impactedAppointments} to review</Badge> : "—"}</td>
                    <td className={td}>{canAny && <RowAction label="Remove" path={`/api/v1/schedule-exceptions/${e.id}`} confirmText="Remove this time off / closure?" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

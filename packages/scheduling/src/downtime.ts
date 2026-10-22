import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@projectos/db";
import { appointmentTypes, appointments, patients, practitioners, rooms, sites } from "@projectos/db/schema";
import { can, type AuthContext } from "@projectos/auth";
import { audit, parse } from "@projectos/core";
import { boundaryInstant, notFound, todayIn } from "@projectos/shared";
import { requireAtSite } from "./access";

const q = z.object({
  siteId: z.uuid(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  days: z.coerce.number().int().min(1).max(3).default(1),
});

/**
 * Manual downtime plan (docs/compliance/DOWNTIME_PLAN.md): a printable paper schedule for a site so the front desk can
 * keep working if ProjectOS or the EHR is down. Minimum necessary fields; every print is audited as an export.
 */
export async function downtimeSchedule(db: Db, ctx: AuthContext, input: unknown, now = new Date()) {
  const d = parse(q, input);
  await requireAtSite(db, ctx, "scheduling.read", d.siteId, "downtime.print");
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.id, d.siteId)));
  if (!site) throw notFound("Site");
  const date = d.date ?? todayIn(site.timezone, now);
  const from = boundaryInstant(date, "00:00", site.timezone, "start");
  const toDate = new Date(`${date}T00:00:00Z`);
  toDate.setUTCDate(toDate.getUTCDate() + d.days);
  const to = boundaryInstant(toDate.toISOString().slice(0, 10), "00:00", site.timezone, "start");
  const showPatient = can(ctx, "patients.read", { siteId: d.siteId });
  const rows = await db
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
      ehrState: appointments.ehrState,
      modality: appointments.modality,
      provider: practitioners.displayName,
      type: appointmentTypes.name,
      room: rooms.code,
      patientName: patients.displayName,
      mrn: patients.mrn,
      patientLocationState: appointments.patientLocationState,
    })
    .from(appointments)
    .innerJoin(practitioners, eq(practitioners.id, appointments.practitionerId))
    .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(rooms, eq(rooms.id, appointments.roomId))
    .where(
      and(
        eq(appointments.organizationId, ctx.organizationId),
        eq(appointments.siteId, d.siteId),
        inArray(appointments.status, ["PENDING", "CONFIRMED", "CHECKED_IN", "NEEDS_RESCHEDULE"]),
        sql`${appointments.startAt} >= ${from.toISOString()}::timestamptz`,
        sql`${appointments.startAt} < ${to.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(practitioners.displayName), asc(appointments.startAt));
  await audit(db, ctx, { action: "downtime.print", resourceType: "site", resourceId: d.siteId, metadata: { date, days: d.days, rows: rows.length, patientDetails: showPatient } });
  return {
    site: { id: site.id, code: site.code, name: site.name, timezone: site.timezone, ehrSyncMode: site.ehrSyncMode },
    date,
    days: d.days,
    printedAt: now.toISOString(),
    printedBy: ctx.displayName,
    rows: rows.map((r) => ({
      ...r,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      patientName: showPatient ? r.patientName : "Restricted",
      mrn: showPatient ? r.mrn : "—",
    })),
  };
}

import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { patients } from "@projectos/db/schema";
import { hasAny, type AuthContext } from "@projectos/auth";
import { audit, mapDbError, parse } from "@projectos/core";
import { AppError, isSyntheticMode, notFound, patientCreate, SYNTHETIC_LABEL } from "@projectos/shared";
import { requireAnywhere } from "./access";

const PUBLIC_FIELDS = {
  id: patients.id,
  mrn: patients.mrn,
  displayName: patients.displayName,
  birthYear: patients.birthYear,
  homeState: patients.homeState,
  isSynthetic: patients.isSynthetic,
};

/**
 * Patient picker search (minimum necessary: name, demo MRN, birth year, home state). Requires 2+ characters
 * and returns at most 20 rows so the endpoint cannot be used to enumerate the index.
 */
export async function searchPatients(db: Db, ctx: AuthContext, q: string) {
  await requireAnywhere(db, ctx, "patients.read", "patient.search", "patient");
  const term = (q ?? "").trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select(PUBLIC_FIELDS)
    .from(patients)
    .where(and(eq(patients.organizationId, ctx.organizationId), or(ilike(patients.displayName, like), ilike(patients.mrn, like))))
    .orderBy(asc(patients.displayName))
    .limit(20);
  // Phase 7 (PHI-readiness gate "audit patient record reads"): searches are audited with the result count only —
  // never the search term, which could itself be identifying.
  await audit(db, ctx, { action: "patient.search", resourceType: "patient", metadata: { results: rows.length } });
  return rows;
}

export async function getPatient(db: Db, ctx: AuthContext, id: string) {
  await requireAnywhere(db, ctx, "patients.read", "patient.read", "patient");
  const [p] = await db
    .select(PUBLIC_FIELDS)
    .from(patients)
    .where(and(eq(patients.organizationId, ctx.organizationId), eq(patients.id, id)));
  if (!p) throw notFound("Patient");
  await audit(db, ctx, { action: "patient.read", resourceType: "patient", resourceId: id });
  return p;
}

/**
 * Create a SYNTHETIC patient. Refused outside synthetic modes (no real patients before the PHI gate).
 * The demo MRN is generated (DEMO-0001…) and the display name always carries the SYNTHETIC label.
 */
export async function createPatient(db: Db, ctx: AuthContext, input: unknown) {
  if (!isSyntheticMode()) throw new AppError("FORBIDDEN", "Patients can only be created as synthetic demo records in this release.");
  await requireAnywhere(db, ctx, "patients.read", "patient.create", "patient");
  if (!hasAny(ctx, "scheduling.manage")) await requireAnywhere(db, ctx, "scheduling.manage", "patient.create", "patient");
  const d = parse(patientCreate, input);
  if ((d.externalSource && !d.externalId) || (!d.externalSource && d.externalId))
    throw new AppError("VALIDATION_FAILED", "External source and ID go together.", [{ code: "EXTERNAL_PAIR", field: "externalId" }]);
  const name = /synthetic/i.test(d.displayName) ? d.displayName : `${d.displayName} (${SYNTHETIC_LABEL.split(" ")[0]})`;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`patient-mrn:${ctx.organizationId}`}))`);
      const [{ n }] = (await tx.execute<{ n: number }>(sql`
        select coalesce(max(substring(mrn from 6)::int), 0) + 1 as n from patients
        where organization_id = ${ctx.organizationId} and mrn ~ '^DEMO-[0-9]+$'`)) as unknown as [{ n: number }];
      const [p] = await tx
        .insert(patients)
        .values({
          organizationId: ctx.organizationId,
          mrn: `DEMO-${String(n).padStart(4, "0")}`,
          displayName: name,
          birthYear: d.birthYear ?? null,
          homeState: d.homeState ?? null,
          externalSource: d.externalSource ?? null,
          externalId: d.externalId ?? null,
          isSynthetic: true,
          createdBy: ctx.userId,
        })
        .returning(PUBLIC_FIELDS);
      await audit(tx, ctx, { action: "patient.create", resourceType: "patient", resourceId: p!.id, metadata: { synthetic: true } });
      return p!;
    });
  } catch (e) {
    // Duplicate detection by reliable external identifier only — never auto-merge.
    mapDbError(e, "A patient with this external ID already exists. Search for it instead of creating a duplicate.");
  }
}

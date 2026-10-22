import { and, eq, sql } from "drizzle-orm";
import { createDb, isMain, loadRootEnv, type Db } from "@projectos/db";
import { complianceItems, ehrConnections, sites } from "@projectos/db/schema";
import { audit, findOrgBySlug } from "@projectos/core";
import { connectSimulator, runHealthCheck, simulateEhrSideBooking, syncAvailability } from "@projectos/integrations";
import { addDays, appMode, boundaryInstant, isSyntheticMode, todayIn, weekdayOf } from "@projectos/shared";
import { ensureComplianceCatalog } from "./service";

/**
 * Phase 7 demo setup (SYNTHETIC): the NEDC site (already EHR_MASTER) is connected to the synthetic EHR simulator,
 * the SSP site gets an *unverified* vendor placeholder (shown as "Not connected"), and the readiness checklist is
 * created with honest statuses — nothing approved.
 */
export async function seedPhase7(db: Db, slug = "riverbend-demo", now = new Date()) {
  if (!isSyntheticMode(appMode())) throw new Error("Phase 7 demo seed runs only in synthetic modes.");
  const org = await findOrgBySlug(db, slug);
  if (!org) throw new Error("Run the core seed first.");
  const o = org.id;
  const siteRows = await db.select().from(sites).where(eq(sites.organizationId, o));
  const nedc = siteRows.find((s) => s.code === "NEDC");
  const ssp = siteRows.find((s) => s.code === "SSP");
  const [already] = await db.select({ id: ehrConnections.id }).from(ehrConnections).where(eq(ehrConnections.organizationId, o)).limit(1);
  const system = { system: "seed.phase7", organizationId: o };
  if (!already && nedc) {
    // One synthetic patient is deliberately missing from the simulated EHR to demonstrate a patient-mapping conflict.
    const conn = await connectSimulator(db, system, nedc.id, { missingMrns: ["DEMO-0015"] });
    await db.update(sites).set({ ehrSyncMode: "EHR_MASTER", ehrFreshnessMinutes: 60 }).where(eq(sites.id, nedc.id));
    await runHealthCheck(db, conn);
    // A visit booked directly in the (simulated) EHR tomorrow 10:00 site time — it shows up as busy after the sync.
    let d = addDays(todayIn(nedc.timezone, now), 1);
    while ([0, 6].includes(weekdayOf(d))) d = addDays(d, 1);
    const tomorrow10 = boundaryInstant(d, "10:00", nedc.timezone, "start");
    const links = await db.execute<{ external_id: string }>(
      sql`select external_id from ehr_resource_links where connection_id = ${conn.id} and kind = 'PRACTITIONER' order by external_id limit 1`,
    );
    if (links[0])
      await simulateEhrSideBooking(db, conn.id, {
        practitionerExternalId: links[0].external_id,
        locationExternalId: "loc-nedc",
        start: tomorrow10,
        end: new Date(tomorrow10.getTime() + 3_600_000),
      });
    const fresh = (await db.select().from(ehrConnections).where(eq(ehrConnections.id, conn.id)))[0]!;
    await syncAvailability(db, fresh, now);
  }
  if (!already && ssp) {
    await db.insert(ehrConnections).values({
      organizationId: o,
      siteId: ssp.id,
      vendor: "UNVERIFIED_VENDOR",
      displayName: "Clinic EHR (vendor not yet verified)",
      capabilities: {},
      enabled: false,
    });
    await audit(db, system, { action: "integration.connect", resourceType: "site", resourceId: ssp.id, metadata: { vendor: "UNVERIFIED_VENDOR" } });
  }
  await ensureComplianceCatalog(db, o);
  await db
    .update(complianceItems)
    .set({ status: "IN_PROGRESS", notes: "Draft data-flow diagram and inventory in docs/compliance/DATA_FLOW.md — needs the privacy officer's review." })
    .where(and(eq(complianceItems.organizationId, o), eq(complianceItems.key, "data.flow_inventory"), eq(complianceItems.status, "NOT_STARTED")));
  await db
    .update(complianceItems)
    .set({ status: "IN_PROGRESS", notes: "Draft register in docs/compliance/SECURITY_RISK_REGISTER.md — not a formal risk analysis." })
    .where(and(eq(complianceItems.organizationId, o), eq(complianceItems.key, "risk.analysis"), eq(complianceItems.status, "NOT_STARTED")));
  return { skipped: !!already };
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  const { sql: pg, db } = createDb(undefined, 2);
  seedPhase7(db)
    .then((r) =>
      console.log(
        JSON.stringify({
          level: "info",
          msg: r.skipped ? "Phase 7 demo integration already set up — checklist ensured" : "synthetic EHR simulator connected; readiness checklist created",
        }),
      ),
    )
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pg.end());
}

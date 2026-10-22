import { execSync } from "node:child_process";
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { USERS, apiLogin, login, settle, totp } from "./helpers";

/**
 * Phase 7 — EHR write-through against the SYNTHETIC simulator (NEDC is EHR_MASTER), Integration Health,
 * the PHI-readiness checklist with dual control, and MFA. The worker runs one tick between steps (as in production).
 */
const BASE = "http://localhost:3000";
const ORIGIN = { origin: BASE };
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const workerTick = () => execSync("pnpm --filter @projectos/worker once", { stdio: "pipe", timeout: 120_000 });

async function api(email: string) {
  const r = await pwRequest.newContext({ baseURL: BASE });
  await apiLogin(r, email);
  return r;
}

async function nedcSetup(admin: APIRequestContext) {
  const ref = (await (await admin.get("/api/v1/scheduling/reference")).json()).data;
  const site = ref.sites.find((s: { code: string }) => s.code === "NEDC");
  const type = ref.appointmentTypes.find((t: { code: string }) => t.code === "BH_THERAPY");
  const prov = ref.practitioners.find((p: { displayName: string }) => p.displayName.startsWith("Practitioner C "));
  const health = (await (await admin.get("/api/v1/integrations/health")).json()).data;
  const conn = health.sites.find((s: { site: { code: string } }) => s.site.code === "NEDC").connection;
  return { site, type, prov, conn };
}

async function freeSlot(admin: APIRequestContext, s: Awaited<ReturnType<typeof nedcSetup>>, offset: number, show: "eligible" | "all" = "eligible") {
  const r = await admin.post("/api/v1/scheduling/search", {
    data: { appointmentTypeId: s.type.id, modality: "VIDEO", siteId: s.site.id, practitionerId: s.prov.id, fromDate: day(offset), days: 7, patientState: "VA", show },
    headers: ORIGIN,
  });
  const slots = (await r.json()).data.slots as { startAt: string; eligibility: { decision: string } }[];
  return slots;
}

test("EHR-01/02 over HTTP + Integration Health: outage → no confirmation; recovery → EHR confirms; EHR-side cancel → conflict → accept", async ({ page }) => {
  const admin = await api(USERS.admin);
  const s = await nedcSetup(admin);
  expect(s.conn.label.text).toMatch(/Synthetic simulator/);
  const pats = (await (await admin.get("/api/v1/patients?q=Demo Patient 0")).json()).data as { id: string; mrn: string }[];
  const patient = pats.find((p) => p.mrn !== "DEMO-0015")!;
  // Outage: the booking is refused (review) because the authoritative EHR is unreachable.
  expect((await admin.post(`/api/v1/integrations/connections/${s.conn.id}/simulator`, { data: { failureMode: "UNREACHABLE" }, headers: ORIGIN })).status()).toBe(200);
  let slots = await freeSlot(admin, s, 9, "all"); // during the outage nothing is "eligible"; take any time
  const body = (startAt: string, patientId = patient.id) => ({
    practitionerId: s.prov.id,
    siteId: s.site.id,
    appointmentTypeId: s.type.id,
    modality: "VIDEO",
    startAt,
    patientId,
    patientLocationState: "VA",
  });
  const refused = await admin.post("/api/v1/appointments", { data: body(slots[2]!.startAt), headers: ORIGIN });
  expect(refused.status()).toBe(409);
  expect(JSON.stringify(await refused.json())).toContain("EHR_UNAVAILABLE");
  // Recovered: booked as PENDING / sent to the EHR; the worker delivers it; only then CONFIRMED.
  await admin.post(`/api/v1/integrations/connections/${s.conn.id}/simulator`, { data: { failureMode: "NONE" }, headers: ORIGIN });
  slots = await freeSlot(admin, s, 9);
  const ok = await admin.post("/api/v1/appointments", {
    data: body(slots.find((x) => x.eligibility.decision === "ALLOW")!.startAt),
    headers: { ...ORIGIN, "idempotency-key": `e2e-ehr-${Date.now()}` },
  });
  expect(ok.status(), await ok.text()).toBe(201);
  const appt = (await ok.json()).data;
  expect(appt).toMatchObject({ status: "PENDING", ehrState: "PENDING_CREATE" });
  workerTick();
  const after = (await (await admin.get(`/api/v1/appointments/${appt.id}`)).json()).data;
  expect(after).toMatchObject({ status: "CONFIRMED", ehrState: "SYNCED" });
  // A patient the EHR does not know → rejected write, visible conflict, never confirmed.
  const missing = (await (await admin.get("/api/v1/patients?q=DEMO-0015")).json()).data[0];
  slots = await freeSlot(admin, s, 9); // re-search: the slot just booked (and its buffers) is no longer offered
  const rej = await admin.post("/api/v1/appointments", { data: body(slots.find((x) => x.eligibility.decision === "ALLOW")!.startAt, missing.id), headers: ORIGIN });
  expect(rej.status()).toBe(201);
  workerTick();
  const rejA = (await (await admin.get(`/api/v1/appointments/${(await rej.json()).data.id}`)).json()).data;
  expect(rejA).toMatchObject({ status: "PENDING", ehrState: "FAILED" });

  // UI: Integration Health shows it; simulate an EHR-side cancellation, sync, accept the EHR.
  await login(page, USERS.admin);
  await page.goto("/admin/integrations");
  await settle(page);
  await expect(page.getByTestId("site-NEDC")).toContainText("Synthetic simulator reachable");
  await expect(page.getByTestId("site-SSP")).toContainText("Not connected — vendor API access and capabilities not verified");
  await expect(page.getByTestId("conflicts-table")).toContainText("PATIENT_NOT_FOUND");
  const controls = page.getByTestId("connection-controls");
  await controls.getByLabel("Synced appointment").selectOption(appt.id);
  await controls.getByRole("button", { name: "Cancel it in EHR" }).click();
  await expect(controls.getByRole("status")).toContainText("Cancelled in the synthetic EHR");
  await controls.getByRole("button", { name: "Sync now" }).click();
  await expect(controls.getByRole("status")).toContainText("Synced");
  const row = page.getByTestId("conflicts-table").locator("tr", { hasText: "EXTERNAL_CANCELLED" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Accept EHR (cancel here)" }).click();
  await expect(page.getByTestId("conflicts-table").locator("tr", { hasText: "EXTERNAL_CANCELLED" })).toHaveCount(0);
  const final = (await (await admin.get(`/api/v1/appointments/${appt.id}`)).json()).data;
  expect(final.status).toBe("CANCELLED");
  // Only integrations.manage may drive the simulator.
  const sched = await api(USERS.scheduler);
  expect((await sched.post(`/api/v1/integrations/connections/${s.conn.id}/simulator`, { data: { failureMode: "UNREACHABLE" }, headers: ORIGIN })).status()).toBe(403);
});

test("PHI readiness: verdict NOT APPROVED; evidence submitted by one officer needs a different approver", async ({ page, browser }) => {
  await login(page, USERS.compliance);
  await page.goto("/admin/compliance");
  await settle(page);
  await expect(page.getByTestId("readiness-verdict")).toContainText("NOT APPROVED FOR REAL PHI");
  const row = page.getByTestId("compliance-items").locator("tr", { hasText: "Incident response plan exercised" });
  await row.getByRole("button", { name: "Submit evidence" }).click();
  await page.getByRole("dialog").getByLabel("Evidence location *").fill("Policy library › IR-01 tabletop (SYNTHETIC)");
  await page.getByRole("dialog").getByRole("button", { name: "Submit evidence" }).click();
  await expect(row).toContainText("Evidence submitted");
  await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(row).toContainText("Awaiting another reviewer");
  // HTTP: the submitter is refused.
  const dana = await api(USERS.compliance);
  const items = (await (await dana.get("/api/v1/compliance/items")).json()).data as { item: { id: string; key: string; version: number } }[];
  const it = items.find((i) => i.item.key === "incident.response")!.item;
  expect((await dana.patch(`/api/v1/compliance/items/${it.id}`, { data: { action: "APPROVE", version: it.version }, headers: ORIGIN })).status()).toBe(403);
  // A different person (org admin holds compliance.manage) approves; the verdict stays NOT APPROVED.
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, USERS.admin);
  await p2.goto("/admin/compliance");
  await settle(p2);
  const row2 = p2.getByTestId("compliance-items").locator("tr", { hasText: "Incident response plan exercised" });
  await row2.getByRole("button", { name: "Approve" }).click();
  await p2.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(row2).toContainText("Approved by Avery Admin");
  await expect(p2.getByTestId("readiness-verdict")).toContainText("NOT APPROVED FOR REAL PHI");
  await ctx2.close();
});

test("MFA: enroll TOTP, sign-in then requires the second factor, backup codes shown once; disable restores password-only", async ({ page }) => {
  await login(page, USERS.auditor);
  await page.goto("/account/security");
  await settle(page);
  await expect(page.getByTestId("mfa-status")).toContainText("OFF");
  await page.getByLabel("Current password").fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Set up MFA" }).click();
  const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
  await expect(page.getByTestId("backup-codes").locator("li")).toHaveCount(8);
  await page.getByLabel(/Enter the 6-digit code/).fill(totp(secret));
  await page.getByRole("button", { name: "Turn on MFA" }).click();
  await expect(page.getByTestId("mfa-status")).toContainText("ON");

  // New session: password alone is not enough.
  await page.context().clearCookies();
  await page.goto("/login");
  await settle(page);
  await page.getByLabel("Work email").fill(USERS.auditor);
  await page.getByLabel("Password").fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\/two-factor$/);
  await page.getByLabel(/6-digit code/).fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not valid" })).toBeVisible();
  await page.getByLabel(/6-digit code/).fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/home$/);

  // Clean up: turn MFA off (password re-entry required).
  await page.goto("/account/security");
  await settle(page);
  await page.getByLabel(/Current password/).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Turn MFA off" }).click();
  await expect(page.getByTestId("mfa-status")).toContainText("OFF");
});

import { expect, request as pwRequest, test } from "@playwright/test";
import { ALERT, USERS, apiLogin, login, settle } from "./helpers";

const BASE = "http://localhost:3000";
const ORIGIN = { origin: BASE };
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function api(email: string) {
  const r = await pwRequest.newContext({ baseURL: BASE });
  await apiLogin(r, email);
  return r;
}

test("Phase 4: scheduler finds a slot, holds it, books a synthetic patient, sees it on the calendar, cancels it", async ({ page }) => {
  await login(page, USERS.scheduler); // scheduler role scoped to site ALX
  await page.goto("/scheduling/find");
  await settle(page);
  await expect(page.getByRole("note").filter({ hasText: "policy pending" })).toBeVisible();
  await page.getByLabel("Appointment type *").selectOption({ label: "Follow-up — primary care (20 min)" });
  await page.getByLabel("Site").selectOption({ label: "ALX — Alexandria Family Clinic (VA)" });
  await page.getByLabel("Provider").selectOption({ label: "Practitioner A — Dr. Alder" });
  await page.getByLabel("From date *").fill(day(2));
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Eligibility: policy pending").first()).toBeVisible();
  const slot = page.getByTestId("slot").nth(3);
  const label = (await slot.getAttribute("aria-label")) ?? "";
  expect(label).toMatch(/^Hold .* (EDT|EST) with Practitioner A/);
  await slot.click();
  await expect(page).toHaveURL(/\/scheduling\/appointments\/new\?hold=/);
  await settle(page);
  await expect(page.getByTestId("hold-summary")).toContainText("Practitioner A");
  await expect(page.getByRole("status")).toContainText("Held for you");

  await page.getByRole("searchbox").fill("Demo Patient 05");
  await page.getByRole("list", { name: "Matching patients" }).getByRole("button").first().click();
  await expect(page.getByTestId("picked-patient")).toContainText("DEMO-0005");
  await expect(page.getByLabel("State / territory *")).toHaveValue("VA"); // in person → site state proposed
  await page.getByRole("button", { name: "Book synthetic appointment" }).click();

  await expect(page).toHaveURL(/\/scheduling\/calendar\?.*appt=/);
  const drawer = page.getByTestId("appointment-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Demo Patient 05");
  await expect(drawer).toContainText("Booked");
  await expect(drawer).toContainText("Eligibility: policy pending");
  await expect(drawer).toContainText("booked by Sam Ortiz");

  await drawer.getByRole("button", { name: "Cancel appointment" }).click();
  await drawer.getByLabel("Reason (no clinical details) *").fill("Patient asked to cancel (synthetic)");
  await drawer.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(drawer.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(drawer).toContainText("cancelled (CONFIRMED → CANCELLED)");
});

test("SCH-01 over HTTP: two schedulers book the same slot at once → one 201, one 409 SLOT_CONFLICT; booking needs scheduling.manage at the site", async () => {
  const admin = await api(USERS.admin);
  const sched = await api(USERS.scheduler);
  const ref = (await (await admin.get("/api/v1/scheduling/reference")).json()).data;
  const site = ref.sites.find((s: { code: string }) => s.code === "ALX");
  const ssp = ref.sites.find((s: { code: string }) => s.code === "SSP");
  const type = ref.appointmentTypes.find((t: { code: string }) => t.code === "PC_FU");
  const prov = ref.practitioners.find((p: { displayName: string }) => p.displayName.startsWith("Practitioner A "));
  const search = await admin.post("/api/v1/scheduling/search", {
    headers: ORIGIN,
    data: { appointmentTypeId: type.id, modality: "IN_PERSON", siteId: site.id, practitionerId: prov.id, fromDate: day(14), days: 7 },
  });
  expect(search.status()).toBe(200);
  const slots = (await search.json()).data.slots;
  const target = slots[slots.length - 1 - Math.floor(Math.random() * 10)];
  const pts = (await (await admin.get("/api/v1/patients?q=Demo%20Patient")).json()).data;
  const body = (i: number) => ({
    practitionerId: prov.id,
    siteId: site.id,
    appointmentTypeId: type.id,
    modality: "IN_PERSON",
    startAt: target.startAt,
    patientId: pts[i].id,
    patientLocationState: "VA",
  });
  const [a, b] = await Promise.all([
    admin.post("/api/v1/appointments", { headers: ORIGIN, data: body(0) }),
    sched.post("/api/v1/appointments", { headers: ORIGIN, data: body(1) }),
  ]);
  expect([a.status(), b.status()].sort()).toEqual([201, 409]);
  const loser = a.status() === 409 ? a : b;
  const err = (await loser.json()).error;
  expect(err.code).toBe("SLOT_CONFLICT");
  expect(err.message).toMatch(/Cannot offer|occupies this provider/);
  expect(JSON.stringify(err)).not.toContain("Demo Patient"); // no other patient's data in the conflict

  // Idempotency-Key replay returns the same booking (200, replayed)
  const next = slots[0];
  const key = `e2e-${Date.now()}-idem`;
  const r1 = await admin.post("/api/v1/appointments", { headers: { ...ORIGIN, "Idempotency-Key": key }, data: { ...body(2), startAt: next.startAt } });
  const r2 = await admin.post("/api/v1/appointments", { headers: { ...ORIGIN, "Idempotency-Key": key }, data: { ...body(2), startAt: next.startAt } });
  expect(r1.status()).toBe(201);
  expect(r2.status()).toBe(200);
  expect((await r2.json()).data.id).toBe((await r1.json()).data.id);

  // Unauthorized booking: scheduler is ALX-only (403 at SSP); RCM analyst and PM have no scheduling.manage.
  const g = ref.practitioners.find((p: { displayName: string }) => p.displayName.startsWith("Practitioner G "));
  expect((await sched.post("/api/v1/appointments", { headers: ORIGIN, data: { ...body(3), siteId: ssp.id, practitionerId: g.id } })).status()).toBe(403);
  const rcm = await api(USERS.rcm);
  expect((await rcm.post("/api/v1/appointments", { headers: ORIGIN, data: body(3) })).status()).toBe(403);
  expect((await rcm.get("/api/v1/patients?q=Demo")).status()).toBe(403);
  const pm = await api(USERS.pm);
  expect((await pm.post("/api/v1/appointments/holds", { headers: ORIGIN, data: { ...body(3), patientId: undefined } })).status()).toBe(403);
  // Unauthenticated
  const anon = await pwRequest.newContext({ baseURL: BASE });
  expect((await anon.post("/api/v1/appointments", { headers: ORIGIN, data: body(3) })).status()).toBe(401);
  for (const r of [admin, sched, rcm, pm, anon]) await r.dispose();
});

test("reschedule from the drawer moves the appointment; manual entry rejects a DST-nonexistent time", async ({ page }) => {
  await login(page, USERS.admin);
  const tomorrow = day(1);
  await page.goto(`/scheduling/calendar?date=${tomorrow}`);
  await settle(page);
  const firstLink = page.getByRole("table").getByRole("link").first();
  await firstLink.click();
  const drawer = page.getByTestId("appointment-drawer");
  await expect(drawer).toBeVisible();
  const before = await page.getByRole("dialog").locator("p").first().textContent();
  await drawer.getByRole("button", { name: "Reschedule" }).click();
  await drawer.getByLabel("New date").fill(day(21));
  await drawer.getByRole("button", { name: "Find times" }).click();
  await drawer.getByLabel("Reason *").fill("Patient prefers later (synthetic)");
  await drawer.getByRole("list", { name: "Available times" }).getByRole("listitem").nth(2).click();
  await expect(drawer).toContainText("rescheduled");
  const after = await page.getByRole("dialog").locator("p").first().textContent();
  expect(after).not.toBe(before);

  await page.goto("/scheduling/appointments/new");
  await settle(page);
  await page.getByLabel("Date *").fill("2027-03-14");
  await page.getByLabel(/Local start time/).fill("02:30");
  await expect(page.getByText("does not exist on 2027-03-14")).toBeVisible();
  await page.getByLabel("Date *").fill("2026-11-01");
  await page.getByLabel(/Local start time/).fill("01:30");
  await expect(page.getByText("happens twice on 2026-11-01")).toBeVisible();
  await expect(page.getByText(/01:30 EDT/)).toBeVisible();
  await expect(page.getByText(/01:30 EST/)).toBeVisible();
});

test("scheduling setup: manager adds provider time off (flagged, nothing cancelled); front desk sees setup read-only", async ({ page }) => {
  await login(page, USERS.schedManager);
  await page.goto("/scheduling/setup");
  await settle(page);
  await page.getByRole("button", { name: "Add time off / closure" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Provider (time off / block)").selectOption({ label: "Practitioner C — Dr. Dogwood, PhD" });
  await dlg.getByLabel("First day").fill(day(1));
  await dlg.getByLabel("Last day").fill(day(3));
  const reason = `Conference (SYNTHETIC) ${Date.now() % 10000}`;
  await dlg.getByLabel(/Reason/).fill(reason);
  await dlg.getByRole("button", { name: "Save" }).click();
  const row = page.locator("tr", { hasText: reason });
  await expect(row).toBeVisible();
  await expect(row).toContainText("to review"); // seeded appointments for C fall inside → flagged, not cancelled
  await page.goto("/scheduling/find");
  await settle(page);

  const other = await page.context().browser()!.newContext();
  const p2 = await other.newPage();
  await login(p2, USERS.scheduler);
  await p2.goto("/scheduling/setup");
  await settle(p2);
  await expect(p2.getByText("Read-only: your role cannot change scheduling setup.")).toBeVisible();
  await expect(p2.getByRole("button", { name: "Add working hours" })).toHaveCount(0);
  await expect(p2.locator(ALERT)).toHaveCount(0);
  await other.close();
});

import { expect, request as pwRequest, test } from "@playwright/test";
import { ALERT, USERS, apiLogin, login, settle, uid } from "./helpers";

const BASE = "http://localhost:3000";
const ORIGIN = { origin: BASE };
// Calendar date in the org time zone (UTC would be "tomorrow" after 8 pm Eastern).
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function api(email: string) {
  const r = await pwRequest.newContext({ baseURL: BASE });
  await apiLogin(r, email);
  return r;
}

test("RCM-01: supervisor creates an unassigned case; analyst claims it, records a follow-up and escalates; supervisor is notified", async ({ browser }) => {
  const claimRef = `SYN-E2E-${uid()}`;
  const sup = await browser.newPage();
  await login(sup, USERS.rcmSupervisor);
  await sup.goto("/rcm/queues");
  await settle(sup);
  await expect(sup.getByTestId("queue-card")).toHaveCount(4);
  await sup.getByRole("button", { name: "New case" }).click();
  const dlg = sup.getByRole("dialog");
  await dlg.getByLabel("Queue *").selectOption({ label: "Aging A/R follow-up (60+ days)" });
  await dlg.getByLabel("Case type *").selectOption("NO_RESPONSE");
  await dlg.getByLabel("Synthetic claim reference *").fill(claimRef);
  await dlg.getByLabel("Date of service *").fill(day(-100));
  await dlg.getByLabel("Balance (USD) *").fill("321.50");
  await dlg.getByLabel("Next action", { exact: true }).fill("Check claim status");
  await dlg.getByRole("button", { name: "Create case" }).click();
  await expect(dlg).toBeHidden();
  await sup.getByLabel("Case # or claim ref").fill(claimRef);
  await sup.getByRole("button", { name: "Apply" }).click();
  const row = sup.getByTestId("rcm-case-table").locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Unassigned");
  await expect(row).toContainText("91-120 d");
  const caseUrl = (await row.getByRole("link").first().getAttribute("href"))!;

  const an = await browser.newPage();
  await login(an, USERS.rcm);
  await an.goto(caseUrl);
  await settle(an);
  await an.getByRole("button", { name: "Claim case" }).click();
  await expect(an.getByText("Owner: Riley Shah (Demo)")).toBeVisible();
  await an.getByRole("button", { name: "Record follow-up" }).click();
  const f = an.getByRole("dialog");
  await f.getByLabel("Type *").selectOption("PAYER_CALL");
  await f.getByLabel("What happened *").fill("Payer has no record; resubmit (synthetic)");
  await f.getByLabel("Next action", { exact: true }).fill("Resubmit claim");
  await f.getByRole("button", { name: "Record" }).click();
  await expect(f).toBeHidden();
  const timeline = an.getByTestId("rcm-timeline");
  await expect(timeline).toContainText("Payer has no record; resubmit (synthetic)");
  await expect(an.getByText("In progress").first()).toBeVisible();
  await an.getByRole("button", { name: "Escalate" }).click();
  const e = an.getByRole("dialog");
  await e.getByLabel("Reason *").fill("No response after resubmission window (synthetic)");
  await e.getByRole("button", { name: "Escalate" }).click();
  await expect(e).toBeHidden();
  await expect(timeline.getByText("Escalated").first()).toBeVisible();

  // Worker delivers the outbox; the admin endpoint runs the same scan+dispatch on demand.
  const admin = await api(USERS.admin);
  expect((await admin.post("/api/v1/jobs/notifications-scan", { headers: ORIGIN })).status()).toBe(200);
  await sup.goto("/notifications");
  await settle(sup);
  const ref = (await an.locator("h1").first().textContent())!.match(/RCM-\d+/)![0];
  await expect(sup.getByTestId("notification-list")).toContainText(`${ref} escalated to you`);
  await expect(sup.getByTestId("nav-badge")).toBeVisible();
});

test("RCM: analysts cannot bulk-assign or read other areas' reports (HTTP); every dashboard tile matches its drill-down", async ({ page }) => {
  const riley = await api(USERS.rcm);
  const list = await (await riley.get("/api/v1/rcm/cases?owner=none")).json();
  const ids = list.data.items.slice(0, 1).map((c: { id: string }) => c.id);
  const bulk = await riley.post("/api/v1/rcm/bulk-assign", { data: { caseIds: ids, ownerUserId: null }, headers: ORIGIN });
  expect(bulk.status()).toBe(403);
  expect((await riley.get("/api/v1/reports/blocked-booking-attempts")).status()).toBe(403);
  expect((await riley.get("/api/v1/admin/worker")).status()).toBe(403);
  const dash = await (await riley.get("/api/v1/dashboards/operations")).json();
  expect(dash.data.domains.map((d: { domain: string }) => d.domain)).toEqual(["RCM", "PROJECTS"]);

  await login(page, USERS.admin);
  await page.goto("/dashboard");
  await settle(page);
  await expect(page.getByTestId("freshness")).toContainText("Live SQL");
  for (const key of ["rcm-next-action-overdue", "rcm-aged-over-90", "enrollments-not-ready", "tasks-overdue"]) {
    const tile = page.getByTestId(`tile-${key}`);
    const value = (await tile.getByTestId("tile-value").textContent())!.trim();
    await tile.click();
    await expect(page).toHaveURL(new RegExp(`/reports/${key}`));
    await expect(page.getByTestId("report-total")).toHaveText(value);
    const rows = Number(value) === 0 ? 0 : await page.getByTestId("report-table").locator("tbody tr").count();
    expect(rows).toBe(Math.min(50, Number(value)));
    await page.goBack();
    await settle(page);
  }
  await expect(page.locator(ALERT)).toHaveCount(0);
});

test("RCM: worker page shows queue health and admins can run the reminder scan", async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto("/admin/worker");
  await settle(page);
  await expect(page.getByRole("heading", { name: "Notification outbox" })).toBeVisible();
  await page.getByRole("button", { name: "Run reminder scan now" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Queued \d+ new reminder/ })).toBeVisible();
});

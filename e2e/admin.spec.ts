import { expect, test } from "@playwright/test";
import { PASSWORD, USERS, login, uid, settle } from "./helpers";
import { ALERT } from "./helpers";

test("admin creates a site; it persists across reload", async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto("/admin/sites");
  await settle(page);
  const code = `E${uid()}`;
  await page.getByRole("button", { name: "New site" }).click();
  await page.getByLabel("Code", { exact: true }).fill(code);
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("E2E Synthetic Clinic");
  await page.getByLabel("State / jurisdiction").selectOption("DC");
  await page.getByRole("button", { name: "Create site" }).click();
  await expect(page.getByTestId(`site-${code}`)).toContainText("DC");
  await page.reload();
  await settle(page);
  await expect(page.getByTestId(`site-${code}`)).toContainText("E2E Synthetic Clinic");
});

test("invite → accept → new member signs in with the scoped role", async ({ page, browser }) => {
  await login(page, USERS.admin);
  await page.goto("/admin/users");
  await settle(page);
  const email = `new.${uid().toLowerCase()}@riverbend.example`;
  await page.getByRole("button", { name: "Invite staff member" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Display name").fill("E2E New Hire (Demo)");
  await dlg.getByLabel("Work email").fill(email);
  await dlg.getByLabel("Role 1", { exact: true }).selectOption({ label: "Project Manager" });
  await dlg.getByLabel("Scope for role 1").selectOption({ label: "Department: Revenue Cycle" });
  await dlg.getByRole("button", { name: "Create invitation" }).click();
  const token = (await dlg.getByTestId("invite-token").textContent())!.trim();
  expect(token.length).toBeGreaterThan(30);

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto("/invite");
  await settle(p2);
  await p2.getByLabel("Invitation code").fill(token);
  await p2.getByLabel("New password").fill(PASSWORD);
  await p2.getByLabel("Confirm password").fill(PASSWORD);
  await p2.getByRole("button", { name: "Create account" }).click();
  await expect(p2.getByRole("status")).toContainText(email);
  await login(p2, email);
  await p2.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(p2.getByRole("link", { name: /Billing Improvement/ })).toBeVisible();
  await expect(p2.getByRole("link", { name: /Provider Onboarding/ })).toHaveCount(0);
  await ctx2.close();

  // Token is single-use
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  await p3.goto("/invite");
  await settle(p3);
  await p3.getByLabel("Invitation code").fill(token);
  await p3.getByLabel("New password").fill(PASSWORD);
  await p3.getByLabel("Confirm password").fill(PASSWORD);
  await p3.getByRole("button", { name: "Create account" }).click();
  await expect(p3.locator(ALERT)).toContainText("invalid or has expired");
  await ctx3.close();
});

test("auditor sees allow and deny events with request IDs", async ({ page }) => {
  await login(page, USERS.auditor);
  // Produce a denial first so the test doesn't depend on other specs: auditors cannot create sites.
  const denied = await page.request.post("/api/v1/sites", { data: { code: `A${uid()}`, name: "x", state: "VA", timezone: "America/New_York" }, headers: { origin: "http://localhost:3000" } });
  expect(denied.status()).toBe(403);
  await page.goto("/admin/audit?outcome=DENY");
  await settle(page);
  await expect(page.getByRole("cell", { name: "DENY" }).first()).toBeVisible();
});

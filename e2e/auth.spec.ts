import { expect, test } from "@playwright/test";
import { USERS, login, settle } from "./helpers";
import { ALERT } from "./helpers";

test("unauthenticated users are redirected to sign in", async ({ page }) => {
  await page.goto("/projects");
  await settle(page);
  await expect(page).toHaveURL(/\/login$/);
});

test("wrong password shows a generic error (no account enumeration)", async ({ page }) => {
  await page.goto("/login");
  await settle(page);
  await page.getByLabel("Work email").fill(USERS.admin);
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(ALERT)).toHaveText("Email or password is incorrect.");
  await page.getByLabel("Work email").fill("nobody@riverbend.example");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(ALERT)).toHaveText("Email or password is incorrect.");
});

test("admin signs in, sees synthetic banner and live org data, survives reload, signs out", async ({ page }) => {
  await login(page, USERS.admin);
  await expect(page.getByRole("note")).toContainText("SYNTHETIC DEMO DATA");
  await expect(page.getByText("Riverbend Community Health (SYNTHETIC DEMO DATA)").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Welcome, Avery Admin/ })).toBeVisible();
  await page.reload();
  await settle(page);
  await expect(page.getByRole("heading", { name: /Welcome, Avery Admin/ })).toBeVisible();
  await page.getByRole("link", { name: "Sites & Departments" }).click();
  await expect(page.getByTestId("site-ALX")).toContainText("Alexandria Family Clinic");
  await expect(page.getByTestId("site-SSP")).toContainText("MD");
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/home");
  await settle(page);
  await expect(page).toHaveURL(/\/login$/);
});

test("navigation only shows what the role allows", async ({ page }) => {
  await login(page, USERS.scheduler);
  await expect(page.getByRole("link", { name: "Staff & Permissions" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Audit Log" })).toHaveCount(0);
  await page.goto("/admin/users");
  await settle(page);
  await expect(page.getByText("You don’t have access to staff administration")).toBeVisible();
});

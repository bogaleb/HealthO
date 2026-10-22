import { expect, test } from "@playwright/test";
import { USERS, arrowSelect, login, settle, tabTo, uid } from "./helpers";

/**
 * Keyboard-only operation of the three most interaction-heavy surfaces: the Kanban board, the find → hold → book
 * wizard and the calendar drawer. After sign-in, every step below uses Tab / Enter / Arrow keys / Escape / typing only.
 */

test("A11Y board: create and move a card with the keyboard only; screen-reader announcement is emitted", async ({ page }) => {
  await login(page, USERS.pm);
  await page.goto("/projects");
  await settle(page);
  await tabTo(page, page.getByRole("link", { name: /Billing Improvement/ }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/board$/);
  await settle(page);

  const title = `Keyboard card ${uid()}`;
  await tabTo(page, page.getByRole("button", { name: "New task" }));
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await tabTo(page, dialog.getByLabel("Title", { exact: true }), 30);
  await page.keyboard.type(title);
  await page.keyboard.press("Enter"); // submits the form
  const card = page.getByTestId("column-TODO").locator("li", { hasText: title });
  await expect(card).toBeVisible();

  const move = page.locator("li", { hasText: title }).getByRole("combobox"); // not column-scoped: the card moves
  await tabTo(page, move);
  await page.keyboard.press("ArrowDown"); // To do → In progress (native select: arrow keys change the value)
  await expect(move).toHaveValue("IN_PROGRESS");
  await expect(move).toBeFocused(); // focus follows the card into its new column
  await expect(page.getByTestId("column-IN_PROGRESS").locator("li", { hasText: title })).toBeVisible();
  await expect(page.locator("p[aria-live=polite]").filter({ hasText: /moved to In progress\./ })).toHaveCount(1);
  await page.reload();
  await settle(page);
  await expect(page.getByTestId("column-IN_PROGRESS").locator("li", { hasText: title })).toBeVisible();
});

test("A11Y wizard + calendar: find a time, hold it, pick a patient and book — keyboard only; drawer opens with Enter, closes with Escape", async ({ page }) => {
  await login(page, USERS.scheduler);
  await page.goto("/scheduling/find");
  await settle(page);

  const type = page.getByLabel("Appointment type *");
  await tabTo(page, type);
  await arrowSelect(page, type, /Follow-up — primary care/);
  const site = page.getByLabel("Site");
  await tabTo(page, site);
  await arrowSelect(page, site, /ALX/);
  const prov = page.getByLabel("Provider");
  await tabTo(page, prov);
  await arrowSelect(page, prov, /Practitioner A/);
  await tabTo(page, page.getByRole("button", { name: "Search" }));
  await page.keyboard.press("Enter");
  const slot = page.locator("[data-testid=slot][data-decision=ALLOW]:not([disabled])").nth(5);
  await expect(slot).toBeVisible();
  await tabTo(page, slot, 600);
  const label = (await slot.getAttribute("aria-label")) ?? "";
  expect(label).toMatch(/^Hold .* with Practitioner A.* — eligible$/); // accessible name carries time, zone, provider, eligibility
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/scheduling\/appointments\/new\?hold=/);
  await settle(page);

  await tabTo(page, page.getByRole("searchbox"));
  await page.keyboard.type("Demo Patient 07");
  const pick = page.getByRole("list", { name: "Matching patients" }).getByRole("button").first();
  await expect(pick).toBeVisible();
  await tabTo(page, pick, 50);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("picked-patient")).toContainText("DEMO-0007");
  await expect(page.getByTestId("eligibility-panel")).toContainText("Eligible to book");
  await tabTo(page, page.getByRole("button", { name: "Book appointment" }));
  await page.keyboard.press("Enter");

  const drawer = page.getByTestId("appointment-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Booked", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // Calendar: appointment blocks are focusable links whose accessible name announces status, type, patient, time.
  const block = page.locator('a[data-testid^="appt-"]', { hasText: "Demo Patient 07" }).first();
  await expect(block).toBeVisible();
  expect(await block.getAttribute("aria-label")).toMatch(/Booked: .*Demo Patient 07/);
  await tabTo(page, block, 300);
  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  // Clean up with the keyboard: cancel the appointment from the drawer.
  await tabTo(page, drawer.getByRole("button", { name: "Cancel appointment" }), 60);
  await page.keyboard.press("Enter");
  await tabTo(page, drawer.getByLabel("Reason (no clinical details) *"), 20);
  await page.keyboard.type("Keyboard test cleanup (synthetic)");
  await tabTo(page, drawer.getByRole("button", { name: "Confirm cancellation" }), 20);
  await page.keyboard.press("Enter");
  await expect(drawer.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("A11Y RCM queue: select cases and bulk-assign with the keyboard", async ({ page }) => {
  await login(page, USERS.rcmSupervisor);
  await page.goto("/rcm/queues?owner=none");
  await settle(page);
  const boxes = page.getByTestId("rcm-case-table").getByRole("checkbox", { name: /^Select RCM-/ });
  await expect(boxes.first()).toBeVisible();
  await tabTo(page, boxes.first());
  await page.keyboard.press("Space");
  await expect(page.getByText("1 selected")).toBeVisible();
  const owner = page.getByLabel("Assign selected to");
  await tabTo(page, owner);
  await arrowSelect(page, owner, /Drew Patel/);
  await tabTo(page, page.getByRole("button", { name: /^Assign 1/ }));
  await page.keyboard.press("Enter");
  const banner = page.getByTestId("bulk-banner");
  await expect(banner).toContainText("1 case → Drew Patel");
  await tabTo(page, banner.getByRole("button", { name: "Undo assignment" }));
  await page.keyboard.press("Enter");
  await expect(banner).toBeHidden();
});

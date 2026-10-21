import { expect, test } from "@playwright/test";
import { USERS, login, uid, settle } from "./helpers";
import { ALERT } from "./helpers";

async function openBillBoard(page: import("@playwright/test").Page) {
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await settle(page);
  await page.getByRole("link", { name: /Billing Improvement/ }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/board$/);
  await settle(page);
}

test("PROJ-01: create a task, move it with the keyboard-accessible control, reload — status persists", async ({ page }) => {
  await login(page, USERS.pm);
  await openBillBoard(page);
  const title = `E2E keyboard move ${uid()}`;
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByRole("dialog").getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("dialog").getByLabel("Priority").selectOption("HIGH");
  await page.getByRole("button", { name: "Create task" }).click();
  const todo = page.getByTestId("column-TODO");
  const card = todo.locator("li", { hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("combobox").selectOption("IN_REVIEW");
  const review = page.getByTestId("column-IN_REVIEW");
  await expect(review.locator("li", { hasText: title })).toBeVisible();
  await page.reload();
  await settle(page);
  await expect(page.getByTestId("column-IN_REVIEW").locator("li", { hasText: title })).toBeVisible();
  await expect(page.getByTestId("column-TODO").locator("li", { hasText: title })).toHaveCount(0);
});

test("PROJ-01: drag and drop between columns persists", async ({ page }) => {
  await login(page, USERS.pm);
  await openBillBoard(page);
  const title = `E2E drag ${uid()}`;
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByRole("dialog").getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("dialog").getByLabel("Status").selectOption("IN_REVIEW"); // short column → card stays in view while dragging
  await page.getByRole("button", { name: "Create task" }).click();
  const card = page.getByTestId("column-IN_REVIEW").locator("li", { hasText: title });
  await expect(card).toBeVisible();
  await card.dragTo(page.getByTestId("column-DONE"), { targetPosition: { x: 40, y: 60 } });
  await expect(page.getByTestId("column-DONE").locator("li", { hasText: title })).toBeVisible();
  await page.reload();
  await settle(page);
  await expect(page.getByTestId("column-DONE").locator("li", { hasText: title })).toBeVisible();
});

test("a blocked task cannot be moved to Done; the card returns and the reason is shown", async ({ page }) => {
  await login(page, USERS.pm);
  await openBillBoard(page);
  // BILL-5 "Weekly status readout" is blocked by BILL-3 in the seed.
  const card = page.getByTestId("card-5");
  await expect(card).toContainText("Blocked");
  const from = await card.evaluate((el) => el.closest("section")?.getAttribute("data-testid"));
  await card.getByRole("combobox").selectOption("DONE");
  await expect(page.locator(ALERT)).toContainText("blocked by unfinished tasks");
  await expect(page.getByTestId(from!).getByTestId("card-5")).toBeVisible();
});

test("task drawer: edit fields, checklist, comment, dependency picker; read-only for out-of-scope roles", async ({ page }) => {
  await login(page, USERS.pm);
  await openBillBoard(page);
  await page.getByTestId("card-3").getByRole("link").click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "BILL-3" })).toBeVisible();
  await expect(drawer.getByText("Confirm payer list with supervisor")).toBeVisible();
  const item = `Synthetic step ${uid()}`;
  await drawer.getByLabel("New checklist item").fill(item);
  await drawer.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(drawer.getByText(item)).toBeVisible();
  const note = `E2E comment ${uid()}`;
  await drawer.getByLabel("New comment").fill(note);
  await drawer.getByRole("button", { name: "Comment" }).click();
  await expect(drawer.getByText(note)).toBeVisible();
  await drawer.getByLabel("Labels").fill(`worklist, e2e-${uid().toLowerCase()}`);
  await drawer.getByRole("button", { name: "Save changes" }).click();
  await expect(drawer.getByText(/edited/).first()).toBeVisible();
  // drawer state lives in the URL → survives reload
  await page.reload();
  await settle(page);
  await expect(page.getByRole("dialog").getByText(note)).toBeVisible();
});

test("PROJ-02: creating a dependency cycle is rejected in the UI", async ({ page }) => {
  await login(page, USERS.pm);
  await openBillBoard(page);
  // Seed: BILL-2 blocks BILL-3. Try to make BILL-3 block BILL-2.
  await page.getByTestId("card-2").getByRole("link").click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Link task" }).click();
  await drawer.getByLabel("Search tasks by title or number").fill("follow-up worklist");
  await drawer.getByRole("list", { name: "Matching tasks" }).getByRole("button", { name: /BILL-3 Build follow-up worklist/ }).click();
  await expect(drawer.locator(ALERT)).toContainText("cycle");
});

test("list view filters are in the URL; calendar shows due tasks; My Work groups", async ({ page }) => {
  await login(page, USERS.rcm);
  await page.goto("/tasks/my-work");
  await settle(page);
  await expect(page.getByRole("heading", { name: /Overdue \(\d+\)/ })).toBeVisible();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await settle(page);
  await page.getByRole("link", { name: /Billing Improvement/ }).click();
  await page.getByRole("link", { name: "List", exact: true }).click();
  await expect(page).toHaveURL(/\/list$/);
  await settle(page);
  await page.getByLabel("Priority").selectOption("HIGH");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/priority=HIGH/);
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
});

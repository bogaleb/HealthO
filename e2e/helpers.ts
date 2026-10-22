import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const PASSWORD = process.env.DEMO_PASSWORD ?? "";
export const USERS = {
  admin: "avery.admin@riverbend.example",
  pm: "pat.morgan@riverbend.example",
  scheduler: "sam.ortiz@riverbend.example",
  rcm: "riley.shah@riverbend.example",
  cred: "casey.lin@riverbend.example",
  auditor: "jordan.kim@riverbend.example",
  approver: "morgan.reyes@riverbend.example",
  compliance: "dana.brooks@riverbend.example",
  schedManager: "quinn.park@riverbend.example",
  rcmSupervisor: "taylor.nguyen@riverbend.example",
  rcm2: "drew.patel@riverbend.example",
};

/** Wait until client components are hydrated (no pending network) before interacting. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await settle(page);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await settle(page);
}

/** Signs in an API request context (cookie jar) for HTTP-level authorization tests. */
export async function apiLogin(request: APIRequestContext, email: string) {
  const r = await request.post("/api/auth/sign-in/email", { data: { email, password: PASSWORD }, headers: { origin: "http://localhost:3000" } });
  expect(r.status(), await r.text()).toBe(200);
}

export const uid = () => Math.random().toString(36).slice(2, 7).toUpperCase();

/** App alerts only (Next.js also renders an empty role=alert route announcer). */
export const ALERT = "[role=alert]:not(#__next-route-announcer__)";

/** Press Tab until `target` has focus (keyboard-only navigation). Fails if it is not reachable within `max` presses. */
export async function tabTo(page: Page, target: import("@playwright/test").Locator, max = 400) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return i;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Element not reachable with Tab within ${max} presses`);
}

/** With a native <select> focused, press ArrowDown/ArrowUp until the selected option's text matches. */
export async function arrowSelect(page: Page, select: import("@playwright/test").Locator, label: RegExp, max = 40) {
  for (let i = 0; i < max; i++) {
    const text = await select.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "");
    if (label.test(text)) return;
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`Option ${label} not reached by keyboard`);
}

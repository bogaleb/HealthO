import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const PASSWORD = process.env.DEMO_PASSWORD ?? "";
export const USERS = {
  admin: "avery.admin@riverbend.example",
  pm: "pat.morgan@riverbend.example",
  scheduler: "sam.ortiz@riverbend.example",
  rcm: "riley.shah@riverbend.example",
  cred: "casey.lin@riverbend.example",
  auditor: "jordan.kim@riverbend.example",
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

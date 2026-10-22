import AxeBuilder from "@axe-core/playwright";
import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { USERS, login, settle } from "./helpers";

/**
 * Phase 8: automated WCAG 2.1 A/AA checks (axe-core) on the critical workflows. Fails on any "serious" or
 * "critical" violation; "moderate"/"minor" findings are attached to the report for triage. Automated checks
 * catch only part of WCAG — the keyboard-only journeys in a11y-keyboard.spec.ts and a manual screen-reader pass
 * (RC checklist) are still required.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page, name: string) {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const minor = r.violations.filter((v) => !blocking.includes(v));
  if (minor.length) test.info().annotations.push({ type: `axe-minor ${name}`, description: minor.map((v) => `${v.id} (${v.nodes.length})`).join(", ") });
  expect
    .soft(
      blocking.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 6).map((n) => n.target.join(" ")) })),
      `${name}: serious/critical axe violations`,
    )
    .toEqual([]);
}

test("login and two-factor pages", async ({ page }) => {
  await page.goto("/login");
  await scan(page, "login");
  await page.goto("/login/two-factor");
  await scan(page, "two-factor");
});

test("admin + scheduling + credentialing + projects critical pages", async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const [p] = await sql<
    { id: string }[]
  >`select p.id from projects p join organizations o on o.id = p.organization_id where o.slug = 'riverbend-demo' order by p.created_at limit 1`;
  const [q] = await sql<
    { id: string }[]
  >`select c.id from rcm_cases c join organizations o on o.id = c.organization_id where o.slug = 'riverbend-demo' order by c.created_at limit 1`;
  await sql.end();
  await login(page, USERS.admin);
  const pages = [
    "/home",
    "/dashboard",
    "/tasks/my-work",
    `/projects/${p!.id}/board`,
    `/projects/${p!.id}/list`,
    "/scheduling/find",
    "/scheduling/calendar",
    "/scheduling/appointments/new",
    "/scheduling/waitlist",
    "/scheduling/downtime",
    "/credentialing/cases",
    "/credentialing/readiness",
    "/providers",
    "/rcm/queues",
    `/rcm/cases/${q!.id}`,
    "/reports",
    "/admin/users",
    "/admin/compliance",
    "/admin/integrations",
    "/account/security",
  ];
  for (const path of pages) {
    await page.goto(path);
    await expect(page.locator("main, [role=main]").first()).toBeVisible();
    await scan(page, path);
  }
});

import { expect, test, type Page } from "@playwright/test";
import { ALERT, USERS, apiLogin, login, settle, uid } from "./helpers";

async function openProvider(page: Page, name: RegExp) {
  await page.goto("/providers");
  await settle(page);
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await settle(page);
}

test("Phase 3 exit: specialist adds MD evidence → approver verifies → MD readiness flips to Eligible; specialist cannot verify", async ({ page, browser }) => {
  // Practitioner A has only a VA license (+ an IMLC claim): MD video starts as Needs verification.
  await login(page, USERS.cred);
  await openProvider(page, /Practitioner A/);
  await expect(page.getByTestId("readiness-MD-VIDEO")).toContainText("Needs verification");
  await page.getByRole("button", { name: "Add evidence" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Issuing jurisdiction *").selectOption("MD");
  await dlg.getByLabel("License # — last 4 only").fill(uid().slice(0, 4));
  await dlg.getByLabel("Expires on").fill("2028-06-30");
  await dlg.getByRole("button", { name: "Save draft" }).click();
  const row = page.getByTestId("authority-MD-STATE_LICENSE");
  await expect(row).toContainText("Draft");
  await row.getByRole("button", { name: "Submit for verification" }).click();
  await expect(row).toContainText("Submitted");
  await expect(row.getByRole("button", { name: "Verify" })).toHaveCount(0); // specialist has no approve permission
  await expect(page.getByTestId("readiness-MD-VIDEO")).toContainText("Needs verification");

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, USERS.approver);
  await openProvider(p2, /Practitioner A/);
  const r2 = p2.getByTestId("authority-MD-STATE_LICENSE");
  await r2.getByRole("button", { name: "Verify" }).click();
  await p2.getByRole("dialog").getByLabel("Primary source checked *").fill("Synthetic MD board lookup (DEMO)");
  await p2.getByRole("dialog").getByRole("button", { name: "Mark verified" }).click();
  await expect(r2).toContainText("Verified");
  await expect(p2.getByTestId("readiness-MD-VIDEO")).toContainText("Eligible");
  // Suspension blocks immediately
  await r2.getByRole("button", { name: "Suspend / revoke" }).click();
  await p2.getByRole("dialog").getByLabel("Reason / source *").fill("Synthetic board action (E2E)");
  await p2.getByRole("dialog").getByRole("button", { name: "Apply" }).click();
  await expect(p2.getByTestId("readiness-MD-VIDEO")).toContainText("Blocked");
  await ctx2.close();
});

test("readiness matrix: DC has no approved policy; payer approval at ALX does not carry to SSP", async ({ page }) => {
  await login(page, USERS.cred);
  await page.goto("/credentialing/readiness");
  await settle(page);
  await expect(page.getByRole("note").filter({ hasText: "NOT VERIFIED LAW" })).toBeVisible();
  await expect(page.getByTestId("cell-D-DC")).toContainText("No approved policy");
  await expect(page.getByTestId("cell-D-MD")).toContainText("Eligible");
  await expect(page.getByTestId("cell-G-MD")).toContainText("Blocked");
  await expect(page.getByTestId("cell-B2-MD")).toContainText("Needs verification"); // RN compact never covers APRN
  // reasons disclosure
  await page.getByTestId("cell-G-MD").locator("summary").click();
  await expect(page.getByTestId("cell-G-MD")).toContainText("AUTHORITY_SUSPENDED");
  const dRows = page.locator("tr", { hasText: "Practitioner D" });
  await expect(dRows.filter({ hasText: "ALX" }).first()).toContainText("Ready");
  await expect(dRows.filter({ hasText: "SSP" }).first()).toContainText("Not ready");
});

test("policy rules: author cannot approve own draft; a different publisher approves; readiness changes", async ({ page, browser }) => {
  await login(page, USERS.compliance);
  await page.goto("/admin/rules");
  await settle(page);
  const draft = page.getByTestId("rule-DC-LCSW-VIDEO-v1");
  await expect(draft).toContainText("Draft");
  await draft.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByLabel("Approval reason / review reference *").fill("E2E: DEMO fixture approval");
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(draft).toContainText("Approved");
  await page.goto("/credentialing/readiness");
  await settle(page);
  // D now has an applicable DC rule but no DC license → Needs verification (no longer "No approved policy")
  await expect(page.getByTestId("cell-D-DC")).toContainText("Needs verification");

  // Dual control: the compliance officer authors a draft and cannot approve it herself
  await page.goto("/admin/rules");
  await settle(page);
  await page.getByRole("button", { name: "New rule draft" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Patient location (jurisdiction) *").selectOption("DC");
  await dlg.getByLabel("Profession *").selectOption("PSYCHOLOGIST");
  await dlg.getByRole("button", { name: "Save draft" }).click();
  const mine = page.getByTestId("rule-DC-PSYCHOLOGIST-VIDEO-v1");
  await expect(mine).toContainText("Draft");
  await mine.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByLabel("Approval reason / review reference *").fill("self");
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("dialog").locator(ALERT)).toContainText("Dual control");
  void browser;
});

test("SEC-02 over HTTP: scheduler and specialist cannot publish a rule; RCM analyst cannot read credentialing", async ({ playwright }) => {
  const mk = async (email: string) => {
    const r = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    await apiLogin(r, email);
    return r;
  };
  const cred = await mk(USERS.cred);
  const rules = (await (await cred.get("/api/v1/policy-rules")).json()).data as { id: string; status: string }[];
  const anyDraft = rules.find((r) => r.status === "DRAFT") ?? rules[0]!;
  expect((await cred.post(`/api/v1/policy-rules/${anyDraft.id}/approve`, { data: { reason: "x" } })).status()).toBe(403);
  const sched = await mk(USERS.scheduler);
  expect((await sched.post(`/api/v1/policy-rules/${anyDraft.id}/approve`, { data: { reason: "x" } })).status()).toBe(403);
  const rcm = await mk(USERS.rcm);
  expect((await rcm.get("/api/v1/practitioners")).status()).toBe(403);
  for (const r of [cred, sched, rcm]) await r.dispose();
});

test("case queue: create case, link a project task, completing the case completes the task", async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto("/credentialing/cases");
  await settle(page);
  const title = `E2E case ${uid()}`;
  await page.getByRole("button", { name: "New case" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Title *").fill(title);
  await dlg.getByRole("button", { name: "Create case" }).click();
  const row = page.locator("tr", { hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Link task" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await expect(row).toContainText("To do");
  await row.getByLabel("Case status").selectOption("COMPLETED");
  await page.goto("/credentialing/cases?open=false");
  await settle(page);
  await expect(page.locator("tr", { hasText: title })).toContainText("Done");
});

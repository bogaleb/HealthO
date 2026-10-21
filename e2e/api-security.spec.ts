import { expect, test } from "@playwright/test";
import { USERS, apiLogin, uid } from "./helpers";

test("401 without a session", async ({ request }) => {
  const r = await request.get("/api/v1/me");
  expect(r.status()).toBe(401);
  expect((await r.json()).error.code).toBe("UNAUTHENTICATED");
});

test("scheduler (site-scoped, no sites.manage) gets 403 creating a site", async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  await apiLogin(request, USERS.scheduler);
  const r = await request.post("/api/v1/sites", { data: { code: `X${uid()}`, name: "Nope", state: "VA", timezone: "America/New_York" } });
  expect(r.status()).toBe(403);
  const body = await r.json();
  expect(body.error.code).toBe("FORBIDDEN");
  expect(body.error.requestId).toBeTruthy();
  await request.dispose();
});

test("SEC-01: forged organizationId in body is ignored; site lands in the session org", async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  await apiLogin(request, USERS.admin);
  const me = await (await request.get("/api/v1/me")).json();
  const code = `F${uid()}`;
  const r = await request.post("/api/v1/sites", { data: { code, name: "Forged org test", state: "MD", timezone: "America/New_York", organizationId: "00000000-0000-4000-8000-000000000000" } });
  expect(r.status()).toBe(201);
  expect((await r.json()).data.organizationId).toBe(me.data.organization.id);
  await request.dispose();
});

test("department scope: RCM analyst cannot see the Credentialing project (404) and cannot escalate roles (403)", async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  await apiLogin(admin, USERS.admin);
  const projects = (await (await admin.get("/api/v1/projects")).json()).data as { id: string; key: string }[];
  const onb = projects.find((p) => p.key === "ONB")!;
  const rcm = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  await apiLogin(rcm, USERS.rcm);
  expect((await rcm.get(`/api/v1/projects/${onb.id}`)).status()).toBe(404);
  const visible = (await (await rcm.get("/api/v1/projects")).json()).data as { key: string }[];
  expect(visible.map((p) => p.key)).toEqual(["BILL"]);
  const me = (await (await rcm.get("/api/v1/me")).json()).data;
  const roles = (await (await admin.get("/api/v1/roles")).json()).data as { id: string; key: string }[];
  const esc = await rcm.put(`/api/v1/users/${me.membershipId}/roles`, { data: { grants: [{ roleId: roles.find((r) => r.key === "org_admin")!.id }], version: 1 } });
  expect(esc.status()).toBe(403);
  await admin.dispose();
  await rcm.dispose();
});

test("422 with field details on invalid input; malformed JSON rejected", async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  await apiLogin(request, USERS.admin);
  const r = await request.post("/api/v1/sites", { data: { code: "!", name: "", state: "ZZ", timezone: "Mars/Base" } });
  expect(r.status()).toBe(422);
  const fields = (await r.json()).error.details.map((d: { field: string }) => d.field);
  expect(fields).toEqual(expect.arrayContaining(["code", "name", "state", "timezone"]));
  const bad = await request.post("/api/v1/sites", { data: "{not json", headers: { "content-type": "application/json" } });
  expect(bad.status()).toBe(422);
  await request.dispose();
});

test("cross-origin mutation is rejected", async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  await apiLogin(request, USERS.admin);
  const r = await request.post("/api/v1/sites", { data: { code: `O${uid()}`, name: "x", state: "VA", timezone: "America/New_York" }, headers: { origin: "https://evil.example" } });
  expect(r.status()).toBe(403);
  await request.dispose();
});

test("idempotent task create over HTTP: same key twice → one task", async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  await apiLogin(request, USERS.pm);
  const projects = (await (await request.get("/api/v1/projects")).json()).data as { id: string; key: string }[];
  const bill = projects.find((p) => p.key === "BILL")!;
  const key = `e2e-${uid()}-${uid()}`;
  const title = `Idempotent ${key}`;
  const a = await request.post("/api/v1/tasks", { data: { projectId: bill.id, title }, headers: { "idempotency-key": key } });
  const b = await request.post("/api/v1/tasks", { data: { projectId: bill.id, title }, headers: { "idempotency-key": key } });
  expect(a.status()).toBe(201);
  expect(b.status()).toBe(200);
  expect((await b.json()).replayed).toBe(true);
  expect((await a.json()).data.id).toBe((await b.json()).data.id);
  const list = (await (await request.get(`/api/v1/tasks?projectId=${bill.id}&q=${encodeURIComponent(title)}`)).json()).data;
  expect(list.total).toBe(1);
  await request.dispose();
});

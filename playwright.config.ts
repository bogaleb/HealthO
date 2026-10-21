import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

/**
 * E2E runs against the locally seeded synthetic database (pnpm db:reset first for a clean run).
 * Tests create uniquely-named records so they can be re-run.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000/api/v1/health/ready",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

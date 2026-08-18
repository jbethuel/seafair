import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the real browser against the real database.
 *
 * The Vitest suite proves the database's rules; these prove the interface
 * actually reaches them. That gap is where the bugs have actually been — a
 * blank vessel selector and a stale role filter both passed every database
 * test while making the app unusable for a returning visitor.
 */
export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  // Tests share one Supabase project, and each creates its own isolated fleet.
  // Limiting workers keeps the connection count and the roster sane.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});

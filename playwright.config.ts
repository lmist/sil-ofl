import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? process.env.CONDUCTOR_PORT ?? 3000);
// Prefer localhost over 127.0.0.1 so Next dev does not block /_next assets
// (allowedDevOrigins cross-origin check).
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export function shouldReusePlaywrightServer(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PLAYWRIGHT_FORCE_NEW_SERVER !== "1" && !env.CI;
}

/**
 * E2E + performance budgets for the SIL OFL catalog.
 * GraphQL is mocked by default (see e2e/fixtures) so CI works without DATABASE_URL.
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/*.unit.test.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: process.env.PLAYWRIGHT_WEB_SERVER ?? "bun run dev",
    url: baseURL,
    reuseExistingServer: shouldReusePlaywrightServer(),
    timeout: 120_000,
    env: {
      ...process.env,
      // App can boot without a live DB when GraphQL is mocked client-side.
      PORT: String(PORT),
    },
  },
});

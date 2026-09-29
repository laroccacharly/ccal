import { defineConfig, devices } from "@playwright/test";

// Playwright builds the UI and runs the whole stack (the Worker serving the UI and the booking API, with a
// local D1) under `alchemy dev`, on its own stage and port so it never collides with a dev session.
// Set BASE_URL to test an already running server instead.
const PORT = 3100;

// The Worker requires this key to list bookings; tests send it to read back what the UI posted.
// Workers re-evaluate this file, so the default must be fixed rather than random.
process.env.CCAL_API_KEY ??= "e2e-api-key";

export default defineConfig({
  testDir: "src/e2e",
  testMatch: "*.test.ts",
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "bun run build && bunx alchemy dev --stage e2e",
        url: `http://localhost:${PORT}`,
        env: { DEV_PORT: String(PORT), CCAL_API_KEY: process.env.CCAL_API_KEY },
        reuseExistingServer: false,
        timeout: 120_000,
        // SIGINT is alchemy dev's Ctrl+C: it stops workerd and its sidecars; the default SIGKILL can orphan them.
        gracefulShutdown: { signal: "SIGINT", timeout: 10_000 },
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

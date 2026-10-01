import { defineConfig, devices } from "@playwright/test"

// Playwright builds the UI and runs the whole stack (the Worker serving the UI and the booking API, with a
// local D1) under `alchemy dev`, on its own stage and port so it never collides with a dev session.
// Set BASE_URL to test an already running server instead.
const PORT = 3100

// The Worker requires this key to list bookings; tests send it to read back what the UI posted.
// Workers re-evaluate this file, so the default must be fixed rather than random.
process.env.CCAL_API_KEY ??= "e2e-api-key"

// The Worker talks to a stand-in for Google (tests/e2e/google-stub.ts), never to Google itself. These fake credentials
// take precedence over .env and `ccal login`; the stub only accepts them.
const GOOGLE_STUB_PORT = 3102
const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
  GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
  GOOGLE_REFRESH_TOKEN: "e2e-google-refresh-token",
  GOOGLE_API_ORIGIN: `http://127.0.0.1:${GOOGLE_STUB_PORT}`,
}
// For the tests, to read and steer the stub.
process.env.GOOGLE_API_ORIGIN = GOOGLE_ENV.GOOGLE_API_ORIGIN

// Likewise, the Worker emails the admin through a stand-in for cmail (tests/e2e/cmail-stub.ts), never cmail itself.
const CMAIL_STUB_PORT = 3103
const CMAIL_ENV = {
  CMAIL_API_KEY: "e2e-cmail-api-key",
  CMAIL_ORIGIN: `http://127.0.0.1:${CMAIL_STUB_PORT}`,
  ADMIN_EMAIL: "admin@example.com",
}
// For the tests, to read and steer the stub, and to know where the admin email goes.
process.env.CMAIL_ORIGIN = CMAIL_ENV.CMAIL_ORIGIN
process.env.ADMIN_EMAIL = CMAIL_ENV.ADMIN_EMAIL

const TURNSTILE_ENV = {
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  // Overrides the host of the URL saved on this machine, which alchemy.run.ts would provide.
  CCAL_HOSTNAME: "localhost",
  TURNSTILE_API_ORIGIN: "http://127.0.0.1:3105",
}

export default defineConfig({
  // Every dependency is a local stub, so no test should take longer.
  timeout: 5000,
  testDir: "tests/e2e",
  testMatch: "*.test.ts",
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
  },
  webServer:
    process.env.BASE_URL !== undefined && process.env.BASE_URL !== ""
      ? undefined
      : [
          {
            command: "bun tests/e2e/google-stub.ts",
            url: `${GOOGLE_ENV.GOOGLE_API_ORIGIN}/stub/events`,
            env: { GOOGLE_STUB_PORT: String(GOOGLE_STUB_PORT), ...GOOGLE_ENV },
            reuseExistingServer: false,
          },
          {
            command: "bun tests/e2e/cmail-stub.ts",
            url: `${CMAIL_ENV.CMAIL_ORIGIN}/stub/emails`,
            env: { CMAIL_STUB_PORT: String(CMAIL_STUB_PORT), ...CMAIL_ENV },
            reuseExistingServer: false,
          },
          {
            command: "bun tests/e2e/turnstile-stub.ts",
            url: `${TURNSTILE_ENV.TURNSTILE_API_ORIGIN}/health`,
            reuseExistingServer: false,
          },
          {
            command: "bun run build && bunx alchemy dev --stage e2e",
            url: `http://localhost:${PORT}`,
            env: {
              DEV_PORT: String(PORT),
              CCAL_API_KEY: process.env.CCAL_API_KEY,
              ...GOOGLE_ENV,
              ...CMAIL_ENV,
              ...TURNSTILE_ENV,
              // Lets the tests fake the server's time through POST /api/test-clock.
              ENABLE_TEST_CLOCK: "true",
            },
            reuseExistingServer: false,
            timeout: 120_000,
            // SIGINT is alchemy dev's Ctrl+C: it stops workerd and its sidecars; the default SIGKILL can orphan them.
            gracefulShutdown: { signal: "SIGINT", timeout: 10_000 },
          },
        ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})

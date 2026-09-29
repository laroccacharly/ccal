import { defineConfig, devices } from "@playwright/test";

// Playwright runs its own Vite server and fake booking API on separate ports so they never collide
// with `bun dev` on 3000. Set BASE_URL (and API_URL) to test already running servers instead.
const UI_PORT = 3100;
const API_PORT = 3101;

// Tests read API_URL to check what the UI posted; workers inherit it from here.
process.env.API_URL ??= `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: "src/e2e",
  testMatch: "*.test.ts",
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${UI_PORT}`,
  },
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          command: "bun src/test-server/server.ts",
          url: `http://localhost:${API_PORT}/health`,
          env: { PORT: String(API_PORT) },
          reuseExistingServer: false,
          // SIGTERM lets the server delete its temp database; the default SIGKILL would leave it behind.
          gracefulShutdown: { signal: "SIGTERM", timeout: 2000 },
        },
        {
          command: `bunx vite --port ${UI_PORT} --strictPort`,
          cwd: "src/ui",
          url: `http://localhost:${UI_PORT}`,
          env: { VITE_API_URL: process.env.API_URL },
          reuseExistingServer: false,
        },
      ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

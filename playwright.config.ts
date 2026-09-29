import { defineConfig, devices } from "@playwright/test";

// Playwright runs its own Vite server on a separate port so it never collides with `bun dev` on 3000.
// Set BASE_URL to test an already running server instead.
const PORT = 3100;

export default defineConfig({
  testDir: "src/e2e",
  testMatch: "*.test.ts",
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `bunx vite --port ${PORT} --strictPort`,
        cwd: "src/ui",
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

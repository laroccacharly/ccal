import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "src/e2e",
  testMatch: "*.test.ts",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

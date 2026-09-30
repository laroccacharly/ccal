import { NodeServices } from "@effect/platform-node"
import { defineConfig, devices } from "@playwright/test"
import { Effect } from "effect"

import { readSettings } from "../../src/local/settings"

// Smoke test of the deployed app (tests/smoke): it books for real, so run it only when asked.
// It targets the URL saved with `ccal config --set-url`; set BASE_URL to test another deployment.
const savedUrl = await Effect.runPromise(
  readSettings().pipe(
    Effect.map((settings) => settings.url),
    Effect.provide(NodeServices.layer)
  )
)
const baseURL = process.env.BASE_URL ?? savedUrl
if (baseURL === undefined || baseURL === "") {
  throw new Error(
    "No deployment to test: run `ccal config --set-url` or set BASE_URL."
  )
}

export default defineConfig({
  testDir: ".",
  testMatch: "*.test.ts",
  // One real booking per run is enough.
  retries: 0,
  // For each of the hooks and the test, separately: waiting for the deployed version and for the logs to become
  // searchable each take up to a minute, and the test waits up to 30 seconds for the Meet.
  timeout: 90_000,
  use: { baseURL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})

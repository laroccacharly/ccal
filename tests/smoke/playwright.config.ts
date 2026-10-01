import { existsSync } from "node:fs"

import { NodeServices } from "@effect/platform-node"
import { defineConfig } from "@playwright/test"
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

// Production runs the real Turnstile, which rejected Playwright's Chromium and Google Chrome but accepts Brave. The
// test drives the Brave found at one of its usual install locations.
const BRAVE_PATHS = [
  "/opt/brave-bin/brave",
  "/opt/brave.com/brave/brave",
  "/usr/bin/brave-browser",
  "/usr/bin/brave",
  "/snap/bin/brave",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
]
const bravePath = BRAVE_PATHS.find((path) => existsSync(path))
if (bravePath === undefined) {
  throw new Error(
    `Install Brave to run the smoke test: none found at ${BRAVE_PATHS.join(", ")}.`
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
  projects: [
    {
      name: "brave",
      // No device preset: its fixed user agent (Windows, a Chrome version) would contradict what Brave reports about
      // itself, which is the kind of mismatch Turnstile looks for.
      use: {
        // Turnstile rejects headless and visibly automated browsers, and whoever runs the test may have to click it.
        headless: false,
        launchOptions: {
          ignoreDefaultArgs: ["--enable-automation"],
          args: ["--disable-blink-features=AutomationControlled"],
          executablePath: bravePath,
        },
      },
    },
  ],
})

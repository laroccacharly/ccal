import { existsSync } from "node:fs"

import { defineConfig } from "@playwright/test"
import { Effect, Redacted } from "effect"
import * as Credentials from "effect-lib/credentials"

import { CcalUrl } from "../../src/local/credentials"

// Smoke test of the deployed app (tests/smoke): it books for real, so run it only when asked.
// It targets CCAL_URL, the URL `bun run deploy` deploys to; set BASE_URL to test another deployment. `test:smoke`
// runs Playwright under Bun, which loads effect-lib's TypeScript and has the OS keyring.
const deployedUrl = async () =>
  await Effect.runPromise(
    CcalUrl.resolve.pipe(
      Effect.map(Redacted.value),
      Effect.provide(Credentials.layer(Credentials.defaultKeyring()))
    )
  )
const baseURL = process.env.BASE_URL ?? (await deployedUrl())

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
  // The test waits up to 30 seconds for the Meet, on top of loading the app and booking; it adds the time whoever runs
  // it has to complete the Turnstile check.
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
